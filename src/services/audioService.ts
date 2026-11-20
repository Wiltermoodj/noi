import {
  type AppSettings,
  DEFAULT_PLAYBACK_SPEED,
  type DialectRegion,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  type Phrase,
  type TtsSourceMode,
  type TtsVoiceProfile,
} from "../types/vietnamese";
import {
  createIdentityTimelineMap,
  mapInputSampleToOutputSample,
  mapOutputSampleToInputSample,
  type StretchTimelineMap,
} from "./audio/speechSegmentation";
import {
  getBrowserSpeechPitch,
  pickBrowserVoice,
  pickNativeAndroidVoice,
  type SpeechVoiceInfo,
  type VoiceInventory,
} from "./audio/speechVoicePicker";
import {
  buildTtsCacheUrl,
  isLikelyValidAudioBlob,
  OFFLINE_AUDIO_MEMORY_BUDGET_BYTES,
  OFFLINE_AUDIO_MEMORY_MAX_ENTRIES,
  OFFLINE_AUDIO_STORAGE_BUDGET_BYTES,
  type OfflineAudioMemoryStats,
  type OfflineAudioStorageStats,
  TtsCacheStore,
} from "./audio/ttsCacheStore";
import { stretchAudioChannelsWithMapAsync } from "./audioTimeStretchAsync";
import { buildApiUrl, isCloudApiConfigured, isNativeAndroid } from "./nativePlatform";
import {
  abandonAndroidAudioFocus,
  getAndroidTtsVoices,
  requestAndroidAudioFocus,
  speakWithAndroidTts,
  stopAndroidTts,
  subscribeAndroidTtsVoicesReady,
} from "./noiAndroidBridge";
import {
  computePlaybackPacing,
  countVietnameseSyllables,
  shouldUseNativeSlowClip,
  speedFactorToPercent,
  splitVietnameseSpeechChunks,
} from "./playbackPacing";
import {
  getOrCreateSharedAudioContext,
  getSharedAudioContextConstructor,
  resumeSharedAudioContext,
} from "./sharedAudioContext";
import { stopToneContour } from "./toneAudioService";
import { adaptTextForRegionalSpeech } from "./ttsDialectProfile";

export type { SpeechVoiceInfo, VoiceInventory } from "./audio/speechVoicePicker";

export interface SpeakingStatus {
  isSpeaking: boolean;
  isLoading: boolean;
  activeLang: "en" | "vi" | null;
  activeRegion: DialectRegion | null;
  activeText: string | null;
  audioError: string | null;
}

export interface SpeakVietnameseOptions {
  slow?: boolean | undefined;
  playbackSpeed?: number | undefined;
  preferredViVoiceURI?: string | undefined;
  ttsSource?: TtsSourceMode | undefined;
  ttsVoiceProfile?: TtsVoiceProfile | undefined;
}

export interface SpeakBothOptions {
  slowVietnamese?: boolean | undefined;
  playbackSpeed?: number | undefined;
  preferredEnVoiceURI?: string | undefined;
  preferredViVoiceURI?: string | undefined;
  ttsSource?: TtsSourceMode | undefined;
  ttsVoiceProfile?: TtsVoiceProfile | undefined;
}

export interface OfflinePackProgress {
  completed: number;
  total: number;
  cachedCount: number;
  failedCount?: number;
  rateLimited?: boolean;
  quotaExceeded?: boolean;
  cloudUnavailableMessage?: string;
  retryAfterSeconds?: number;
}

export interface OfflineAudioBudgetStats {
  memoryBlobs: OfflineAudioMemoryStats;
  decodedBuffers: {
    entries: number;
    bytes: number;
    maxEntries: number;
    maxBytes: number;
  };
  stretchedBuffers: {
    entries: number;
    bytes: number;
    maxEntries: number;
    maxBytes: number;
  };
  storage: OfflineAudioStorageStats;
}

type SpeakingListener = (status: SpeakingStatus) => void;
type VoiceListener = (voices: VoiceInventory) => void;

const CLOUD_TTS_FETCH_TIMEOUT_MS = 15_000;
const CLOUD_STATUS_TIMEOUT_MS = 4_000;
const CLOUD_PREFETCH_TIMEOUT_MS = 12_000;

function isNavigatorOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav: { onLine?: boolean } = navigator;
  return nav.onLine === false;
}

function enablePitchPreservation(audio: HTMLAudioElement): void {
  const vendorAudio = audio as HTMLAudioElement & {
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  if ("preservesPitch" in audio) {
    audio.preservesPitch = true;
  }
  if ("webkitPreservesPitch" in vendorAudio) {
    vendorAudio.webkitPreservesPitch = true;
  }
  if ("mozPreservesPitch" in vendorAudio) {
    vendorAudio.mozPreservesPitch = true;
  }
}

export const IDLE_SPEAKING_STATUS: SpeakingStatus = {
  isSpeaking: false,
  isLoading: false,
  activeLang: null,
  activeRegion: null,
  activeText: null,
  audioError: null,
};

class CloudTtsError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfterHeaderSeconds(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
}

function clampSpeedPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_SPEED;
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, Math.round(value)));
}

export function getSlowPlaybackSpeed(playbackSpeed: number): number {
  const clamped = clampSpeedPercent(playbackSpeed);
  return clamped > 70 ? 70 : Math.max(MIN_PLAYBACK_SPEED, Math.round(clamped * 0.7));
}

function resolveSpeedPercent(options?: {
  playbackSpeed?: number | undefined;
  slow?: boolean | undefined;
}): number {
  if (options?.playbackSpeed !== undefined) {
    return clampSpeedPercent(options.playbackSpeed);
  }
  return options?.slow === true ? 70 : DEFAULT_PLAYBACK_SPEED;
}

function resolveCloudSlowFlag(options?: {
  playbackSpeed?: number | undefined;
  slow?: boolean | undefined;
}): boolean {
  if (options?.slow !== undefined) return options.slow;
  if (options?.playbackSpeed !== undefined) {
    return shouldUseNativeSlowClip(options.playbackSpeed);
  }
  return false;
}

interface ActiveWebPlayback {
  ctx: AudioContext;
  decoded: AudioBuffer;
  region: DialectRegion;
  text: string;
  token: number;
  speedFactor: number;
  baseClipIsSlow: boolean;
  startedAtCtxTime: number;
  startOriginalSec: number;
  startOffsetSec: number;
  timeline: StretchTimelineMap;
  source: AudioBufferSourceNode;
  gain: GainNode | null;
  safetyTimerId: number | null;
  onComplete: (ok: boolean) => void;
}

interface ClipSpec {
  text: string;
  region: DialectRegion;
  slow: boolean;
  cacheUrl: string;
}

interface CachedStretchedAudio {
  readonly decoded: AudioBuffer;
  readonly buffer: AudioBuffer;
  readonly timeline: StretchTimelineMap;
  readonly byteSize: number;
}

const DECODED_PCM_MAX_BUFFERS = 64;
const DECODED_PCM_BUDGET_BYTES = 48 * 1024 * 1024;
const STRETCHED_PCM_MAX_BUFFERS = 32;
const STRETCHED_PCM_BUDGET_BYTES = 32 * 1024 * 1024;
const ALL_VOICE_PROFILES: readonly TtsVoiceProfile[] = ["auto", "female", "male"];

function estimateAudioBufferBytes(buffer: AudioBuffer): number {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = Math.max(0, buffer.length);
  return channels * length * 4;
}

class OfflineAudioService {
  private readonly listeners = new Set<SpeakingListener>();
  private readonly cacheStore = new TtsCacheStore({
    maxMemoryEntries: OFFLINE_AUDIO_MEMORY_MAX_ENTRIES,
    maxMemoryBytes: OFFLINE_AUDIO_MEMORY_BUDGET_BYTES,
    maxStorageBytes: OFFLINE_AUDIO_STORAGE_BUDGET_BYTES,
  });
  private readonly decodedBufferCache = new Map<Blob, AudioBuffer>();
  private decodedBufferBytes = 0;
  private readonly maxDecodedBuffers = DECODED_PCM_MAX_BUFFERS;
  private readonly maxDecodedBufferBytes = DECODED_PCM_BUDGET_BYTES;
  private readonly stretchedBufferCache = new Map<string, CachedStretchedAudio>();
  private stretchedBufferBytes = 0;
  private readonly maxStretchedBuffers = STRETCHED_PCM_MAX_BUFFERS;
  private readonly maxStretchedBufferBytes = STRETCHED_PCM_BUDGET_BYTES;
  private readonly inflightPrefetches = new Map<string, Promise<Blob | null>>();
  private readonly externalStoppers = new Set<() => void>();

  private currentTimeout: number | null = null;
  private cancelPendingPause: (() => void) | null = null;
  private utteranceTimeout: number | null = null;
  private utteranceDelayTimer: number | null = null;
  private speechCancelledActiveAt = 0;
  private liveSpeedTimer: number | null = null;
  private liveSpeedRequestId = 0;
  private rearmHtmlAudioSafetyTimer: ((rate: number) => void) | null = null;
  private sequenceToken = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private currentHtmlAudioBaseClipIsSlow = false;
  private activeWebPlayback: ActiveWebPlayback | null = null;
  private currentAbort: AbortController | null = null;
  private cloudCooldownUntil = 0;
  private cloudCooldownStatus: number | null = null;
  private cloudCooldownMessage: string | null = null;
  private currentStatus: SpeakingStatus = IDLE_SPEAKING_STATUS;
  private androidVoicesCache: SpeechVoiceInfo[] = [];
  private androidAudioQueue: Promise<void> = Promise.resolve();

  private async enqueueAndroidTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.androidAudioQueue.then(task, task);
    this.androidAudioQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  private requestFocusIfNative(): void {
    if (!isNativeAndroid()) return;
    void this.enqueueAndroidTask(async () => requestAndroidAudioFocus().then(() => undefined));
  }

  private abandonFocusIfNative(): void {
    if (!isNativeAndroid()) return;
    void this.enqueueAndroidTask(async () => abandonAndroidAudioFocus());
  }

  registerExternalStopper(stopper: () => void): () => void {
    this.externalStoppers.add(stopper);
    return () => {
      this.externalStoppers.delete(stopper);
    };
  }

  resetCloudCooldown(): void {
    this.cloudCooldownUntil = 0;
    this.cloudCooldownStatus = null;
    this.cloudCooldownMessage = null;
  }

  getCloudCooldownRemainingSeconds(): number {
    const remainingMs = this.cloudCooldownUntil - Date.now();
    if (remainingMs <= 0) {
      this.cloudCooldownUntil = 0;
      this.cloudCooldownStatus = null;
      this.cloudCooldownMessage = null;
      return 0;
    }
    return Math.ceil(remainingMs / 1000);
  }

  subscribe(listener: SpeakingListener): () => void {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeVoices(listener: VoiceListener): () => void {
    listener(this.getVoiceInventory());

    if (isNativeAndroid()) {
      let active = true;
      let unsubNativeReady: (() => void) | undefined;

      const refresh = () => {
        void getAndroidTtsVoices().then((res) => {
          if (!active) return;
          this.androidVoicesCache = res.voices;
          listener(this.getVoiceInventory());
        });
      };

      refresh();
      void subscribeAndroidTtsVoicesReady(refresh).then((unsub) => {
        if (active) {
          unsubNativeReady = unsub;
        } else {
          unsub();
        }
      });

      return () => {
        active = false;
        unsubNativeReady?.();
      };
    }

    if (!this.hasBrowserSpeechSynthesis()) {
      return () => undefined;
    }
    const handleVoicesChanged = () => {
      listener(this.getVoiceInventory());
    };
    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
    };
  }

  private emit(patch: Partial<SpeakingStatus>): void {
    const nextStatus: SpeakingStatus = {
      ...IDLE_SPEAKING_STATUS,
      ...patch,
    };
    if (
      nextStatus.isSpeaking === this.currentStatus.isSpeaking &&
      nextStatus.isLoading === this.currentStatus.isLoading &&
      nextStatus.activeLang === this.currentStatus.activeLang &&
      nextStatus.activeRegion === this.currentStatus.activeRegion &&
      nextStatus.activeText === this.currentStatus.activeText &&
      nextStatus.audioError === this.currentStatus.audioError
    ) {
      return;
    }
    this.currentStatus = nextStatus;
    for (const fn of this.listeners) {
      fn(this.currentStatus);
    }
  }

  private hasBrowserSpeechSynthesis(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  isSupported(): boolean {
    return this.hasBrowserSpeechSynthesis() || isNativeAndroid();
  }

  getVoices(): SpeechSynthesisVoice[] {
    if (!this.hasBrowserSpeechSynthesis()) return [];
    return window.speechSynthesis.getVoices();
  }

  getVoiceInventory(): VoiceInventory {
    return {
      vi: this.getVietnameseVoices(),
      en: this.getEnglishVoices(),
    };
  }

  getVietnameseVoices(): SpeechVoiceInfo[] {
    if (!isNativeAndroid() && this.hasBrowserSpeechSynthesis()) {
      return this.getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith("vi"))
        .map((v) => ({
          voiceURI: v.voiceURI,
          name: v.name,
          lang: v.lang,
          localService: v.localService,
        }));
    }
    return this.androidVoicesCache.filter((v) => v.lang.toLowerCase().startsWith("vi"));
  }

  getEnglishVoices(): SpeechVoiceInfo[] {
    if (!isNativeAndroid() && this.hasBrowserSpeechSynthesis()) {
      return this.getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith("en"))
        .map((v) => ({
          voiceURI: v.voiceURI,
          name: v.name,
          lang: v.lang,
          localService: v.localService,
        }));
    }
    return this.androidVoicesCache.filter((v) => v.lang.toLowerCase().startsWith("en"));
  }

  async checkCloudTtsStatus(): Promise<{
    available: boolean;
    cachedClips: number;
    engine?: string;
  }> {
    if (typeof fetch === "undefined" || !isCloudApiConfigured()) {
      return { available: false, cachedClips: 0 };
    }
    const controller = new AbortController();
    const timerId = setTimeout(() => {
      controller.abort();
    }, CLOUD_STATUS_TIMEOUT_MS);
    try {
      const response = await fetch(buildApiUrl("/api/tts/status"), {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) return { available: false, cachedClips: 0 };
      const data = (await response.json()) as {
        available?: unknown;
        cachedClips?: unknown;
        engine?: unknown;
      };
      return {
        available: data.available === true,
        cachedClips:
          typeof data.cachedClips === "number" && Number.isFinite(data.cachedClips)
            ? data.cachedClips
            : 0,
        ...(typeof data.engine === "string" && data.engine.trim().length > 0
          ? { engine: data.engine }
          : {}),
      };
    } catch {
      return { available: false, cachedClips: 0 };
    } finally {
      clearTimeout(timerId);
    }
  }

  async checkCloudTtsAvailable(): Promise<boolean> {
    const status = await this.checkCloudTtsStatus();
    return status.available;
  }

  private unlockAudioContext(): void {
    const ctx = getOrCreateSharedAudioContext();
    if (ctx) {
      void resumeSharedAudioContext(ctx);
    }
  }

  private clearActiveWebPlayback(): void {
    if (!this.activeWebPlayback) return;
    const { source, gain, safetyTimerId, onComplete } = this.activeWebPlayback;
    this.activeWebPlayback = null;
    if (safetyTimerId !== null && typeof window !== "undefined") {
      window.clearTimeout(safetyTimerId);
    }
    try {
      source.onended = null;
      source.stop();
      source.disconnect();
    } catch {
      // Ignore already-stopped source nodes
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        // Ignore already-disconnected gain nodes
      }
    }
    onComplete(true);
  }

  private rememberDecodedBuffer(blob: Blob, decoded: AudioBuffer): void {
    const byteSize = estimateAudioBufferBytes(decoded);
    const existing = this.decodedBufferCache.get(blob);
    if (existing) {
      this.decodedBufferCache.delete(blob);
      this.decodedBufferBytes = Math.max(
        0,
        this.decodedBufferBytes - estimateAudioBufferBytes(existing),
      );
    }
    while (
      this.decodedBufferCache.size >= this.maxDecodedBuffers ||
      (this.decodedBufferCache.size > 0 &&
        this.decodedBufferBytes + byteSize > this.maxDecodedBufferBytes)
    ) {
      const oldest = this.decodedBufferCache.keys().next().value;
      if (oldest === undefined) break;
      const oldestBuf = this.decodedBufferCache.get(oldest);
      this.decodedBufferCache.delete(oldest);
      if (oldestBuf) {
        this.decodedBufferBytes = Math.max(
          0,
          this.decodedBufferBytes - estimateAudioBufferBytes(oldestBuf),
        );
      }
    }
    this.decodedBufferCache.set(blob, decoded);
    this.decodedBufferBytes += byteSize;
  }

  private async decodeBlobToAudioBuffer(ctx: AudioContext, blob: Blob): Promise<AudioBuffer> {
    const cached = this.decodedBufferCache.get(blob);
    if (cached?.sampleRate === ctx.sampleRate) {
      this.rememberDecodedBuffer(blob, cached);
      return cached;
    }
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    this.rememberDecodedBuffer(blob, decoded);
    return decoded;
  }

  private buildAudioBuffer(
    ctx: AudioContext,
    channels: Float32Array[],
    sampleRate: number,
  ): AudioBuffer | null {
    const outLength = channels[0]?.length ?? 0;
    if (outLength === 0) return null;
    const audioBuffer = ctx.createBuffer(channels.length, outLength, sampleRate);
    channels.forEach((data, idx) => {
      const channelView: Float32Array<ArrayBuffer> =
        data.buffer instanceof ArrayBuffer
          ? (data as Float32Array<ArrayBuffer>)
          : new Float32Array(data);
      audioBuffer.copyToChannel(channelView, idx);
    });
    return audioBuffer;
  }

  private extractSlicedChannels(decoded: AudioBuffer, startSample: number): Float32Array[] {
    const safeStart = Math.max(0, Math.min(decoded.length, startSample));
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channelData = decoded.getChannelData(c);
      channels.push(safeStart === 0 ? channelData : channelData.subarray(safeStart));
    }
    return channels;
  }

  private resolveCurrentOriginalSample(active: ActiveWebPlayback, ctxTime: number): number {
    const sampleRate = active.decoded.sampleRate;
    const outPosSec = active.startOffsetSec + Math.max(0, ctxTime - active.startedAtCtxTime);
    const outSample = Math.max(0, Math.round(outPosSec * sampleRate));
    const relInSample = mapOutputSampleToInputSample(active.timeline, outSample);
    const baseSample = Math.round(active.startOriginalSec * sampleRate);
    return Math.min(active.decoded.length, Math.max(0, baseSample + relInSample));
  }

  private async stretchRemainingSliceForLiveSpeed(
    decoded: AudioBuffer,
    startSample: number,
    text: string,
    nextRate: number,
    baseClipIsSlow: boolean,
  ): Promise<{ channels: Float32Array[]; timeline: StretchTimelineMap }> {
    const remainingChannels = this.extractSlicedChannels(decoded, startSample);
    const sliceLen = remainingChannels[0]?.length ?? 0;
    const nextPacing = computePlaybackPacing(speedFactorToPercent(nextRate), { baseClipIsSlow });
    if (nextPacing.vowelRate >= 0.99 && nextPacing.valleyPauseMs < 15) {
      return {
        channels: remainingChannels,
        timeline: createIdentityTimelineMap(sliceLen),
      };
    }
    const totalSyllables = countVietnameseSyllables(text);
    const remainingFraction = decoded.length > 0 ? sliceLen / decoded.length : 1;
    const expectedSyllableCount =
      totalSyllables > 0 ? Math.max(1, Math.round(totalSyllables * remainingFraction)) : undefined;
    return stretchAudioChannelsWithMapAsync(
      remainingChannels,
      decoded.sampleRate,
      nextRate,
      undefined,
      {
        ...(expectedSyllableCount !== undefined ? { expectedSyllableCount } : {}),
        baseClipIsSlow,
      },
    );
  }

  private async applyLiveWebSpeedChange(nextRate: number): Promise<void> {
    const active = this.activeWebPlayback;
    if (this.sequenceToken !== active?.token) return;
    if (Math.abs(nextRate - active.speedFactor) < 0.01) return;

    const { ctx, decoded, region, text, token, onComplete, baseClipIsSlow } = active;
    const requestStartCtxTime = ctx.currentTime;
    const startSample = this.resolveCurrentOriginalSample(active, requestStartCtxTime);
    const currentOriginalSec = startSample / decoded.sampleRate;
    if (currentOriginalSec >= decoded.duration - 0.03) return;

    const requestId = ++this.liveSpeedRequestId;
    const nextStretched = await this.stretchRemainingSliceForLiveSpeed(
      decoded,
      startSample,
      text,
      nextRate,
      baseClipIsSlow,
    );
    if (
      requestId !== this.liveSpeedRequestId ||
      this.sequenceToken !== token ||
      this.activeWebPlayback !== active ||
      (ctx.state as string) === "closed"
    ) {
      return;
    }

    const nextBuffer = this.buildAudioBuffer(ctx, nextStretched.channels, decoded.sampleRate);
    if (!nextBuffer) return;

    const now = ctx.currentTime;
    const nowOriginalSample = this.resolveCurrentOriginalSample(active, now);
    const advanceOriginalSamples = Math.max(0, nowOriginalSample - startSample);
    const startOffsetSamples = mapInputSampleToOutputSample(
      nextStretched.timeline,
      advanceOriginalSamples,
    );
    const startOffsetSec = startOffsetSamples / decoded.sampleRate;
    if (startOffsetSec >= nextBuffer.duration - 0.02) return;

    const fadeSec = 0.016;
    const oldSource = active.source;
    const oldGain = active.gain;
    oldSource.onended = () => {
      try {
        oldSource.disconnect();
        oldGain?.disconnect();
      } catch {
        // Ignore
      }
    };

    if (oldGain) {
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
    }
    try {
      oldSource.stop(now + fadeSec + 0.004);
    } catch {
      // Ignore already-stopped source
    }

    const newSource = ctx.createBufferSource();
    newSource.buffer = nextBuffer;
    const newGain = typeof ctx.createGain === "function" ? ctx.createGain() : null;
    if (newGain) {
      newGain.gain.setValueAtTime(0.0001, now);
      newGain.gain.linearRampToValueAtTime(1, now + fadeSec);
      newSource.connect(newGain);
      newGain.connect(ctx.destination);
    } else {
      newSource.connect(ctx.destination);
    }

    if (active.safetyTimerId !== null && typeof window !== "undefined") {
      window.clearTimeout(active.safetyTimerId);
    }

    const updated: ActiveWebPlayback = {
      ctx,
      decoded,
      region,
      text,
      token,
      speedFactor: nextRate,
      baseClipIsSlow,
      startedAtCtxTime: now,
      startOriginalSec: startSample / decoded.sampleRate,
      startOffsetSec,
      timeline: nextStretched.timeline,
      source: newSource,
      gain: newGain,
      safetyTimerId: null,
      onComplete,
    };
    this.activeWebPlayback = updated;

    const completeNewPlayback = () => {
      if (updated.safetyTimerId !== null && typeof window !== "undefined") {
        window.clearTimeout(updated.safetyTimerId);
        updated.safetyTimerId = null;
      }
      if (this.activeWebPlayback === updated) {
        this.activeWebPlayback = null;
      }
      if (newGain) {
        try {
          newGain.disconnect();
        } catch {
          // Ignore
        }
      }
      if (this.sequenceToken === token) {
        this.emit(IDLE_SPEAKING_STATUS);
      }
      onComplete(true);
    };

    newSource.onended = completeNewPlayback;
    if (typeof window !== "undefined") {
      const remainingDurationSec = Math.max(0, nextBuffer.duration - startOffsetSec);
      const waitMs = Math.max(4000, Math.ceil(remainingDurationSec * 1000) + 4000);
      updated.safetyTimerId = window.setTimeout(() => {
        try {
          newSource.stop();
        } catch {
          // Ignore already-stopped source nodes
        }
        completeNewPlayback();
      }, waitMs);
    }

    newSource.start(now, startOffsetSec);
  }

  setLivePlaybackSpeed(speedPercent: number): void {
    const normalized = clampSpeedPercent(speedPercent);
    const rate = normalized / 100;
    if (this.currentAudio) {
      const pacing = computePlaybackPacing(normalized, {
        baseClipIsSlow: this.currentHtmlAudioBaseClipIsSlow,
      });
      const htmlRate = pacing.vowelRate >= 0.99 ? 1 : Math.max(0.5, Math.min(1, pacing.vowelRate));
      this.currentAudio.playbackRate = htmlRate;
      enablePitchPreservation(this.currentAudio);
      this.rearmHtmlAudioSafetyTimer?.(htmlRate);
    }
    if (this.activeWebPlayback && typeof window !== "undefined") {
      if (this.liveSpeedTimer !== null) {
        window.clearTimeout(this.liveSpeedTimer);
      }
      this.liveSpeedTimer = window.setTimeout(() => {
        this.liveSpeedTimer = null;
        void this.applyLiveWebSpeedChange(rate);
      }, 45);
    }
  }

  private clearTimersAndAbort(): void {
    if (this.liveSpeedTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.liveSpeedTimer);
      this.liveSpeedTimer = null;
    }
    if (this.currentTimeout !== null && typeof window !== "undefined") {
      window.clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
    if (this.cancelPendingPause) {
      const cancelPause = this.cancelPendingPause;
      this.cancelPendingPause = null;
      cancelPause();
    }
    if (this.utteranceDelayTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.utteranceDelayTimer);
      this.utteranceDelayTimer = null;
    }
    if (this.utteranceTimeout !== null && typeof window !== "undefined") {
      window.clearTimeout(this.utteranceTimeout);
      this.utteranceTimeout = null;
    }
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  stop(): void {
    this.sequenceToken++;
    stopToneContour();
    this.clearTimersAndAbort();
    this.clearActiveWebPlayback();
    this.rearmHtmlAudioSafetyTimer = null;
    if (this.currentAudio) {
      this.currentAudio.onplaying = null;
      this.currentAudio.onloadedmetadata = null;
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.hasBrowserSpeechSynthesis()) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        this.speechCancelledActiveAt = Date.now();
      }
      window.speechSynthesis.cancel();
    }
    if (isNativeAndroid()) {
      void this.enqueueAndroidTask(async () => {
        await stopAndroidTts();
        await abandonAndroidAudioFocus();
      });
    }
    for (const stopper of this.externalStoppers) {
      try {
        stopper();
      } catch {
        // Ignore external stopper errors
      }
    }
    this.emit(IDLE_SPEAKING_STATUS);
  }

  private async parseCloudErrorResponse(response: Response): Promise<CloudTtsError> {
    let message = "Unable to generate regional Vietnamese speech.";
    let retryAfterSeconds = parseRetryAfterHeaderSeconds(response);
    try {
      const body = (await response.json()) as {
        error?: unknown;
        retryAfterSeconds?: unknown;
      };
      if (typeof body.error === "string" && body.error.trim()) {
        message = body.error;
      }
      if (
        retryAfterSeconds === undefined &&
        typeof body.retryAfterSeconds === "number" &&
        body.retryAfterSeconds > 0
      ) {
        retryAfterSeconds = Math.ceil(body.retryAfterSeconds);
      }
    } catch {
      // Use generic message
    }
    if (response.status === 429 || response.status === 402) {
      const defaultCooldown = response.status === 402 ? 300 : 60;
      const cooldownSeconds = retryAfterSeconds ?? defaultCooldown;
      const nextUntil = Date.now() + cooldownSeconds * 1000;
      if (nextUntil >= this.cloudCooldownUntil) {
        this.cloudCooldownUntil = nextUntil;
        this.cloudCooldownStatus = response.status;
        this.cloudCooldownMessage = message;
      }
      return new CloudTtsError(message, response.status, cooldownSeconds);
    }
    return new CloudTtsError(message, response.status, retryAfterSeconds);
  }

  private async fetchCloudTtsWithMeta(
    text: string,
    region: DialectRegion,
    slow: boolean,
    voiceProfile: TtsVoiceProfile,
    controller: AbortController,
    timeoutMs = CLOUD_TTS_FETCH_TIMEOUT_MS,
  ): Promise<{ blob: Blob; serverCacheMiss: boolean }> {
    if (!isCloudApiConfigured()) {
      throw new CloudTtsError("Regional cloud voice server URL is not configured.", 503);
    }
    const timeoutState = { triggered: false };
    const timeoutId = setTimeout(() => {
      timeoutState.triggered = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(buildApiUrl("/api/tts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, region, slow, voiceProfile }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.parseCloudErrorResponse(response);
      }

      const cacheHeader = response.headers.get("X-TTS-Cache");
      const blob = await response.blob();
      if (!(await isLikelyValidAudioBlob(blob))) {
        throw new CloudTtsError("Invalid or empty audio response returned.", 502);
      }
      return { blob, serverCacheMiss: cacheHeader === "miss" };
    } catch (err) {
      if (timeoutState.triggered) {
        throw new CloudTtsError("Regional cloud voice timed out. Please try again.", 504);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private rememberStretchedAudio(cacheKey: string, entry: CachedStretchedAudio): void {
    const existing = this.stretchedBufferCache.get(cacheKey);
    if (existing) {
      this.stretchedBufferCache.delete(cacheKey);
      this.stretchedBufferBytes = Math.max(0, this.stretchedBufferBytes - existing.byteSize);
    }
    while (
      this.stretchedBufferCache.size >= this.maxStretchedBuffers ||
      (this.stretchedBufferCache.size > 0 &&
        this.stretchedBufferBytes + entry.byteSize > this.maxStretchedBufferBytes)
    ) {
      const oldestKey = this.stretchedBufferCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestEntry = this.stretchedBufferCache.get(oldestKey);
      this.stretchedBufferCache.delete(oldestKey);
      if (oldestEntry) {
        this.stretchedBufferBytes = Math.max(0, this.stretchedBufferBytes - oldestEntry.byteSize);
      }
    }
    this.stretchedBufferCache.set(cacheKey, entry);
    this.stretchedBufferBytes += entry.byteSize;
  }

  private async getOrBuildStretchedAudio(
    ctx: AudioContext,
    decoded: AudioBuffer,
    text: string,
    speedFactor: number,
    baseClipIsSlow: boolean,
  ): Promise<{ buffer: AudioBuffer; timeline: StretchTimelineMap } | null> {
    const expectedSyllables = countVietnameseSyllables(text);
    const speedKey = String(Math.round(speedFactor * 1000));
    const cacheKey = `${speedKey}:${baseClipIsSlow ? "1" : "0"}:${String(expectedSyllables)}:${String(decoded.sampleRate)}:${text}`;
    const cached = this.stretchedBufferCache.get(cacheKey);
    if (cached?.decoded === decoded && cached.buffer.sampleRate === ctx.sampleRate) {
      this.rememberStretchedAudio(cacheKey, cached);
      return { buffer: cached.buffer, timeline: cached.timeline };
    }

    const rawChannels = this.extractSlicedChannels(decoded, 0);
    const stretched = await stretchAudioChannelsWithMapAsync(
      rawChannels,
      decoded.sampleRate,
      speedFactor,
      undefined,
      {
        ...(expectedSyllables > 0 ? { expectedSyllableCount: expectedSyllables } : {}),
        baseClipIsSlow,
      },
    );
    if ((ctx.state as string) === "closed") return null;
    const buffer = this.buildAudioBuffer(ctx, stretched.channels, decoded.sampleRate);
    if (!buffer) return null;

    this.rememberStretchedAudio(cacheKey, {
      decoded,
      buffer,
      timeline: stretched.timeline,
      byteSize: estimateAudioBufferBytes(buffer),
    });
    return { buffer, timeline: stretched.timeline };
  }

  private async playStretchedAudioBuffer(
    blob: Blob,
    token: number,
    region: DialectRegion,
    text: string,
    speedFactor: number,
    baseClipIsSlow: boolean,
  ): Promise<boolean> {
    const ctx = getOrCreateSharedAudioContext();
    if (!ctx) return false;

    try {
      await resumeSharedAudioContext(ctx);
      if (this.sequenceToken !== token) return true;
      if (ctx.state === "suspended" || (ctx.state as string) === "closed") return false;

      const decoded = await this.decodeBlobToAudioBuffer(ctx, blob);
      if (this.sequenceToken !== token) return true;
      if ((ctx.state as string) === "closed") return false;

      const prepared = await this.getOrBuildStretchedAudio(
        ctx,
        decoded,
        text,
        speedFactor,
        baseClipIsSlow,
      );
      if (this.sequenceToken !== token) return true;
      if (!prepared) return false;
      const { buffer: stretchedBuffer, timeline: stretchedTimeline } = prepared;

      return await new Promise<boolean>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = stretchedBuffer;
        const gain = typeof ctx.createGain === "function" ? ctx.createGain() : null;
        if (gain) {
          gain.gain.setValueAtTime(1, ctx.currentTime);
          source.connect(gain);
          gain.connect(ctx.destination);
        } else {
          source.connect(ctx.destination);
        }

        let settled = false;
        const playback: ActiveWebPlayback = {
          ctx,
          decoded,
          region,
          text,
          token,
          speedFactor,
          baseClipIsSlow,
          startedAtCtxTime: ctx.currentTime,
          startOriginalSec: 0,
          startOffsetSec: 0,
          timeline: stretchedTimeline,
          source,
          gain,
          safetyTimerId: null,
          onComplete: (ok) => {
            finish(ok);
          },
        };
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (playback.safetyTimerId !== null && typeof window !== "undefined") {
            window.clearTimeout(playback.safetyTimerId);
            playback.safetyTimerId = null;
          }
          if (this.activeWebPlayback === playback) {
            this.activeWebPlayback = null;
          }
          if (gain) {
            try {
              gain.disconnect();
            } catch {
              // Ignore
            }
          }
          this.abandonFocusIfNative();
          if (this.sequenceToken === token) {
            this.emit(IDLE_SPEAKING_STATUS);
          }
          resolve(ok);
        };
        this.activeWebPlayback = playback;

        source.onended = () => {
          finish(true);
        };

        if (typeof window !== "undefined") {
          const waitMs = Math.max(4000, Math.ceil(stretchedBuffer.duration * 1000) + 4000);
          playback.safetyTimerId = window.setTimeout(() => {
            try {
              source.stop();
            } catch {
              // Ignore already-stopped source nodes
            }
            finish(true);
          }, waitMs);
        }

        if (this.sequenceToken === token) {
          this.emit({
            isSpeaking: true,
            isLoading: false,
            activeLang: "vi",
            activeRegion: region,
            activeText: text,
            audioError: null,
          });
        }
        this.requestFocusIfNative();
        source.start(0);
      });
    } catch {
      return false;
    }
  }

  private async playHtmlAudioElement(
    blob: Blob,
    token: number,
    region: DialectRegion,
    text: string,
    speedFactor: number,
    baseClipIsSlow: boolean,
  ): Promise<boolean> {
    if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") {
      return false;
    }

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    const pacing = computePlaybackPacing(speedFactorToPercent(speedFactor), { baseClipIsSlow });
    const clampedPlaybackRate =
      pacing.vowelRate >= 0.99 ? 1 : Math.max(0.5, Math.min(1, pacing.vowelRate));
    audio.playbackRate = clampedPlaybackRate;
    enablePitchPreservation(audio);
    this.currentAudio = audio;
    this.currentHtmlAudioBaseClipIsSlow = baseClipIsSlow;

    return new Promise((resolve) => {
      let settled = false;
      let hasStartedPlaying = false;
      let safetyTimerId: number | null = null;

      const clearSafetyTimer = () => {
        if (safetyTimerId !== null && typeof window !== "undefined") {
          window.clearTimeout(safetyTimerId);
          safetyTimerId = null;
        }
      };

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearSafetyTimer();
        this.rearmHtmlAudioSafetyTimer = null;
        audio.onplaying = null;
        audio.onloadedmetadata = null;
        audio.onended = null;
        audio.onerror = null;
        audio.src = "";
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        URL.revokeObjectURL(objectUrl);
        this.abandonFocusIfNative();
        if (this.sequenceToken === token) {
          this.emit(IDLE_SPEAKING_STATUS);
        }
        resolve(ok);
      };

      const armSafetyTimer = (rateFactor: number, durationSec?: number) => {
        if (typeof window === "undefined" || settled) return;
        clearSafetyTimer();
        const safeRate = Math.max(0.5, Math.min(1, rateFactor));
        const currentPos = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
        const remainingSec =
          durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0
            ? Math.max(0.25, durationSec - currentPos)
            : undefined;
        const waitMs =
          remainingSec !== undefined
            ? Math.max(3000, Math.ceil((remainingSec * 1000) / safeRate) + 3500)
            : Math.max(12_000, Math.ceil((text.length * 240) / safeRate) + 5000);
        safetyTimerId = window.setTimeout(() => {
          try {
            audio.pause();
          } catch {
            // Ignore pause errors on stalled audio elements
          }
          finish(hasStartedPlaying);
        }, waitMs);
      };

      this.rearmHtmlAudioSafetyTimer = (nextRate: number) => {
        armSafetyTimer(
          nextRate,
          Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined,
        );
      };

      audio.onloadedmetadata = () => {
        if (!settled && Number.isFinite(audio.duration) && audio.duration > 0) {
          const activeRate = Number.isFinite(audio.playbackRate)
            ? audio.playbackRate
            : clampedPlaybackRate;
          armSafetyTimer(activeRate, audio.duration);
        }
      };
      audio.onplaying = () => {
        hasStartedPlaying = true;
        if (this.sequenceToken === token) {
          this.emit({
            isSpeaking: true,
            isLoading: false,
            activeLang: "vi",
            activeRegion: region,
            activeText: text,
            audioError: null,
          });
        }
      };
      audio.onended = () => {
        finish(true);
      };
      audio.onerror = () => {
        finish(false);
      };

      armSafetyTimer(clampedPlaybackRate);
      this.requestFocusIfNative();
      void audio.play().catch(() => {
        finish(false);
      });
    });
  }

  private async playAudioBlob(
    blob: Blob,
    token: number,
    region: DialectRegion,
    text: string,
    speedFactor = 1,
    baseClipIsSlow = false,
  ): Promise<boolean> {
    const clampedRate = Math.min(1, Math.max(0.1, speedFactor));
    const pacing = computePlaybackPacing(speedFactorToPercent(clampedRate), { baseClipIsSlow });
    const needsTimeStretch = pacing.vowelRate < 0.99 || pacing.valleyPauseMs >= 15;
    if (needsTimeStretch && getSharedAudioContextConstructor() !== null) {
      const stretched = await this.playStretchedAudioBuffer(
        blob,
        token,
        region,
        text,
        clampedRate,
        baseClipIsSlow,
      );
      if (stretched || this.sequenceToken !== token) {
        return stretched;
      }
    }
    return this.playHtmlAudioElement(blob, token, region, text, clampedRate, baseClipIsSlow);
  }

  private async waitForBrowserVoices(
    token: number,
    timeoutMs = 150,
  ): Promise<SpeechSynthesisVoice[]> {
    const initial = this.getVoices();
    if (initial.length > 0 || !this.hasBrowserSpeechSynthesis()) {
      return initial;
    }
    if (typeof window.speechSynthesis.addEventListener !== "function") {
      return initial;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timerId);
        window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve(this.sequenceToken === token ? this.getVoices() : []);
      };
      const onVoicesChanged = () => {
        if (this.getVoices().length > 0) {
          finish();
        }
      };
      const timerId = window.setTimeout(finish, timeoutMs);
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    });
  }

  private async speakSingleWithAndroidNative(
    text: string,
    lang: "en" | "vi",
    options: {
      rate: number;
      pitch: number;
      preferredURI?: string | undefined;
      region?: DialectRegion | undefined;
      voiceProfile?: TtsVoiceProfile | undefined;
      token: number;
      requireStrictLangVoice: boolean;
      displayText?: string | undefined;
      keepSpeakingOnEnd?: boolean | undefined;
    },
  ): Promise<boolean> {
    return this.enqueueAndroidTask(async () => {
      if (this.sequenceToken !== options.token) return true;
      if (this.androidVoicesCache.length === 0) {
        const res = await getAndroidTtsVoices();
        this.androidVoicesCache = res.voices;
      }
      if (this.sequenceToken !== options.token) return true;
      const voice = pickNativeAndroidVoice(
        this.androidVoicesCache,
        lang,
        options.preferredURI,
        options.region,
        options.voiceProfile,
      );
      if (options.requireStrictLangVoice && !voice) {
        return false;
      }

      const spokenText =
        lang === "vi" && options.region ? adaptTextForRegionalSpeech(text, options.region) : text;
      const effectivePitch =
        lang === "vi"
          ? getBrowserSpeechPitch(options.region, options.voiceProfile, voice?.name)
          : options.pitch;

      const completed = await speakWithAndroidTts({
        text: spokenText,
        lang: lang === "vi" ? "vi-VN" : "en-US",
        rate: options.rate,
        pitch: effectivePitch,
        voiceURI: voice?.voiceURI,
        onStart: () => {
          if (this.sequenceToken === options.token) {
            this.emit({
              isSpeaking: true,
              isLoading: false,
              activeLang: lang,
              activeRegion: options.region ?? null,
              activeText: options.displayText ?? text,
              audioError: null,
            });
          }
        },
      });
      if (this.sequenceToken === options.token && options.keepSpeakingOnEnd !== true) {
        this.emit(IDLE_SPEAKING_STATUS);
      }
      return completed;
    });
  }

  private async speakSingleWithBrowser(
    text: string,
    lang: "en" | "vi",
    options: {
      rate: number;
      pitch: number;
      preferredURI?: string | undefined;
      region?: DialectRegion | undefined;
      voiceProfile?: TtsVoiceProfile | undefined;
      token: number;
      requireStrictLangVoice: boolean;
      displayText?: string | undefined;
      keepSpeakingOnEnd?: boolean | undefined;
    },
  ): Promise<boolean> {
    if (!text.trim()) {
      return false;
    }

    if (isNativeAndroid()) {
      return this.speakSingleWithAndroidNative(text, lang, options);
    }

    if (!this.hasBrowserSpeechSynthesis()) {
      return false;
    }

    const voices = await this.waitForBrowserVoices(options.token);
    if (this.sequenceToken !== options.token) {
      return true;
    }

    const voice = pickBrowserVoice(
      voices,
      lang,
      isNavigatorOffline(),
      options.preferredURI,
      options.region,
      options.voiceProfile,
    );
    if (options.requireStrictLangVoice && !voice) {
      return false;
    }

    const spokenText =
      lang === "vi" && options.region ? adaptTextForRegionalSpeech(text, options.region) : text;
    const effectivePitch =
      lang === "vi"
        ? getBrowserSpeechPitch(options.region, options.voiceProfile, voice?.name)
        : options.pitch;

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = lang === "vi" ? "vi-VN" : "en-US";
      utterance.rate = options.rate;
      utterance.pitch = effectivePitch;
      if (voice) {
        utterance.voice = voice;
      }

      let settled = false;
      let hasStartedSpeaking = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (this.utteranceDelayTimer !== null) {
          window.clearTimeout(this.utteranceDelayTimer);
          this.utteranceDelayTimer = null;
        }
        if (this.utteranceTimeout !== null) {
          window.clearTimeout(this.utteranceTimeout);
          this.utteranceTimeout = null;
        }
        if (this.sequenceToken === options.token && options.keepSpeakingOnEnd !== true) {
          this.emit(IDLE_SPEAKING_STATUS);
        }
        resolve(ok);
      };

      utterance.onstart = () => {
        hasStartedSpeaking = true;
        if (this.sequenceToken === options.token) {
          this.emit({
            isSpeaking: true,
            isLoading: false,
            activeLang: lang,
            activeRegion: options.region ?? null,
            activeText: options.displayText ?? text,
            audioError: null,
          });
        }
      };
      utterance.onend = () => {
        finish(true);
      };
      utterance.onerror = () => {
        finish(false);
      };

      const startUtterance = () => {
        if (settled || this.sequenceToken !== options.token) {
          finish(true);
          return;
        }
        if (
          "paused" in window.speechSynthesis &&
          window.speechSynthesis.paused &&
          typeof window.speechSynthesis.resume === "function"
        ) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);

        const safeRate = Math.max(0.1, options.rate);
        const maxWaitMs = Math.max(4000, Math.ceil((text.length * 160) / safeRate));
        this.utteranceTimeout = window.setTimeout(() => {
          if (this.sequenceToken === options.token) {
            try {
              window.speechSynthesis.cancel();
            } catch {
              // Ignore cancel errors on stalled synthesis queue
            }
          }
          finish(hasStartedSpeaking);
        }, maxWaitMs);
      };

      const synthWasRecentlyActive =
        window.speechSynthesis.speaking ||
        window.speechSynthesis.pending ||
        (this.speechCancelledActiveAt > 0 && Date.now() - this.speechCancelledActiveAt < 40);
      this.speechCancelledActiveAt = 0;

      if (synthWasRecentlyActive) {
        this.utteranceDelayTimer = window.setTimeout(() => {
          this.utteranceDelayTimer = null;
          startUtterance();
        }, 30);
      } else {
        startUtterance();
      }
    });
  }

  private async waitInterruptiblePause(delayMs: number, token: number): Promise<boolean> {
    if (delayMs <= 0 || this.sequenceToken !== token) {
      return this.sequenceToken === token;
    }
    if (typeof window === "undefined") {
      return this.sequenceToken === token;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (this.cancelPendingPause === done) {
          this.cancelPendingPause = null;
        }
        resolve();
      };
      this.cancelPendingPause = done;
      this.currentTimeout = window.setTimeout(() => {
        this.currentTimeout = null;
        done();
      }, delayMs);
    });
    return this.sequenceToken === token;
  }

  private async speakChunkedVietnameseSequence(
    chunks: string[],
    cleanText: string,
    region: DialectRegion,
    rate: number,
    chunkPauseMs: number,
    token: number,
    options?: Pick<SpeakVietnameseOptions, "preferredViVoiceURI" | "ttsVoiceProfile">,
  ): Promise<boolean> {
    const voiceProfile = options?.ttsVoiceProfile ?? "auto";
    let spokeAny = false;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (this.sequenceToken !== token) return true;
      if (!chunk) continue;

      const isLast = i === chunks.length - 1;
      const ok = await this.speakSingleWithBrowser(chunk, "vi", {
        rate,
        pitch: 1.0,
        preferredURI: options?.preferredViVoiceURI,
        region,
        voiceProfile,
        token,
        requireStrictLangVoice: true,
        displayText: cleanText,
        keepSpeakingOnEnd: !isLast,
      });
      if (this.sequenceToken !== token) return true;
      if (!ok) {
        if (spokeAny) this.emit(IDLE_SPEAKING_STATUS);
        return spokeAny;
      }

      spokeAny = true;
      if (!isLast && chunkPauseMs > 0) {
        const stillActive = await this.waitInterruptiblePause(chunkPauseMs, token);
        if (!stillActive) return true;
      }
    }

    if (this.sequenceToken === token) {
      this.emit(IDLE_SPEAKING_STATUS);
    }
    return spokeAny;
  }

  private async speakVietnameseWithDevicePacing(
    cleanText: string,
    region: DialectRegion,
    speedPercent: number,
    token: number,
    options?: Pick<SpeakVietnameseOptions, "preferredViVoiceURI" | "ttsVoiceProfile">,
  ): Promise<boolean> {
    const pacing = computePlaybackPacing(speedPercent);
    const chunks = splitVietnameseSpeechChunks(cleanText, pacing.deviceChunkMode);
    if (chunks.length <= 1) {
      return this.speakSingleWithBrowser(cleanText, "vi", {
        rate: pacing.deviceTtsRate,
        pitch: 1.0,
        preferredURI: options?.preferredViVoiceURI,
        region,
        voiceProfile: options?.ttsVoiceProfile ?? "auto",
        token,
        requireStrictLangVoice: true,
      });
    }

    return this.speakChunkedVietnameseSequence(
      chunks,
      cleanText,
      region,
      pacing.deviceTtsRate,
      pacing.deviceChunkPauseMs,
      token,
      options,
    );
  }

  private async tryPlayCachedAudio(
    cacheUrl: string,
    token: number,
    region: DialectRegion,
    cleanText: string,
    speedFactor: number,
    baseClipIsSlow: boolean,
  ): Promise<boolean> {
    const cachedBlob = await this.cacheStore.read(cacheUrl);
    if (!cachedBlob || this.sequenceToken !== token) return false;
    return this.playAudioBlob(cachedBlob, token, region, cleanText, speedFactor, baseClipIsSlow);
  }

  private async tryPlayCachedFallbackVariants(
    cleanText: string,
    region: DialectRegion,
    requestedSlow: boolean,
    voiceProfile: TtsVoiceProfile,
    token: number,
    speedFactor: number,
    allowCrossProfile: boolean,
  ): Promise<boolean> {
    const altSlow = !requestedSlow;
    const sameProfileAltSpeedUrl = buildTtsCacheUrl(cleanText, region, altSlow, voiceProfile);
    if (
      await this.tryPlayCachedAudio(
        sameProfileAltSpeedUrl,
        token,
        region,
        cleanText,
        speedFactor,
        altSlow,
      )
    ) {
      return true;
    }
    if (this.sequenceToken !== token || !allowCrossProfile) return false;

    for (const candidateProfile of ALL_VOICE_PROFILES) {
      if (candidateProfile === voiceProfile) continue;
      for (const candidateSlow of [requestedSlow, altSlow]) {
        const candidateUrl = buildTtsCacheUrl(cleanText, region, candidateSlow, candidateProfile);
        if (
          await this.tryPlayCachedAudio(
            candidateUrl,
            token,
            region,
            cleanText,
            speedFactor,
            candidateSlow,
          )
        ) {
          return true;
        }
        if (this.sequenceToken !== token) return false;
      }
    }
    return false;
  }

  private async speakVietnameseDeviceOnly(
    cleanText: string,
    region: DialectRegion,
    token: number,
    options?: SpeakVietnameseOptions,
  ): Promise<void> {
    const cloudSlow = resolveCloudSlowFlag(options);
    const speedPercent = resolveSpeedPercent(options);
    const blobSpeedFactor = speedPercent / 100;
    const voiceProfile = options?.ttsVoiceProfile ?? "auto";

    const playedBrowser = await this.speakVietnameseWithDevicePacing(
      cleanText,
      region,
      speedPercent,
      token,
      options,
    );
    if (playedBrowser || this.sequenceToken !== token) return;

    const cacheUrl = buildTtsCacheUrl(cleanText, region, cloudSlow, voiceProfile);
    if (
      await this.tryPlayCachedAudio(cacheUrl, token, region, cleanText, blobSpeedFactor, cloudSlow)
    ) {
      return;
    }
    if (
      await this.tryPlayCachedFallbackVariants(
        cleanText,
        region,
        cloudSlow,
        voiceProfile,
        token,
        blobSpeedFactor,
        true,
      )
    ) {
      return;
    }

    if (this.sequenceToken === token) {
      this.emit({
        audioError: isNativeAndroid()
          ? "No on-device Vietnamese voice is installed on this Android device. Switch to Regional Vietnamese Voice or install Vietnamese in Android Text-to-Speech settings."
          : "No on-device Vietnamese voice is installed in this browser. Switch to Regional Vietnamese Voice in Settings or install an OS Vietnamese voice pack.",
      });
    }
  }

  private async tryCloudVietnameseTts(
    cleanText: string,
    region: DialectRegion,
    slow: boolean,
    voiceProfile: TtsVoiceProfile,
    cacheUrl: string,
    token: number,
    speedFactor: number,
  ): Promise<{ played: boolean; cloudError: CloudTtsError | null }> {
    const cooldownSeconds = this.getCloudCooldownRemainingSeconds();
    if (cooldownSeconds > 0) {
      if (this.cloudCooldownStatus === 402) {
        return {
          played: false,
          cloudError: new CloudTtsError(
            this.cloudCooldownMessage ??
              "Vietnamese cloud voice credits are depleted. Manage billing in AI Studio or use an on-device voice or Tone Melody.",
            402,
            cooldownSeconds,
          ),
        };
      }
      return {
        played: false,
        cloudError: new CloudTtsError(
          `Vietnamese voice rate limit reached. Try again in ${String(cooldownSeconds)}s or tap Tone Melody.`,
          429,
          cooldownSeconds,
        ),
      };
    }

    this.emit({
      isSpeaking: false,
      isLoading: true,
      activeLang: "vi",
      activeRegion: region,
      activeText: cleanText,
      audioError: null,
    });

    const controller = new AbortController();
    this.currentAbort = controller;

    try {
      let blob: Blob | null = null;
      const pendingPrefetch = this.inflightPrefetches.get(cacheUrl);
      if (pendingPrefetch) {
        blob = await new Promise<Blob | null>((resolve) => {
          const onAbort = () => {
            resolve(null);
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          void pendingPrefetch.then(
            (res) => {
              controller.signal.removeEventListener("abort", onAbort);
              resolve(res);
            },
            () => {
              controller.signal.removeEventListener("abort", onAbort);
              resolve(null);
            },
          );
        });
        if (controller.signal.aborted || this.sequenceToken !== token) {
          return { played: true, cloudError: null };
        }
      }

      if (!blob) {
        const fetched = await this.fetchCloudTtsWithMeta(
          cleanText,
          region,
          slow,
          voiceProfile,
          controller,
        );
        blob = fetched.blob;
        if (this.sequenceToken !== token) return { played: true, cloudError: null };
        await this.cacheStore.write(cacheUrl, blob, true);
      }

      if (this.sequenceToken !== token) return { played: true, cloudError: null };
      const played = await this.playAudioBlob(blob, token, region, cleanText, speedFactor, slow);
      return { played, cloudError: null };
    } catch (err) {
      if (controller.signal.aborted || this.sequenceToken !== token) {
        return { played: true, cloudError: null };
      }
      const cloudError =
        err instanceof CloudTtsError
          ? err
          : new CloudTtsError("Regional cloud voice is currently unreachable.", 0);
      return { played: false, cloudError };
    } finally {
      if (this.currentAbort === controller) {
        this.currentAbort = null;
      }
    }
  }

  private resolveVietnameseErrorMessage(
    isOffline: boolean,
    cloudError: CloudTtsError | null,
  ): string {
    if (isOffline) {
      return "Offline and this phrase isn't cached yet — tap Tone Melody below or install an OS Vietnamese voice.";
    }
    if (
      cloudError &&
      (cloudError.status === 400 ||
        cloudError.status === 402 ||
        cloudError.status === 403 ||
        cloudError.status === 429 ||
        cloudError.status === 503)
    ) {
      return cloudError.message;
    }
    return "Vietnamese voice requires an internet connection on first play unless an on-device Vietnamese voice is installed.";
  }

  private async speakVietnameseInternal(
    text: string,
    region: DialectRegion,
    token: number,
    options?: SpeakVietnameseOptions,
  ): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText || this.sequenceToken !== token) return;

    if (options?.ttsSource === "device-only") {
      await this.speakVietnameseDeviceOnly(cleanText, region, token, options);
      return;
    }

    const cloudSlow = resolveCloudSlowFlag(options);
    const speedPercent = resolveSpeedPercent(options);
    const blobSpeedFactor = speedPercent / 100;

    const voiceProfile = options?.ttsVoiceProfile ?? "auto";
    const cacheUrl = buildTtsCacheUrl(cleanText, region, cloudSlow, voiceProfile);

    if (
      await this.tryPlayCachedAudio(cacheUrl, token, region, cleanText, blobSpeedFactor, cloudSlow)
    ) {
      return;
    }
    if (this.sequenceToken !== token) return;

    const isOffline = isNavigatorOffline();
    if (
      isOffline &&
      (await this.tryPlayCachedFallbackVariants(
        cleanText,
        region,
        cloudSlow,
        voiceProfile,
        token,
        blobSpeedFactor,
        true,
      ))
    ) {
      return;
    }
    if (this.sequenceToken !== token) return;

    const cloudAttempt = isOffline
      ? { played: false, cloudError: null }
      : await this.tryCloudVietnameseTts(
          cleanText,
          region,
          cloudSlow,
          voiceProfile,
          cacheUrl,
          token,
          blobSpeedFactor,
        );

    if (cloudAttempt.played || this.sequenceToken !== token) return;

    if (
      !isOffline &&
      (await this.tryPlayCachedFallbackVariants(
        cleanText,
        region,
        cloudSlow,
        voiceProfile,
        token,
        blobSpeedFactor,
        true,
      ))
    ) {
      return;
    }
    if (this.sequenceToken !== token) return;

    const playedFallback = await this.speakVietnameseWithDevicePacing(
      cleanText,
      region,
      speedPercent,
      token,
      options,
    );
    if (playedFallback || this.sequenceToken !== token) return;

    this.emit({
      audioError: this.resolveVietnameseErrorMessage(isOffline, cloudAttempt.cloudError),
    });
  }

  async speakEnglish(text: string, preferredEnVoiceURI?: string): Promise<void> {
    this.stop();
    const token = this.sequenceToken;
    await this.speakSingleWithBrowser(text, "en", {
      rate: 0.96,
      pitch: 1.0,
      preferredURI: preferredEnVoiceURI,
      token,
      requireStrictLangVoice: false,
    });
  }

  async speakVietnamese(
    text: string,
    region: DialectRegion,
    options?: SpeakVietnameseOptions,
  ): Promise<void> {
    this.stop();
    this.unlockAudioContext();
    const token = this.sequenceToken;
    await this.speakVietnameseInternal(text, region, token, options);
  }

  async speakBoth(
    english: string,
    vietnamese: string,
    region: DialectRegion,
    options?: SpeakBothOptions,
  ): Promise<void> {
    this.stop();
    this.unlockAudioContext();
    const token = this.sequenceToken;

    await this.speakSingleWithBrowser(english, "en", {
      rate: 0.96,
      pitch: 1.0,
      preferredURI: options?.preferredEnVoiceURI,
      token,
      requireStrictLangVoice: false,
    });

    if (this.sequenceToken !== token) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (this.cancelPendingPause === done) {
          this.cancelPendingPause = null;
        }
        resolve();
      };
      this.cancelPendingPause = done;
      this.currentTimeout = window.setTimeout(() => {
        this.currentTimeout = null;
        done();
      }, 280);
    });

    if (this.sequenceToken !== token) return;

    await this.speakVietnameseInternal(vietnamese, region, token, {
      slow: options?.slowVietnamese,
      playbackSpeed: options?.playbackSpeed,
      preferredViVoiceURI: options?.preferredViVoiceURI,
      ttsSource: options?.ttsSource,
      ttsVoiceProfile: options?.ttsVoiceProfile,
    });
  }

  async speakWithSettings(
    text: string,
    region: DialectRegion,
    settings: Pick<AppSettings, "preferredViVoiceURI"> &
      Partial<
        Pick<AppSettings, "playbackSpeed" | "slowVietnamese" | "ttsSource" | "ttsVoiceProfile">
      >,
  ): Promise<void> {
    const playbackSpeed =
      settings.playbackSpeed ?? (settings.slowVietnamese === true ? 70 : DEFAULT_PLAYBACK_SPEED);
    await this.speakVietnamese(text, region, {
      slow: shouldUseNativeSlowClip(playbackSpeed),
      playbackSpeed,
      preferredViVoiceURI: settings.preferredViVoiceURI,
      ttsSource: settings.ttsSource,
      ttsVoiceProfile: settings.ttsVoiceProfile,
    });
  }

  async speakSlowWithSettings(
    text: string,
    region: DialectRegion,
    settings: Pick<AppSettings, "preferredViVoiceURI"> &
      Partial<
        Pick<AppSettings, "playbackSpeed" | "slowVietnamese" | "ttsSource" | "ttsVoiceProfile">
      >,
  ): Promise<void> {
    const baseSpeed =
      settings.playbackSpeed ?? (settings.slowVietnamese === true ? 70 : DEFAULT_PLAYBACK_SPEED);
    const slowSpeed = getSlowPlaybackSpeed(baseSpeed);
    await this.speakVietnamese(text, region, {
      slow: shouldUseNativeSlowClip(slowSpeed),
      playbackSpeed: slowSpeed,
      preferredViVoiceURI: settings.preferredViVoiceURI,
      ttsSource: settings.ttsSource,
      ttsVoiceProfile: settings.ttsVoiceProfile,
    });
  }

  async speakBothWithSettings(
    english: string,
    vietnamese: string,
    region: DialectRegion,
    settings: Pick<AppSettings, "preferredEnVoiceURI" | "preferredViVoiceURI"> &
      Partial<
        Pick<AppSettings, "playbackSpeed" | "slowVietnamese" | "ttsSource" | "ttsVoiceProfile">
      >,
  ): Promise<void> {
    const playbackSpeed = settings.playbackSpeed ?? DEFAULT_PLAYBACK_SPEED;
    await this.speakBoth(english, vietnamese, region, {
      playbackSpeed,
      slowVietnamese: shouldUseNativeSlowClip(playbackSpeed),
      preferredEnVoiceURI: settings.preferredEnVoiceURI,
      preferredViVoiceURI: settings.preferredViVoiceURI,
      ttsSource: settings.ttsSource,
      ttsVoiceProfile: settings.ttsVoiceProfile,
    });
  }

  async prefetchVietnamese(
    text: string,
    region: DialectRegion,
    options?: Pick<SpeakVietnameseOptions, "slow" | "ttsSource" | "ttsVoiceProfile">,
  ): Promise<void> {
    const cleanText = text.trim();
    if (
      !cleanText ||
      options?.ttsSource === "device-only" ||
      typeof fetch === "undefined" ||
      !isCloudApiConfigured()
    ) {
      return;
    }
    if (isNavigatorOffline() || this.getCloudCooldownRemainingSeconds() > 0) {
      return;
    }

    const slow = options?.slow ?? false;
    const voiceProfile = options?.ttsVoiceProfile ?? "auto";
    const cacheUrl = buildTtsCacheUrl(cleanText, region, slow, voiceProfile);

    const existingPrefetch = this.inflightPrefetches.get(cacheUrl);
    if (existingPrefetch) {
      await existingPrefetch;
      return;
    }
    if (this.cacheStore.hasInMemory(cacheUrl)) return;

    const prefetchPromise = (async (): Promise<Blob | null> => {
      try {
        const cached = await this.cacheStore.read(cacheUrl);
        if (cached) return cached;
        const controller = new AbortController();
        const { blob } = await this.fetchCloudTtsWithMeta(
          cleanText,
          region,
          slow,
          voiceProfile,
          controller,
          CLOUD_PREFETCH_TIMEOUT_MS,
        );
        await this.cacheStore.write(cacheUrl, blob, true);
        return blob;
      } catch {
        // Best-effort background warmup only
        return null;
      } finally {
        this.inflightPrefetches.delete(cacheUrl);
      }
    })();

    this.inflightPrefetches.set(cacheUrl, prefetchPromise);
    await prefetchPromise;
  }

  private getRegionalPhraseText(phrase: Phrase, region: DialectRegion): string {
    if (region === "north") return phrase.north.trim();
    if (region === "central") return phrase.central.trim();
    return phrase.south.trim();
  }

  private appendPhraseClipsForSpeed(
    phrases: Phrase[],
    regions: DialectRegion[],
    slow: boolean,
    voiceProfile: TtsVoiceProfile,
    seen: Set<string>,
    clips: ClipSpec[],
  ): void {
    for (const phrase of phrases) {
      for (const region of regions) {
        const text = this.getRegionalPhraseText(phrase, region);
        if (!text) continue;
        const cacheUrl = buildTtsCacheUrl(text, region, slow, voiceProfile);
        if (seen.has(cacheUrl)) continue;
        seen.add(cacheUrl);
        clips.push({ text, region, slow, cacheUrl });
      }
    }
  }

  private buildPhraseClipList(
    phrases: Phrase[],
    regions: DialectRegion[],
    slow: boolean,
    voiceProfile: TtsVoiceProfile,
    includeSlow = false,
  ): ClipSpec[] {
    const seen = new Set<string>();
    const clips: ClipSpec[] = [];
    this.appendPhraseClipsForSpeed(phrases, regions, slow, voiceProfile, seen, clips);
    if (includeSlow && !slow) {
      this.appendPhraseClipsForSpeed(phrases, regions, true, voiceProfile, seen, clips);
    }
    return clips;
  }

  async getOfflineAudioBudgetStats(): Promise<OfflineAudioBudgetStats> {
    const storage = await this.cacheStore.getStorageStats();
    return {
      memoryBlobs: this.cacheStore.getMemoryStats(),
      decodedBuffers: {
        entries: this.decodedBufferCache.size,
        bytes: this.decodedBufferBytes,
        maxEntries: this.maxDecodedBuffers,
        maxBytes: this.maxDecodedBufferBytes,
      },
      stretchedBuffers: {
        entries: this.stretchedBufferCache.size,
        bytes: this.stretchedBufferBytes,
        maxEntries: this.maxStretchedBuffers,
        maxBytes: this.maxStretchedBufferBytes,
      },
      storage,
    };
  }

  async getPhraseAudioCacheStats(
    phrases: Phrase[],
    regions: DialectRegion[],
    options?: Pick<SpeakVietnameseOptions, "slow" | "ttsVoiceProfile"> & {
      includeSlow?: boolean | undefined;
    },
  ): Promise<{ cachedCount: number; totalCount: number }> {
    const slow = options?.slow ?? false;
    const voiceProfile = options?.ttsVoiceProfile ?? "auto";
    const clips = this.buildPhraseClipList(
      phrases,
      regions,
      slow,
      voiceProfile,
      options?.includeSlow === true,
    );
    if (clips.length === 0) return { cachedCount: 0, totalCount: 0 };

    let cachedCount = 0;
    const cache = await this.cacheStore.openCache();
    const cachedKeys =
      cache && typeof cache.keys === "function"
        ? await cache
            .keys()
            .then((reqs) => new Set(reqs.map((req) => req.url)))
            .catch(() => null)
        : null;

    for (const clip of clips) {
      if (this.cacheStore.hasInMemory(clip.cacheUrl)) {
        cachedCount++;
        continue;
      }
      if (cachedKeys) {
        if (cachedKeys.has(clip.cacheUrl)) {
          cachedCount++;
        }
        continue;
      }
      if (cache) {
        const match = await cache.match(clip.cacheUrl).catch(() => undefined);
        if (match) {
          cachedCount++;
        }
      }
    }

    return { cachedCount, totalCount: clips.length };
  }

  private async cacheClipAttempt(
    clip: ClipSpec,
    voiceProfile: TtsVoiceProfile,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<{
    retry?: boolean;
    cached: boolean;
    serverCacheMiss?: boolean;
    rateLimitedSeconds?: number;
    cloudUnavailableMessage?: string;
    quotaExceeded?: boolean;
  }> {
    const controller = new AbortController();
    const handleAbort = () => {
      controller.abort();
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
      const { blob, serverCacheMiss } = await this.fetchCloudTtsWithMeta(
        clip.text,
        clip.region,
        clip.slow,
        voiceProfile,
        controller,
      );
      const writeOutcome = await this.cacheStore.write(clip.cacheUrl, blob, false);
      if (!writeOutcome.persisted) {
        return {
          cached: false,
          ...(writeOutcome.quotaExceeded ? { quotaExceeded: true } : {}),
        };
      }
      return { cached: true, serverCacheMiss };
    } catch (err) {
      if (err instanceof CloudTtsError && err.status === 429) {
        return { cached: false, rateLimitedSeconds: err.retryAfterSeconds ?? 60 };
      }
      if (
        err instanceof CloudTtsError &&
        (err.status === 400 ||
          err.status === 401 ||
          err.status === 402 ||
          err.status === 403 ||
          (err.status === 503 && err.message.toLowerCase().includes("not configured")))
      ) {
        return { cached: false, cloudUnavailableMessage: err.message };
      }
      if (attempt === 0 && !signal?.aborted && !isNavigatorOffline()) {
        return { cached: false, retry: true };
      }
      return { cached: false };
    } finally {
      signal?.removeEventListener("abort", handleAbort);
    }
  }

  private async cacheClipFromCloud(
    clip: ClipSpec,
    voiceProfile: TtsVoiceProfile,
    signal?: AbortSignal,
  ): Promise<{
    cached: boolean;
    serverCacheMiss?: boolean;
    rateLimitedSeconds?: number;
    cloudUnavailableMessage?: string;
    quotaExceeded?: boolean;
  }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) return { cached: false };
      const outcome = await this.cacheClipAttempt(clip, voiceProfile, attempt, signal);
      if (outcome.retry) {
        await this.waitAbortableDelay(350, signal);
        continue;
      }
      return outcome;
    }
    return { cached: false };
  }

  private async waitAbortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async downloadSinglePackClip(
    clip: ClipSpec,
    voiceProfile: TtsVoiceProfile,
    signal?: AbortSignal,
  ): Promise<{
    status:
      | "already-cached"
      | "fetched"
      | "rate-limited"
      | "cloud-unavailable"
      | "quota-exceeded"
      | "stop";
    retryAfterSeconds?: number;
    cloudUnavailableMessage?: string;
    cached?: boolean;
    serverCacheMiss?: boolean;
  }> {
    if (signal?.aborted) return { status: "stop" };
    const existing = await this.cacheStore.read(clip.cacheUrl);
    if (existing) return { status: "already-cached", cached: true };

    const cooldown = this.getCloudCooldownRemainingSeconds();
    if (cooldown > 0) {
      if (this.cloudCooldownStatus === 402) {
        return {
          status: "cloud-unavailable",
          cloudUnavailableMessage:
            this.cloudCooldownMessage ??
            "Vietnamese cloud voice credits are depleted. Manage billing in AI Studio or use an on-device voice or Tone Melody.",
        };
      }
      return { status: "rate-limited", retryAfterSeconds: cooldown };
    }
    if (isNavigatorOffline()) return { status: "stop" };

    const outcome = await this.cacheClipFromCloud(clip, voiceProfile, signal);
    if (signal?.aborted) return { status: "stop" };
    if (outcome.cloudUnavailableMessage) {
      return {
        status: "cloud-unavailable",
        cloudUnavailableMessage: outcome.cloudUnavailableMessage,
      };
    }
    if (outcome.rateLimitedSeconds !== undefined) {
      return { status: "rate-limited", retryAfterSeconds: outcome.rateLimitedSeconds };
    }
    if (outcome.quotaExceeded) {
      return { status: "quota-exceeded" };
    }
    return {
      status: "fetched",
      cached: outcome.cached,
      ...(outcome.serverCacheMiss ? { serverCacheMiss: true } : {}),
    };
  }

  private applyPackStepOutcome(
    step: Awaited<ReturnType<OfflineAudioService["downloadSinglePackClip"]>>,
    state: {
      completed: number;
      total: number;
      cachedCount: number;
      failedCount: number;
      rateLimited: boolean;
      quotaExceeded: boolean;
      cloudUnavailableMessage: string | undefined;
      retryAfterSeconds: number | undefined;
    },
  ): "continue" | "break" {
    switch (step.status) {
      case "stop":
        return "break";
      case "cloud-unavailable":
        state.cloudUnavailableMessage = step.cloudUnavailableMessage;
        state.failedCount++;
        return "break";
      case "rate-limited":
        state.rateLimited = true;
        state.retryAfterSeconds = step.retryAfterSeconds;
        return "break";
      case "quota-exceeded":
        state.quotaExceeded = true;
        state.failedCount++;
        return "break";
      case "already-cached":
      case "fetched":
        if (step.cached) {
          state.cachedCount++;
        } else {
          state.failedCount++;
        }
        state.completed++;
        return "continue";
    }
  }

  async downloadOfflineAudioPack(
    phrases: Phrase[],
    regions: DialectRegion[],
    options?: Pick<SpeakVietnameseOptions, "slow" | "ttsVoiceProfile"> & {
      includeSlow?: boolean | undefined;
    },
    onProgress?: (progress: OfflinePackProgress) => void,
    signal?: AbortSignal,
  ): Promise<OfflinePackProgress> {
    this.cacheStore.requestPersistentStorage();
    const slow = options?.slow ?? false;
    const voiceProfile = options?.ttsVoiceProfile ?? "auto";
    const clips = this.buildPhraseClipList(
      phrases,
      regions,
      slow,
      voiceProfile,
      options?.includeSlow === true,
    );
    const state = {
      completed: 0,
      total: clips.length,
      cachedCount: 0,
      failedCount: 0,
      rateLimited: false,
      quotaExceeded: false,
      cloudUnavailableMessage: undefined as string | undefined,
      retryAfterSeconds: undefined as number | undefined,
    };

    onProgress?.({
      completed: state.completed,
      total: state.total,
      cachedCount: state.cachedCount,
      failedCount: state.failedCount,
    });

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (!clip) break;
      const step = await this.downloadSinglePackClip(clip, voiceProfile, signal);
      if (this.applyPackStepOutcome(step, state) === "break") break;

      onProgress?.({
        completed: state.completed,
        total: state.total,
        cachedCount: state.cachedCount,
        failedCount: state.failedCount,
      });

      if (step.serverCacheMiss && i < clips.length - 1) {
        await this.waitAbortableDelay(220, signal);
      }
    }

    const result: OfflinePackProgress = {
      completed: state.completed,
      total: state.total,
      cachedCount: state.cachedCount,
      failedCount: state.failedCount,
      ...(state.rateLimited ? { rateLimited: true } : {}),
      ...(state.quotaExceeded ? { quotaExceeded: true } : {}),
      ...(state.cloudUnavailableMessage !== undefined
        ? { cloudUnavailableMessage: state.cloudUnavailableMessage }
        : {}),
      ...(state.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: state.retryAfterSeconds }
        : {}),
    };
    onProgress?.(result);
    return result;
  }
}

export const audioService = new OfflineAudioService();
