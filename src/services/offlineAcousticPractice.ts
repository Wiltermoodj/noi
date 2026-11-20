import { DIALECT_META, type DialectRegion } from "../types/vietnamese";
import { isNativeAndroid } from "./nativePlatform";
import {
  abandonAndroidAudioFocus,
  ensureAndroidMicrophonePermission,
  requestAndroidAudioFocus,
} from "./noiAndroidBridge";
import type {
  PronunciationEvaluation,
  WordMatchStatus,
  WordPronunciationFeedback,
} from "./pronunciationService";
import {
  getOrCreateSharedAudioContext,
  getSharedAudioContextConstructor,
  resumeSharedAudioContext,
} from "./sharedAudioContext";
import { getPhraseToneSyllables, type ViToneName } from "./toneAudioService";

export interface PitchSample {
  timeMs: number;
  rms: number;
  hz: number | null;
}

export interface VoicedSegment {
  startMs: number;
  endMs: number;
  hzPoints: number[];
  slope: number; // semitones or relative change from start to end
  minRatio: number; // min/start to detect dipping contours
  peakRms: number;
}

export interface AcousticPracticeResult {
  evaluation: PronunciationEvaluation;
  recordingUrl: string | null;
  measuredSegments: VoicedSegment[];
}

export interface OfflinePracticeCallbacks {
  onLiveLevel: (level: number, pitchHz: number | null) => void;
  onComplete: (result: AcousticPracticeResult) => void;
  onError: (message: string, permissionDenied?: boolean) => void;
}

function hasNavigatorGetUserMedia(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as { mediaDevices?: Partial<MediaDevices> };
  return typeof nav.mediaDevices?.getUserMedia === "function";
}

export function isOfflineAcousticPracticeSupported(): boolean {
  return hasNavigatorGetUserMedia() && getSharedAudioContextConstructor() !== null;
}

function computeExactNormalizedAutocorr(
  buffer: Float32Array,
  prefixSq: Float64Array,
  lag: number,
): number {
  const size = buffer.length;
  const limit = size - lag;
  const normA = prefixSq[limit] ?? 0;
  const normB = (prefixSq[size] ?? 0) - (prefixSq[lag] ?? 0);
  if (normA <= 0 || normB <= 0) return 0;

  let corr = 0;
  for (let i = 0; i < limit; i++) {
    corr += (buffer[i] ?? 0) * (buffer[i + lag] ?? 0);
  }
  return corr / Math.sqrt(normA * normB);
}

function buildPrefixSquares(buffer: Float32Array): { prefixSq: Float64Array; totalSq: number } {
  const size = buffer.length;
  const prefixSq = new Float64Array(size + 1);
  let runningSq = 0;
  for (let i = 0; i < size; i++) {
    const val = buffer[i] ?? 0;
    runningSq += val * val;
    prefixSq[i + 1] = runningSq;
  }
  return { prefixSq, totalSq: runningSq };
}

function computeCoarseAutocorr(
  buffer: Float32Array,
  prefixSq: Float64Array,
  lag: number,
  innerStride: number,
): number {
  const size = buffer.length;
  const limit = size - lag;
  const normA = prefixSq[limit] ?? 0;
  const normB = (prefixSq[size] ?? 0) - (prefixSq[lag] ?? 0);
  if (normA <= 0 || normB <= 0) return -1;

  let corr = 0;
  for (let i = 0; i < limit; i += innerStride) {
    corr += (buffer[i] ?? 0) * (buffer[i + lag] ?? 0);
  }
  return (corr * innerStride) / Math.sqrt(normA * normB);
}

function findCoarsePitchCandidates(
  buffer: Float32Array,
  prefixSq: Float64Array,
  minLag: number,
  maxLag: number,
): number[] {
  const coarseStep = maxLag - minLag > 120 ? 2 : 1;
  const innerStride = buffer.length >= 1024 ? 2 : 1;
  const count = Math.floor((maxLag - minLag) / coarseStep) + 1;
  const corrs = new Float32Array(count);
  let globalMaxCorr = -1;
  let globalMaxLag = -1;

  for (let idx = 0; idx < count; idx++) {
    const lag = minLag + idx * coarseStep;
    const normalized = computeCoarseAutocorr(buffer, prefixSq, lag, innerStride);
    corrs[idx] = normalized;
    if (normalized > globalMaxCorr) {
      globalMaxCorr = normalized;
      globalMaxLag = lag;
    }
  }

  if (globalMaxCorr < 0.48 || globalMaxLag <= 0) return [];

  // Pick the first local peak (smallest lag = true fundamental) close to globalMaxCorr
  // to avoid octave/sub-harmonic errors (2T, 3T, ...) on higher voices and rising tones.
  const peakThreshold = Math.max(0.5, globalMaxCorr * 0.92);
  for (let idx = 0; idx < count; idx++) {
    const val = corrs[idx] ?? -1;
    if (val < peakThreshold) continue;
    const prev = idx > 0 ? (corrs[idx - 1] ?? -1) : -1;
    const next = idx + 1 < count ? (corrs[idx + 1] ?? -1) : -1;
    if (val >= prev && val >= next) {
      return [minLag + idx * coarseStep];
    }
  }

  return [globalMaxLag];
}

function refinePitchCandidates(
  buffer: Float32Array,
  prefixSq: Float64Array,
  candidates: number[],
  minLag: number,
  maxLag: number,
): { bestLag: number; bestCorr: number } {
  let bestLag = -1;
  let bestCorr = 0;
  const checkedLags = new Set<number>();

  for (const center of candidates) {
    const start = Math.max(minLag, center - 3);
    const end = Math.min(maxLag, center + 3);
    for (let lag = start; lag <= end; lag++) {
      if (checkedLags.has(lag)) continue;
      checkedLags.add(lag);
      const normalized = computeExactNormalizedAutocorr(buffer, prefixSq, lag);
      if (normalized > bestCorr) {
        bestCorr = normalized;
        bestLag = lag;
      }
    }
  }

  return { bestLag, bestCorr };
}

export function detectPitchHz(
  buffer: Float32Array,
  sampleRate: number,
  precomputedRms?: number,
): number | null {
  const size = buffer.length;
  if (size < 4) return null;

  const { prefixSq, totalSq } = buildPrefixSquares(buffer);
  const rms = precomputedRms ?? Math.sqrt(totalSq / size);
  if (rms < 0.015) return null;

  const minLag = Math.floor(sampleRate / 420);
  const maxLag = Math.min(Math.floor(sampleRate / 65), Math.floor(size / 2));
  if (maxLag <= minLag) return null;

  const candidates = findCoarsePitchCandidates(buffer, prefixSq, minLag, maxLag);
  const { bestLag, bestCorr } = refinePitchCandidates(buffer, prefixSq, candidates, minLag, maxLag);

  if (bestCorr < 0.52 || bestLag <= 0) return null;
  return sampleRate / bestLag;
}

function buildSegmentFromSamples(samples: PitchSample[]): VoicedSegment | null {
  const validHz = samples.map((s) => s.hz).filter((h): h is number => h !== null);
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  if (!firstSample || !lastSample || validHz.length < 2) return null;

  const startHz = validHz[0] ?? 150;
  const endHz = validHz[validHz.length - 1] ?? startHz;
  const minHz = Math.min(...validHz);
  const peakRms = Math.max(...samples.map((s) => s.rms));

  return {
    startMs: firstSample.timeMs,
    endMs: lastSample.timeMs,
    hzPoints: validHz,
    slope: (endHz - startHz) / Math.max(1, startHz),
    minRatio: minHz / Math.max(1, startHz),
    peakRms,
  };
}

export function segmentVoicedSyllables(samples: PitchSample[]): VoicedSegment[] {
  const segments: VoicedSegment[] = [];
  let current: PitchSample[] = [];

  for (const sample of samples) {
    const isVoiced = sample.rms >= 0.018 && sample.hz !== null;
    if (isVoiced) {
      current.push(sample);
    } else if (current.length > 0) {
      const prevTime = current[current.length - 1]?.timeMs ?? sample.timeMs;
      const silentGapMs = sample.timeMs - prevTime;
      if (silentGapMs >= 95) {
        const seg = buildSegmentFromSamples(current);
        if (seg && seg.endMs - seg.startMs >= 55) {
          segments.push(seg);
        }
        current = [];
      }
    }
  }

  if (current.length > 0) {
    const seg = buildSegmentFromSamples(current);
    if (seg && seg.endMs - seg.startMs >= 55) {
      segments.push(seg);
    }
  }

  return segments;
}

type ToneChecker = (segment: VoicedSegment) => { status: WordMatchStatus; label: string };

const STANDARD_TONE_CHECKERS: Record<ViToneName, ToneChecker> = {
  ngang: (seg) =>
    Math.abs(seg.slope) <= 0.14
      ? { status: "exact", label: "Level tone" }
      : { status: "tone", label: "Keep level" },
  huyen: (seg) =>
    seg.slope <= -0.04
      ? { status: "exact", label: "Falling tone" }
      : { status: "tone", label: "Drop pitch" },
  sac: (seg) =>
    seg.slope >= 0.06
      ? { status: "exact", label: "Rising tone" }
      : { status: "tone", label: "Raise pitch" },
  hoi: (seg) =>
    seg.minRatio <= 0.93
      ? { status: "exact", label: "Dipping tone" }
      : { status: "tone", label: "Dip deeper" },
  nga: (seg) =>
    seg.slope >= 0.08 && seg.minRatio <= 0.96
      ? { status: "exact", label: "Creaky rise" }
      : { status: "tone", label: "Dip & rise" },
  nang: (seg) =>
    seg.slope <= -0.05 || seg.endMs - seg.startMs <= 260
      ? { status: "exact", label: "Short heavy" }
      : { status: "tone", label: "Clip shorter" },
};

function classifyToneContour(
  tone: ViToneName,
  region: DialectRegion,
  segment: VoicedSegment,
): { status: WordMatchStatus; label: string } {
  const mergedHoiNga = region !== "north" && (tone === "hoi" || tone === "nga");
  if (mergedHoiNga) {
    if (segment.minRatio <= 0.94 || segment.slope >= 0.04) {
      return {
        status: "dialect",
        label: region === "central" ? "Da Nang tone" : "HCMC tone",
      };
    }
    return { status: "tone", label: "Dip then rise" };
  }
  return STANDARD_TONE_CHECKERS[tone](segment);
}

export function computeSpeakerMedianHz(segments: VoicedSegment[]): number {
  const allHz = segments
    .flatMap((s) => s.hzPoints)
    .filter((hz) => Number.isFinite(hz) && hz > 50 && hz < 500)
    .sort((a, b) => a - b);
  if (allHz.length === 0) return 165;
  const mid = Math.floor(allHz.length / 2);
  return allHz[mid] ?? 165;
}

export function normalizeSegmentContour(
  segment: VoicedSegment,
  speakerMidHz: number,
  targetPoints = 6,
): number[] {
  const pts = segment.hzPoints;
  if (pts.length === 0) return [];

  const safeMid = Math.max(70, Math.min(400, speakerMidHz));
  const normalized = pts.map((hz) => {
    const semitones = 12 * Math.log2(Math.max(50, hz) / safeMid);
    const mapped = 0.55 + (semitones / 5) * 0.4;
    return Math.min(0.96, Math.max(0.06, Number(mapped.toFixed(3))));
  });

  if (normalized.length <= 1) {
    return Array.from({ length: targetPoints }, () => normalized[0] ?? 0.55);
  }

  return Array.from({ length: targetPoints }, (_, idx) => {
    const pos = (idx / Math.max(1, targetPoints - 1)) * (normalized.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(normalized.length - 1, lo + 1);
    const frac = pos - lo;
    const vLo = normalized[lo] ?? 0.55;
    const vHi = normalized[hi] ?? vLo;
    return Number((vLo + (vHi - vLo) * frac).toFixed(3));
  });
}

export function evaluateAcousticToneMatch(
  expectedPhrase: string,
  segments: VoicedSegment[],
  region: DialectRegion,
): PronunciationEvaluation {
  const syllables = getPhraseToneSyllables(expectedPhrase, region);
  if (syllables.length === 0) {
    return {
      accuracy: 0,
      region,
      bestTranscript: "",
      words: [],
      feedbackMessage: "Tap the mic and speak the Vietnamese phrase clearly.",
      hasToneHints: false,
      dialectMatchCount: 0,
    };
  }

  if (segments.length === 0) {
    return {
      accuracy: 0,
      region,
      bestTranscript: "",
      words: syllables.map((s) => ({
        id: s.id,
        expected: s.syllable,
        spoken: null,
        status: "missed",
      })),
      feedbackMessage: "No voiced speech detected — speak close to the mic and try again.",
      hasToneHints: false,
      dialectMatchCount: 0,
    };
  }

  const speakerMidHz = computeSpeakerMedianHz(segments);
  let points = 0;
  let hasToneHints = false;
  let dialectMatchCount = 0;

  const words: WordPronunciationFeedback[] = syllables.map((syl, idx) => {
    const mappedIdx =
      segments.length === syllables.length
        ? idx
        : Math.min(
            segments.length - 1,
            Math.round((idx / Math.max(1, syllables.length - 1)) * (segments.length - 1)),
          );
    const segment =
      idx < segments.length || segments.length >= Math.ceil(syllables.length * 0.6)
        ? segments[mappedIdx]
        : undefined;

    if (!segment) {
      return {
        id: syl.id,
        expected: syl.syllable,
        spoken: null,
        status: "missed",
      };
    }

    const match = classifyToneContour(syl.tone, region, segment);
    if (match.status === "exact") points += 1;
    else if (match.status === "dialect") {
      points += 0.95;
      dialectMatchCount++;
    } else {
      points += 0.65;
      hasToneHints = true;
    }

    return {
      id: syl.id,
      expected: syl.syllable,
      spoken: match.label,
      status: match.status,
      dialectNote: match.status === "dialect" ? match.label : undefined,
      measuredContour: normalizeSegmentContour(segment, speakerMidHz),
    };
  });

  const countDiffPenalty = Math.abs(segments.length - syllables.length) > 2 ? 0.85 : 1;
  const accuracy = Math.min(100, Math.round((points / syllables.length) * 100 * countDiffPenalty));
  const city = region === "north" ? "Hanoi" : region === "central" ? "Da Nang" : "Ho Chi Minh City";
  const feedbackMessage =
    accuracy >= 85
      ? `Strong ${city} tone rhythm! Compare your recording below.`
      : accuracy >= 60
        ? `Detected ${String(segments.length)} of ${String(syllables.length)} syllables — check the amber tone cues.`
        : `Spoke ${String(segments.length)} of ${String(syllables.length)} syllables — listen at 0.7x and match the tone melody.`;

  return {
    accuracy,
    region,
    bestTranscript: `${String(segments.length)} spoken syllable${segments.length === 1 ? "" : "s"} analyzed offline (${DIALECT_META[region].label})`,
    words,
    feedbackMessage,
    hasToneHints,
    dialectMatchCount,
  };
}

const RECORDER_STOP_TIMEOUT_MS = 1500;
const MAX_RECORDING_DURATION_MS = 20_000;
const PITCH_SAMPLE_INTERVAL_MS = 32;
const LIVE_LEVEL_CALLBACK_INTERVAL_MS = 60;
const PREFERRED_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function selectSupportedRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  for (const mimeType of PREFERRED_RECORDER_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    } catch {
      // Ignore MIME type check failures
    }
  }
  return undefined;
}

function tryRequestRecorderFlush(recorder: MediaRecorder): boolean {
  try {
    if (recorder.state === "recording") {
      recorder.requestData();
      return true;
    }
  } catch {
    // Ignore flush errors on stopping recorder
  }
  return false;
}

function buildRecordingBlobUrl(chunks: BlobPart[], mimeType: string): string | null {
  if (chunks.length === 0) return null;
  return URL.createObjectURL(new Blob(chunks, { type: mimeType }));
}

function createLocalRecorder(stream: MediaStream): { stopAndGetUrl: () => Promise<string | null> } {
  if (typeof MediaRecorder === "undefined") {
    return {
      stopAndGetUrl: async () => Promise.resolve(null),
    };
  }

  const preferredMime = selectSupportedRecorderMimeType();
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = preferredMime
      ? new MediaRecorder(stream, { mimeType: preferredMime })
      : new MediaRecorder(stream);
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      return {
        stopAndGetUrl: async () => Promise.resolve(null),
      };
    }
  }

  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };
  try {
    recorder.start(100);
  } catch {
    return {
      stopAndGetUrl: async () => Promise.resolve(null),
    };
  }

  return {
    stopAndGetUrl: async () =>
      new Promise((resolve) => {
        if (recorder.state === "inactive") {
          resolve(null);
          return;
        }
        let settled = false;
        let flushTimeoutId: number | null = null;
        let timeoutId: number | null = null;

        const clearTimer = (id: number | null) => {
          if (id !== null && typeof window !== "undefined") {
            window.clearTimeout(id);
          }
        };

        const finish = (useChunks: boolean) => {
          if (settled) return;
          settled = true;
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.onerror = null;
          clearTimer(timeoutId);
          clearTimer(flushTimeoutId);
          const mimeType = recorder.mimeType || (preferredMime ?? "audio/webm");
          resolve(useChunks ? buildRecordingBlobUrl(chunks, mimeType) : null);
        };

        if (typeof window !== "undefined") {
          timeoutId = window.setTimeout(() => {
            if (tryRequestRecorderFlush(recorder)) {
              flushTimeoutId = window.setTimeout(() => {
                finish(true);
              }, 60);
            } else {
              finish(true);
            }
          }, RECORDER_STOP_TIMEOUT_MS);
        }

        recorder.onstop = () => {
          finish(true);
        };
        recorder.onerror = () => {
          finish(false);
        };
        try {
          recorder.stop();
        } catch {
          finish(true);
        }
      }),
  };
}

export interface OfflinePracticeOptions {
  autoStopOnSilence?: boolean | undefined;
  silenceStopMs?: number | undefined;
  maxDurationMs?: number | undefined;
}

export function startOfflineAcousticSession(
  expectedPhrase: string,
  region: DialectRegion,
  callbacks: OfflinePracticeCallbacks,
  options?: OfflinePracticeOptions,
): () => void {
  if (!isOfflineAcousticPracticeSupported()) {
    callbacks.onError("Local microphone recording is unavailable in this browser.");
    return () => undefined;
  }

  const sessionState = { stopped: false, captureStarted: false };
  const isStopped = () => sessionState.stopped;
  let sampleIntervalId: number | null = null;
  let maxDurationTimer: number | null = null;
  let stream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let recorderHandle: { stopAndGetUrl: () => Promise<string | null> } | null = null;
  let endedTrackCleanup: (() => void) | null = null;
  const samples: PitchSample[] = [];
  let startTime = 0;
  const autoStopOnSilence = options?.autoStopOnSilence ?? false;
  const silenceStopMs = options?.silenceStopMs ?? 1250;
  const maxDurationMs = Math.max(2000, options?.maxDurationMs ?? MAX_RECORDING_DURATION_MS);
  let firstSpeechAtMs: number | null = null;
  let lastSpeechAtMs: number | null = null;
  let lastLiveLevelAtMs = -LIVE_LEVEL_CALLBACK_INTERVAL_MS;

  const stopSamplingLoop = () => {
    if (sampleIntervalId !== null && typeof window !== "undefined") {
      window.clearInterval(sampleIntervalId);
      sampleIntervalId = null;
    }
    if (maxDurationTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
  };

  const cleanupMedia = () => {
    stopSamplingLoop();
    if (endedTrackCleanup) {
      endedTrackCleanup();
      endedTrackCleanup = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      sourceNode = null;
    }
    if (analyserNode) {
      try {
        analyserNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      analyserNode = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (isNativeAndroid()) {
      void abandonAndroidAudioFocus();
    }
  };

  const stopAndFinalize = () => {
    if (isStopped()) return;
    sessionState.stopped = true;
    stopSamplingLoop();
    if (!sessionState.captureStarted) {
      cleanupMedia();
      return;
    }
    const stopRec = recorderHandle?.stopAndGetUrl();
    const finalize = async () => {
      try {
        const recordingUrl = stopRec ? await stopRec : null;
        const segments = segmentVoicedSyllables(samples);
        const evaluation = evaluateAcousticToneMatch(expectedPhrase, segments, region);
        callbacks.onComplete({
          evaluation,
          recordingUrl,
          measuredSegments: segments,
        });
      } catch {
        callbacks.onError("Unable to evaluate recorded microphone audio. Please try again.");
      } finally {
        cleanupMedia();
      }
    };
    void finalize();
  };

  const prepareNativeMicrophone = async (): Promise<boolean> => {
    if (!isNativeAndroid()) return true;
    const perm = await ensureAndroidMicrophonePermission();
    if (isStopped()) return false;
    if (!perm.granted) {
      sessionState.stopped = true;
      cleanupMedia();
      callbacks.onError(
        "Microphone permission is required to record and evaluate tones. Enable Microphone in Android App Settings.",
        true,
      );
      return false;
    }
    await requestAndroidAudioFocus();
    if (isStopped()) {
      cleanupMedia();
      return false;
    }
    return true;
  };

  const sampleFrameFromAnalyser = (
    analyser: AnalyserNode,
    timeDomain: Float32Array<ArrayBuffer>,
    sampleRate: number,
  ) => {
    if (isStopped()) return;
    const elapsedMs = performance.now() - startTime;
    analyser.getFloatTimeDomainData(timeDomain);
    let sumSq = 0;
    for (const sampleVal of timeDomain) {
      sumSq += sampleVal * sampleVal;
    }
    const rms = Math.sqrt(sumSq / timeDomain.length);
    const hz = detectPitchHz(timeDomain, sampleRate, rms);
    samples.push({ timeMs: elapsedMs, rms, hz });
    if (elapsedMs - lastLiveLevelAtMs >= LIVE_LEVEL_CALLBACK_INTERVAL_MS) {
      lastLiveLevelAtMs = elapsedMs;
      callbacks.onLiveLevel(Math.min(1, rms * 6), hz);
    }

    if (rms >= 0.022 && hz !== null) {
      firstSpeechAtMs ??= elapsedMs;
      lastSpeechAtMs = elapsedMs;
    } else if (
      autoStopOnSilence &&
      firstSpeechAtMs !== null &&
      lastSpeechAtMs !== null &&
      lastSpeechAtMs - firstSpeechAtMs >= 250 &&
      elapsedMs - lastSpeechAtMs >= silenceStopMs
    ) {
      stopAndFinalize();
    }
  };

  const startCapture = async () => {
    const ready = await prepareNativeMicrophone();
    if (!ready || isStopped()) return;

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (isStopped()) {
      for (const track of mediaStream.getTracks()) track.stop();
      cleanupMedia();
      return;
    }

    stream = mediaStream;
    const ctx = getOrCreateSharedAudioContext();
    if (!ctx) {
      cleanupMedia();
      callbacks.onError("Local microphone recording is unavailable in this browser.");
      return;
    }
    await resumeSharedAudioContext(ctx);
    if (isStopped()) {
      cleanupMedia();
      return;
    }
    if (ctx.state === "suspended" || (ctx.state as string) === "closed") {
      sessionState.stopped = true;
      cleanupMedia();
      callbacks.onError(
        "Microphone capture could not start because audio is suspended. Tap the mic button to try again.",
      );
      return;
    }

    sessionState.captureStarted = true;
    startTime = performance.now();
    const primaryTrack = mediaStream.getTracks()[0];
    if (primaryTrack && typeof primaryTrack.addEventListener === "function") {
      const handleTrackEnded = () => {
        stopAndFinalize();
      };
      primaryTrack.addEventListener("ended", handleTrackEnded, { once: true });
      endedTrackCleanup = () => {
        if (typeof primaryTrack.removeEventListener === "function") {
          primaryTrack.removeEventListener("ended", handleTrackEnded);
        }
      };
    }

    sourceNode = ctx.createMediaStreamSource(mediaStream);
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    sourceNode.connect(analyserNode);

    recorderHandle = createLocalRecorder(mediaStream);
    const timeDomain = new Float32Array(analyserNode.fftSize);
    const sampleRate = ctx.sampleRate;
    const activeAnalyser = analyserNode;

    if (typeof window !== "undefined") {
      maxDurationTimer = window.setTimeout(() => {
        stopAndFinalize();
      }, maxDurationMs);
      sampleIntervalId = window.setInterval(() => {
        sampleFrameFromAnalyser(activeAnalyser, timeDomain, sampleRate);
      }, PITCH_SAMPLE_INTERVAL_MS);
    }

    sampleFrameFromAnalyser(activeAnalyser, timeDomain, sampleRate);
  };

  void startCapture().catch((err: unknown) => {
    if (!isStopped()) {
      sessionState.stopped = true;
      cleanupMedia();
      const errName = err instanceof Error ? err.name : "";
      if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        callbacks.onError("No microphone was found on this device.");
        return;
      }
      if (errName === "NotReadableError" || errName === "TrackStartError") {
        callbacks.onError(
          "The microphone is currently in use by another app. Close other audio apps and try again.",
        );
        return;
      }
      const denied = errName === "NotAllowedError" || errName === "PermissionDeniedError";
      callbacks.onError(
        "Microphone access was blocked or unavailable. Allow microphone access to record and evaluate tones offline.",
        denied,
      );
    }
  });

  return stopAndFinalize;
}
