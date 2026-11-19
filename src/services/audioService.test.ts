import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtsCacheStore } from "./audio/ttsCacheStore";
import { audioService, getSlowPlaybackSpeed, type SpeakingStatus } from "./audioService";
import { stretchAudioChannelData, stretchAudioChannels } from "./audioTimeStretch";
import { computePlaybackPacing } from "./playbackPacing";
import { loadSettings, normalizePlaybackSpeed } from "./storageService";

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

function setupBrowserAudioMocks(voices: FakeVoice[]) {
  const speakSpy = vi.fn();
  const cancelSpy = vi.fn();
  const playSpy = vi.fn(async () => {
    await Promise.resolve();
  });

  const utterances: { text: string; lang: string; rate: number; voice: FakeVoice | null }[] = [];
  const audioInstances: { src: string; playbackRate: number; preservesPitch: boolean }[] = [];

  class MockUtterance {
    text: string;
    lang = "";
    rate = 1;
    pitch = 1;
    voice: FakeVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
      utterances.push(this);
    }
  }

  class MockAudio {
    src: string;
    playbackRate = 1;
    preservesPitch = false;
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(src: string) {
      this.src = src;
      audioInstances.push(this);
    }

    pause = vi.fn();

    async play(): Promise<void> {
      await playSpy();
      this.onplaying?.();
      this.onended?.();
    }
  }

  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    speechSynthesis: {
      getVoices: () => voices,
      speak: (u: MockUtterance) => {
        speakSpy(u);
        u.onstart?.();
        u.onend?.();
      },
      cancel: cancelSpy,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock-wav"),
    revokeObjectURL: vi.fn(),
  });

  return { speakSpy, cancelSpy, playSpy, utterances, audioInstances };
}

describe("Vietnamese audioService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    audioService.resetCloudCooldown();
  });

  afterEach(() => {
    audioService.stop();
    audioService.resetCloudCooldown();
    vi.unstubAllGlobals();
  });

  it("never falls back to an English voice when speaking Vietnamese", async () => {
    const { speakSpy } = setupBrowserAudioMocks([
      { voiceURI: "en-us-1", name: "Samantha", lang: "en-US", localService: true },
    ]);

    const statuses: SpeakingStatus[] = [];
    const unsub = audioService.subscribe((status) => {
      statuses.push(status);
    });

    await audioService.speakVietnamese("Tính tiền giúp em", "south", {
      ttsSource: "device-only",
    });

    unsub();
    expect(speakSpy).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.audioError).toContain("No on-device Vietnamese voice");
  });

  it("requests regional Vietnamese WAV from /api/tts and plays it", async () => {
    const { playSpy } = setupBrowserAudioMocks([]);
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakVietnamese("Cái ni bao nhiêu rứa?", "central", {
      slow: true,
      ttsSource: "cloud-first",
      ttsVoiceProfile: "female",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(callArgs[0]).toBe("/api/tts");
    const rawBody = typeof callArgs[1].body === "string" ? callArgs[1].body : "{}";
    const parsedBody = JSON.parse(rawBody) as {
      text: string;
      region: string;
      slow: boolean;
      voiceProfile: string;
    };
    expect(parsedBody).toEqual({
      text: "Cái ni bao nhiêu rứa?",
      region: "central",
      slow: true,
      voiceProfile: "female",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("picks region-matching on-device Vietnamese voices when installed", async () => {
    const { speakSpy, utterances } = setupBrowserAudioMocks([
      { voiceURI: "en-1", name: "Alex", lang: "en-US", localService: true },
      { voiceURI: "vi-north", name: "Linh Hanoi", lang: "vi-VN", localService: true },
      { voiceURI: "vi-south", name: "Mai Saigon", lang: "vi-VN", localService: true },
    ]);

    await audioService.speakVietnamese("Rẽ trái nhé", "north", {
      ttsSource: "device-only",
    });

    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(utterances[0]?.lang).toBe("vi-VN");
    expect(utterances[0]?.voice?.voiceURI).toBe("vi-north");
  });

  it("does not misclassify Northern NamMinh or Lan voices via substring regex collisions", async () => {
    const { utterances } = setupBrowserAudioMocks([
      {
        voiceURI: "Microsoft Server Speech Text to Speech Voice (vi-VN, NamMinh)",
        name: "Microsoft NamMinh Online (Natural) - Vietnamese (Vietnam)",
        lang: "vi-VN",
        localService: false,
      },
      {
        voiceURI: "Microsoft Server Speech Text to Speech Voice (vi-VN, HoaiMy)",
        name: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)",
        lang: "vi-VN",
        localService: false,
      },
    ]);

    const statuses: SpeakingStatus[] = [];
    const unsub = audioService.subscribe((status) => {
      statuses.push(status);
    });

    await audioService.speakVietnamese("Gì vậy?", "south", {
      ttsSource: "device-only",
      ttsVoiceProfile: "auto",
    });
    unsub();

    expect(utterances[0]?.voice?.name).toContain("HoaiMy");
    expect(utterances[0]?.text).toBe("Yì yậy?");
    expect(statuses.some((s) => s.isSpeaking && s.activeText === "Gì vậy?")).toBe(true);

    await audioService.speakVietnamese("Rẽ trái nhé", "north", {
      ttsSource: "device-only",
      ttsVoiceProfile: "male",
    });
    expect(utterances[1]?.voice?.name).toContain("NamMinh");
    expect(utterances[1]?.text).toBe("Dẽ chái nhé");
  });

  it("skips cloud /api/tts network fetch when browser is offline and falls back locally", async () => {
    const { speakSpy } = setupBrowserAudioMocks([
      { voiceURI: "vi-south", name: "Mai Saigon", lang: "vi-VN", localService: true },
    ]);
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakVietnamese("Cà phê sữa đá", "south", {
      ttsSource: "cloud-first",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it("downloads and reports offline audio pack coverage", async () => {
    setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([9, 8, 7])], { type: "audio/wav" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const samplePhrases = [
      {
        id: "t1",
        category: "Coffee & Food" as const,
        english: "Iced tea",
        north: "Trà đá nhé",
        central: "Trà đá nha",
        south: "Trà đá nha",
        phoneticNorth: "chah dah nyeh",
        phoneticCentral: "chah dah nyah",
        phoneticSouth: "chah dah nyah",
        textbook: "Trà đá",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const progress = await audioService.downloadOfflineAudioPack(samplePhrases, ["north", "south"]);
    expect(progress.total).toBe(2);
    expect(progress.cachedCount).toBe(2);

    const stats = await audioService.getPhraseAudioCacheStats(samplePhrases, ["north", "south"]);
    expect(stats).toEqual({ cachedCount: 2, totalCount: 2 });
  });

  it("respects 429 cooldown and pauses pack downloads without hammering /api/tts", async () => {
    const { speakSpy } = setupBrowserAudioMocks([
      { voiceURI: "vi-south", name: "Mai Saigon", lang: "vi-VN", localService: true },
    ]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(
        JSON.stringify({ error: "Vietnamese voice rate limit reached.", retryAfterSeconds: 45 }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "45" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakVietnamese("Xin chào nhé", "north", { ttsSource: "cloud-first" });
    await audioService.speakVietnamese("Cảm ơn nhé", "north", { ttsSource: "cloud-first" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledTimes(2);
    expect(audioService.getCloudCooldownRemainingSeconds()).toBeGreaterThan(0);

    const samplePhrases = [
      {
        id: "t2",
        category: "Coffee & Food" as const,
        english: "Hello",
        north: "Xin chào anh",
        central: "Xin chào anh",
        south: "Chào anh nha",
        phoneticNorth: "sin chow",
        phoneticCentral: "sin chow",
        phoneticSouth: "chow",
        textbook: "Xin chào",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const packProgress = await audioService.downloadOfflineAudioPack(samplePhrases, ["north"]);
    expect(packProgress.rateLimited).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("scales cloud audio playbackRate and browser speech rate from 10% to 100%", async () => {
    const { audioInstances, utterances } = setupBrowserAudioMocks([
      { voiceURI: "vi-south", name: "Mai Saigon", lang: "vi-VN", localService: true },
    ]);
    vi.stubGlobal("navigator", { onLine: true });

    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakWithSettings("Cảm ơn nhiều nha", "south", {
      playbackSpeed: 50,
      preferredViVoiceURI: "vi-south",
      ttsSource: "cloud-first",
      ttsVoiceProfile: "auto",
    });

    expect(audioInstances[0]?.playbackRate).toBeCloseTo(
      computePlaybackPacing(50, { baseClipIsSlow: true }).vowelRate,
      2,
    );
    expect(audioInstances[0]?.preservesPitch).toBe(true);

    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsedBody = JSON.parse(
      typeof callArgs[1].body === "string" ? callArgs[1].body : "{}",
    ) as {
      slow: boolean;
    };
    expect(parsedBody.slow).toBe(true);

    await audioService.speakWithSettings("Chào", "south", {
      playbackSpeed: 10,
      preferredViVoiceURI: "vi-south",
      ttsSource: "device-only",
    });
    expect(utterances[0]?.rate).toBeCloseTo(computePlaybackPacing(10).deviceTtsRate, 2);
  });

  it("time-stretches PCM audio down to 10% speed without silence or NaNs", () => {
    const sampleRate = 24000;
    const durationSec = 0.25;
    const input = new Float32Array(Math.round(sampleRate * durationSec));
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.4 * Math.sin((2 * Math.PI * 180 * i) / sampleRate);
    }

    const stretchedUniformTen = stretchAudioChannelData(input, sampleRate, 0.1, {
      mode: "uniform",
    });
    expect(stretchedUniformTen.length).toBeGreaterThan(input.length * 8);
    expect(stretchedUniformTen.length).toBeLessThan(input.length * 12);

    const stretchedIntelligibleTen = stretchAudioChannelData(input, sampleRate, 0.1);
    const expectedCappedLen = input.length / computePlaybackPacing(10).vowelRate;
    expect(stretchedIntelligibleTen.length).toBeGreaterThan(expectedCappedLen * 0.88);
    expect(stretchedIntelligibleTen.length).toBeLessThan(expectedCappedLen * 1.15);

    let maxAmp = 0;
    for (const sample of stretchedIntelligibleTen) {
      expect(Number.isFinite(sample)).toBe(true);
      maxAmp = Math.max(maxAmp, Math.abs(sample));
    }
    expect(maxAmp).toBeGreaterThan(0.15);

    const unchanged = stretchAudioChannelData(input, sampleRate, 1);
    expect(unchanged.length).toBe(input.length);
  });

  it("normalizes playbackSpeed between 10 and 100 and migrates legacy slowVietnamese", () => {
    expect(normalizePlaybackSpeed(5)).toBe(10);
    expect(normalizePlaybackSpeed(140)).toBe(100);
    expect(normalizePlaybackSpeed(42.6)).toBe(43);
    expect(normalizePlaybackSpeed(Number.NaN)).toBe(100);

    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });

    store.set("noi_vietnamese_settings_v1", JSON.stringify({ slowVietnamese: true }));
    expect(loadSettings().playbackSpeed).toBe(70);

    store.set("noi_vietnamese_settings_v1", JSON.stringify({ playbackSpeed: 35 }));
    expect(loadSettings().playbackSpeed).toBe(35);
  });

  it("preserves pitch, RMS stability, and headroom across 10% to 90% speeds", () => {
    const sampleRate = 24000;
    const durationSec = 0.4;
    const freqHz = 110;
    const input = new Float32Array(Math.round(sampleRate * durationSec));
    for (let i = 0; i < input.length; i++) {
      input[i] =
        0.72 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate) +
        0.24 * Math.sin((2 * Math.PI * freqHz * 2 * i) / sampleRate);
    }

    const measurePeakAndFreq = (samples: Float32Array) => {
      let maxAbs = 0;
      let hasNonFinite = false;
      let zeroCrossings = 0;
      const startBody = Math.floor(samples.length * 0.15);
      const endBody = Math.floor(samples.length * 0.85);

      for (let i = 0; i < samples.length; i++) {
        const s = samples[i] ?? 0;
        if (!Number.isFinite(s)) hasNonFinite = true;
        maxAbs = Math.max(maxAbs, Math.abs(s));
        const prev = samples[i - 1] ?? 0;
        if (i > startBody && i < endBody && ((prev < 0 && s >= 0) || (prev >= 0 && s < 0))) {
          zeroCrossings++;
        }
      }
      const measuredFreq = zeroCrossings / 2 / ((endBody - startBody) / sampleRate);
      return { maxAbs, hasNonFinite, measuredFreq, startBody, endBody };
    };

    const measureChunkRmsBounds = (samples: Float32Array, startBody: number, endBody: number) => {
      const chunkLen = Math.round(sampleRate * 0.04);
      let minRms = Number.POSITIVE_INFINITY;
      let maxRms = 0;
      for (let offset = startBody; offset + chunkLen < endBody; offset += chunkLen) {
        let sumSq = 0;
        for (let k = 0; k < chunkLen; k++) {
          const v = samples[offset + k] ?? 0;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / chunkLen);
        minRms = Math.min(minRms, rms);
        maxRms = Math.max(maxRms, rms);
      }
      return { minRms, maxRms };
    };

    for (const speed of [0.1, 0.25, 0.5, 0.65, 0.75, 0.9]) {
      const stretched = stretchAudioChannelData(input, sampleRate, speed, { mode: "uniform" });
      const expectedLen = input.length / speed;
      expect(stretched.length).toBeGreaterThan(expectedLen * 0.9);
      expect(stretched.length).toBeLessThan(expectedLen * 1.1);

      const metrics = measurePeakAndFreq(stretched);
      const rms = measureChunkRmsBounds(stretched, metrics.startBody, metrics.endBody);
      expect(metrics.hasNonFinite).toBe(false);
      expect(metrics.maxAbs).toBeLessThanOrEqual(0.995);
      expect(metrics.maxAbs).toBeGreaterThan(0.5);
      expect(metrics.measuredFreq).toBeGreaterThan(freqHz * 0.95);
      expect(metrics.measuredFreq).toBeLessThan(freqHz * 1.05);
      expect(rms.minRms).toBeGreaterThan(rms.maxRms * 0.8);
    }
  });

  it("keeps stereo channels phase-coherent when time-stretching", () => {
    const sampleRate = 24000;
    const len = Math.round(sampleRate * 0.3);
    const left = new Float32Array(len);
    const right = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const val = 0.5 * Math.sin((2 * Math.PI * 165 * i) / sampleRate);
      left[i] = val;
      right[i] = val * 0.8;
    }

    const [outL, outR] = stretchAudioChannels([left, right], sampleRate, 0.55);
    expect(outL?.length).toBeGreaterThan(0);
    expect(outR?.length).toBe(outL?.length);

    if (outL && outR) {
      for (let i = 500; i < outL.length - 500; i += 25) {
        const l = outL[i] ?? 0;
        const r = outR[i] ?? 0;
        expect(Math.abs(r - l * 0.8)).toBeLessThan(1e-4);
      }
    }
  });

  it("uses Web Audio WSOLA for slowed cloud playback when AudioContext is available and 100% natively", async () => {
    const { audioInstances } = setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });

    const sampleRate = 24000;
    const pcmLen = Math.round(sampleRate * 0.25);
    const pcmData = new Float32Array(pcmLen);
    for (let i = 0; i < pcmLen; i++) {
      pcmData[i] = 0.4 * Math.sin((2 * Math.PI * 180 * i) / sampleRate);
    }

    const createdBufferLengths: number[] = [];
    const activeSources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

    class MockAudioBuffer {
      readonly numberOfChannels: number;
      readonly length: number;
      readonly sampleRate: number;
      readonly duration: number;
      private readonly channels: Float32Array[];

      constructor(numberOfChannels: number, length: number, sr: number) {
        this.numberOfChannels = numberOfChannels;
        this.length = length;
        this.sampleRate = sr;
        this.duration = length / sr;
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      }

      getChannelData(channel: number): Float32Array {
        return this.channels[channel] ?? new Float32Array(this.length);
      }

      copyToChannel(source: Float32Array, channel: number): void {
        this.channels[channel]?.set(source.subarray(0, this.length));
      }
    }

    class MockAudioContext {
      readonly sampleRate = sampleRate;
      readonly state = "running";
      currentTime = 0;
      readonly destination = {};

      async resume(): Promise<void> {
        await Promise.resolve();
      }

      async decodeAudioData(): Promise<MockAudioBuffer> {
        await Promise.resolve();
        const buf = new MockAudioBuffer(1, pcmLen, sampleRate);
        buf.copyToChannel(pcmData, 0);
        return buf;
      }

      createBuffer(channels: number, length: number, sr: number): MockAudioBuffer {
        createdBufferLengths.push(length);
        return new MockAudioBuffer(channels, length, sr);
      }

      createGain() {
        return {
          gain: {
            value: 1,
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }

      createBufferSource() {
        const node = {
          buffer: null as MockAudioBuffer | null,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          stop: vi.fn(),
          start: vi.fn(() => {
            queueMicrotask(() => {
              node.onended?.();
            });
          }),
        };
        activeSources.push(node);
        return node;
      }
    }

    vi.stubGlobal("AudioContext", MockAudioContext);

    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakWithSettings("Xin chào nha", "south", {
      playbackSpeed: 40,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
      ttsVoiceProfile: "auto",
    });

    // At 40%, Web Audio residual stretching runs on the native slow clip instead of HTMLAudioElement.playbackRate
    expect(activeSources).toHaveLength(1);
    expect(audioInstances).toHaveLength(0);
    expect(createdBufferLengths[0]).toBeGreaterThan(pcmLen * 1.08);

    // At 70%, native slow clip plays directly via HTMLAudioElement without DSP stretching
    await audioService.speakWithSettings("Xin chào nha", "south", {
      playbackSpeed: 70,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
      ttsVoiceProfile: "auto",
    });
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0]?.playbackRate).toBe(1);

    // At 100%, normal clip plays natively via HTMLAudioElement without stretching
    await audioService.speakWithSettings("Xin chào nha", "south", {
      playbackSpeed: 100,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
      ttsVoiceProfile: "auto",
    });
    expect(audioInstances).toHaveLength(2);
    expect(audioInstances[1]?.playbackRate).toBe(1);
  });

  it("stretches decaying gliding tonal contours without waveform discontinuities", () => {
    const sampleRate = 24000;
    const len = Math.round(sampleRate * 0.5);
    const input = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const f0 = 140 + 220 * t;
      const env = Math.exp(-t * 5) * Math.min(1, t / 0.02);
      phase += (2 * Math.PI * f0) / sampleRate;
      input[i] =
        env * (0.55 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(4 * phase));
    }

    const measureMaxJerkRatio = (samples: Float32Array): number => {
      let peak = 0;
      for (let i = 150; i < samples.length - 150; i++) {
        let sumSq = 0;
        for (let k = -80; k <= 80; k++) {
          const val = samples[i + k] ?? 0;
          sumSq += val * val;
        }
        const localRms = Math.sqrt(sumSq / 161);
        if (localRms < 0.02) continue;
        const d2 = Math.abs((samples[i + 1] ?? 0) - 2 * (samples[i] ?? 0) + (samples[i - 1] ?? 0));
        peak = Math.max(peak, d2 / localRms);
      }
      return peak;
    };

    const origJerk = measureMaxJerkRatio(input);
    for (const speed of [0.85, 0.7, 0.5, 0.25]) {
      const stretched = stretchAudioChannelData(input, sampleRate, speed);
      expect(measureMaxJerkRatio(stretched)).toBeLessThan(origJerk * 1.4);
    }
  });

  it("avoids introducing periodic metallic buzz into slowed unvoiced fricatives", () => {
    const sampleRate = 24000;
    const len = Math.round(sampleRate * 0.3);
    const input = new Float32Array(len);
    let seed = 987654321;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 0xffffffff) * 2 - 1;
      input[i] = 0.25 * (white - 0.7 * prev);
      prev = white;
    }

    const measureMaxPeriodicCorr = (samples: Float32Array): number => {
      const start = Math.floor(samples.length * 0.2);
      const span = Math.floor(samples.length * 0.5);
      let refE = 0;
      for (let i = 0; i < span; i++) {
        const s = samples[start + i] ?? 0;
        refE += s * s;
      }
      let maxCorr = 0;
      const minLag = Math.round(sampleRate / 120);
      const maxLag = Math.round(sampleRate / 20);
      for (let lag = minLag; lag <= maxLag; lag += 4) {
        let cross = 0;
        let candE = 0;
        for (let i = 0; i < span; i++) {
          const a = samples[start + i] ?? 0;
          const b = samples[start + i + lag] ?? 0;
          cross += a * b;
          candE += b * b;
        }
        maxCorr = Math.max(maxCorr, Math.abs(cross) / Math.sqrt(Math.max(1e-12, refE * candE)));
      }
      return maxCorr;
    };

    for (const speed of [0.75, 0.5, 0.25]) {
      const stretched = stretchAudioChannelData(input, sampleRate, speed);
      expect(measureMaxPeriodicCorr(stretched)).toBeLessThan(0.2);
    }
  });

  it("avoids high-frequency static crackles and 62.5Hz chopping buzz at 48kHz across low speeds", () => {
    const sampleRate = 48000;
    const len = Math.round(sampleRate * 0.45);
    const input = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const f0 = 165 + 95 * Math.sin(2 * Math.PI * 1.4 * t);
      const env = Math.min(1, t / 0.02) * Math.min(1, (0.45 - t) / 0.02);
      phase += (2 * Math.PI * f0) / sampleRate;
      // Speech-like rich harmonics spanning fundamental through 3.5 kHz formants
      input[i] =
        env *
        (0.42 * Math.sin(phase) +
          0.25 * Math.sin(2 * phase + 0.3) +
          0.14 * Math.sin(5 * phase + 0.9) +
          0.1 * Math.sin(11 * phase + 1.4) +
          0.07 * Math.sin(17 * phase + 2.1));
    }

    const computeHfRmsFrames = (samples: Float32Array): number[] => {
      // High-pass via second difference to isolate >2 kHz harmonic energy & crackle transients
      const bodyStart = Math.floor(samples.length * 0.12);
      const bodyEnd = Math.floor(samples.length * 0.88);
      const winLen = Math.round(sampleRate * 0.008);
      const hop = Math.round(sampleRate * 0.004);
      const frames: number[] = [];

      for (let pos = bodyStart; pos + winLen < bodyEnd; pos += hop) {
        let sumSq = 0;
        for (let k = 1; k < winLen - 1; k++) {
          const d2 =
            (samples[pos + k + 1] ?? 0) - 2 * (samples[pos + k] ?? 0) + (samples[pos + k - 1] ?? 0);
          sumSq += d2 * d2;
        }
        frames.push(Math.sqrt(sumSq / Math.max(1, winLen - 2)));
      }
      return frames;
    };

    const measureHfStability = (samples: Float32Array) => {
      const hfRmsFrames = computeHfRmsFrames(samples);
      let crackleCount = 0;
      let chopDipCount = 0;
      let worstDeviation = 0;
      for (let i = 1; i < hfRmsFrames.length - 1; i++) {
        const cur = hfRmsFrames[i] ?? 0;
        const neighborAvg = 0.5 * ((hfRmsFrames[i - 1] ?? 0) + (hfRmsFrames[i + 1] ?? 0));
        if (neighborAvg <= 1e-4) continue;
        const ratio = cur / neighborAvg;
        worstDeviation = Math.max(worstDeviation, Math.abs(ratio - 1));
        if (ratio > 1.35) crackleCount++;
        if (ratio < 0.72) chopDipCount++;
      }
      return { crackleCount, chopDipCount, worstDeviation };
    };

    for (const speed of [0.85, 0.7, 0.5, 0.3, 0.15]) {
      const stretched = stretchAudioChannelData(input, sampleRate, speed, { mode: "uniform" });
      const expectedLen = input.length / speed;
      expect(stretched.length).toBeGreaterThan(expectedLen * 0.92);
      expect(stretched.length).toBeLessThan(expectedLen * 1.08);

      const { crackleCount, chopDipCount, worstDeviation } = measureHfStability(stretched);
      expect(crackleCount).toBe(0);
      expect(chopDipCount).toBe(0);
      expect(worstDeviation).toBeLessThan(0.25);
    }
  });

  it("parses server availability and cachedClips from /api/tts/status", async () => {
    setupBrowserAudioMocks([]);
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(JSON.stringify({ available: true, cachedClips: 18 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await audioService.checkCloudTtsStatus();
    expect(status).toEqual({ available: true, cachedClips: 18 });
  });

  it("rejects non-audio HTML/JSON error payloads from /api/tts and falls back locally", async () => {
    const { playSpy, speakSpy } = setupBrowserAudioMocks([
      { voiceURI: "vi-south", name: "Mai Saigon", lang: "vi-VN", localService: true },
    ]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response("<!doctype html><html><body>502 Bad Gateway</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakVietnamese("Xin chào nhé", "south", {
      ttsSource: "cloud-first",
    });

    expect(playSpy).not.toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it("retries transient offline pack clip failures once and reports failedCount on persistent errors", async () => {
    setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "Temporary unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (calls === 2) {
        return new Response(new Blob([new Uint8Array([9, 8, 7])], { type: "audio/wav" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "Still failing" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const samplePhrases = [
      {
        id: "retry-unique-1",
        category: "Coffee & Food" as const,
        english: "Beef noodle soup",
        north: "Phở bò tái chín",
        central: "Bún bò Huế đặc biệt",
        south: "Hủ tiếu Nam Vang nha",
        phoneticNorth: "fuh baw",
        phoneticCentral: "boon baw",
        phoneticSouth: "hoo tee-oo",
        textbook: "Phở bò",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const progress = await audioService.downloadOfflineAudioPack(samplePhrases, ["north", "south"]);
    expect(progress.cachedCount).toBe(1);
    expect(progress.failedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("falls back synchronously when async time-stretch Worker times out", async () => {
    const terminateSpy = vi.fn();
    class StalledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage = vi.fn();
      terminate = terminateSpy;
    }
    vi.stubGlobal("Worker", StalledWorker);

    const { stretchAudioChannelsAsync } = await import("./audioTimeStretchAsync");
    const sampleRate = 24000;
    const pcm = new Float32Array(2400);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 0.3 * Math.sin((2 * Math.PI * 160 * i) / sampleRate);
    }

    const result = await stretchAudioChannelsAsync([pcm], sampleRate, 0.7, 25);
    expect(result).toHaveLength(1);
    expect(result[0]?.length).toBeGreaterThan(pcm.length);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts pack downloads and surfaces quotaExceeded when CacheStorage rejects writes", async () => {
    setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("caches", {
      open: vi.fn(async () => {
        await Promise.resolve();
        return {
          match: vi.fn(async () => {
            await Promise.resolve();
            return undefined;
          }),
          put: vi.fn(async () => {
            await Promise.resolve();
            throw new DOMException("Storage quota exceeded", "QuotaExceededError");
          }),
        };
      }),
    });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([9, 8, 7])], { type: "audio/wav" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const samplePhrases = [
      {
        id: "quota-test-1",
        category: "Coffee & Food" as const,
        english: "Water",
        north: "Nước lọc ạ",
        central: "Nước lọc nha",
        south: "Nước suối nha",
        phoneticNorth: "nook lok",
        phoneticCentral: "nook lok",
        phoneticSouth: "nook soo-ee",
        textbook: "Nước suối",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const progress = await audioService.downloadOfflineAudioPack(samplePhrases, ["north", "south"]);
    expect(progress.quotaExceeded).toBe(true);
    expect(progress.cachedCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests native slow cloud speech and plays untouched at 70% via speakSlowWithSettings", async () => {
    expect(getSlowPlaybackSpeed(100)).toBe(70);
    expect(getSlowPlaybackSpeed(60)).toBe(42);
    expect(getSlowPlaybackSpeed(12)).toBe(10);

    const { audioInstances } = setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await audioService.speakSlowWithSettings("Tính tiền nha", "south", {
      playbackSpeed: 100,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
      ttsVoiceProfile: "auto",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsedBody = JSON.parse(
      typeof callArgs[1].body === "string" ? callArgs[1].body : "{}",
    ) as { slow: boolean };
    expect(parsedBody.slow).toBe(true);
    // Native slow recording plays cleanly at 1.0x with zero DSP slow-motion stretching
    expect(audioInstances[0]?.playbackRate).toBe(1);
  });

  it("evicts oldest memory and CacheStorage entries on capacity and QuotaExceededError", async () => {
    const store = new TtsCacheStore();
    for (let i = 0; i < 45; i++) {
      store.rememberBlob(
        `https://noi.local/tts?i=${String(i)}`,
        new Blob([new Uint8Array([1, 2, 3])]),
      );
    }
    expect(store.hasInMemory("https://noi.local/tts?i=0")).toBe(false);
    expect(store.hasInMemory("https://noi.local/tts?i=44")).toBe(true);

    const cacheMap = new Map<string, Response>();
    cacheMap.set("https://noi.local/tts?old=1", new Response(new Uint8Array([1, 2, 3])));
    let putCount = 0;

    vi.stubGlobal("caches", {
      delete: vi.fn(async () => Promise.resolve(true)),
      open: vi.fn(async () => {
        await Promise.resolve();
        return {
          keys: vi.fn(async () => {
            await Promise.resolve();
            return Array.from(cacheMap.keys(), (url) => ({ url }) as Request);
          }),
          match: vi.fn(async (url: string) => {
            await Promise.resolve();
            return cacheMap.get(url);
          }),
          delete: vi.fn(async (req: Request | string) => {
            await Promise.resolve();
            const key = typeof req === "string" ? req : req.url;
            return cacheMap.delete(key);
          }),
          put: vi.fn(async (url: string, res: Response) => {
            await Promise.resolve();
            putCount += 1;
            if (putCount === 1) {
              throw new DOMException("Storage quota exceeded", "QuotaExceededError");
            }
            cacheMap.set(url, res);
          }),
        };
      }),
    });

    const outcome = await store.write(
      "https://noi.local/tts?new=1",
      new Blob([new Uint8Array([4, 5, 6])], { type: "audio/wav" }),
      true,
    );
    expect(outcome).toEqual({ persisted: true, quotaExceeded: false });
    expect(cacheMap.has("https://noi.local/tts?old=1")).toBe(false);
    expect(cacheMap.has("https://noi.local/tts?new=1")).toBe(true);
  });

  it("respects 402 billing cooldown, surfaces clean message, and aborts pack downloads", async () => {
    setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(
        JSON.stringify({
          error:
            "Vietnamese cloud voice credits are depleted. Manage billing in AI Studio or use an on-device voice or Tone Melody.",
          retryAfterSeconds: 300,
        }),
        {
          status: 402,
          headers: { "Content-Type": "application/json", "Retry-After": "300" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const statuses: SpeakingStatus[] = [];
    const unsub = audioService.subscribe((s) => {
      statuses.push(s);
    });

    await audioService.speakVietnamese("Xin chào nhé", "south", { ttsSource: "cloud-first" });
    await audioService.speakVietnamese("Cảm ơn nhé", "south", { ttsSource: "cloud-first" });
    unsub();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)?.audioError).toContain("credits are depleted");
    expect(audioService.getCloudCooldownRemainingSeconds()).toBeGreaterThan(60);

    const samplePhrases = [
      {
        id: "t402",
        category: "Coffee & Food" as const,
        english: "Hello",
        north: "Xin chào anh",
        central: "Xin chào anh",
        south: "Chào anh nha",
        phoneticNorth: "sin chow",
        phoneticCentral: "sin chow",
        phoneticSouth: "chow",
        textbook: "Xin chào",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const packProgress = await audioService.downloadOfflineAudioPack(samplePhrases, ["south"]);
    expect(packProgress.cloudUnavailableMessage).toContain("credits are depleted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers via watchdog timeout when HTMLAudioElement stalls without ending", async () => {
    vi.useFakeTimers();
    const pauseSpy = vi.fn();

    class StalledAudio {
      src: string;
      playbackRate = 1;
      preservesPitch = false;
      duration = 0.5;
      onplaying: (() => void) | null = null;
      onloadedmetadata: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = pauseSpy;

      constructor(src: string) {
        this.src = src;
      }

      async play(): Promise<void> {
        await Promise.resolve();
        this.onloadedmetadata?.();
        this.onplaying?.();
        // Deliberately never fire onended/onerror to simulate suspended mobile tab
      }
    }

    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      speechSynthesis: {
        getVoices: () => [],
        speak: vi.fn(),
        cancel: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("Audio", StalledAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:stalled"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
          status: 200,
        });
      }),
    );

    const statuses: SpeakingStatus[] = [];
    const unsub = audioService.subscribe((s) => {
      statuses.push(s);
    });

    const speakPromise = audioService.speakWithSettings("Chờ chút nha", "south", {
      playbackSpeed: 100,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await speakPromise;
    unsub();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)?.isSpeaking).toBe(false);
    vi.useRealTimers();
  });

  it("falls back to HTMLAudioElement when AudioContext remains suspended during slowed playback", async () => {
    const { audioInstances } = setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });

    class SuspendedAudioContext {
      readonly sampleRate = 24000;
      readonly state = "suspended";
      currentTime = 0;
      readonly destination = {};

      async resume(): Promise<void> {
        await Promise.resolve();
      }
    }

    vi.stubGlobal("AudioContext", SuspendedAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), {
          status: 200,
        });
      }),
    );

    await audioService.speakWithSettings("Chậm lại nhé", "north", {
      playbackSpeed: 45,
      preferredViVoiceURI: "",
      ttsSource: "cloud-first",
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0]?.playbackRate).toBeCloseTo(
      computePlaybackPacing(45, { baseClipIsSlow: true }).vowelRate,
      2,
    );
  });

  it("falls back synchronously when Worker postMessage throws synchronously", async () => {
    class BrokenPostWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage = vi.fn(() => {
        throw new Error("DataCloneError");
      });
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", BrokenPostWorker);

    const { stretchAudioChannelsAsync } = await import("./audioTimeStretchAsync");
    const sampleRate = 24000;
    const pcm = new Float32Array(2400);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 0.25 * Math.sin((2 * Math.PI * 160 * i) / sampleRate);
    }

    const result = await stretchAudioChannelsAsync([pcm], sampleRate, 0.7);
    expect(result).toHaveLength(1);
    expect(result[0]?.length).toBeGreaterThan(pcm.length);
  });

  it("does not emit bogus error when browser utterance times out after already starting", async () => {
    vi.useFakeTimers();
    class HangingStartedUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: FakeVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      speechSynthesis: {
        getVoices: () => [{ voiceURI: "vi-south", name: "Mai", lang: "vi-VN", localService: true }],
        speak: (u: HangingStartedUtterance) => {
          u.onstart?.();
        },
        cancel: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("SpeechSynthesisUtterance", HangingStartedUtterance);

    const statuses: SpeakingStatus[] = [];
    const unsub = audioService.subscribe((s) => {
      statuses.push(s);
    });

    const speakPromise = audioService.speakVietnamese("Xin chào nhé", "south", {
      ttsSource: "device-only",
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await speakPromise;
    unsub();

    expect(statuses.some((s) => s.audioError !== null)).toBe(false);
    expect(statuses.at(-1)?.isSpeaking).toBe(false);
    vi.useRealTimers();
  });

  it("fast-fails offline pack download on unconfigured cloud 503 and batches getPhraseAudioCacheStats with cache.keys", async () => {
    setupBrowserAudioMocks([]);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return new Response(
        JSON.stringify({
          error: "Regional Vietnamese cloud TTS is not configured on this server.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const samplePhrases = [
      {
        id: "unconf-1",
        category: "Coffee & Food" as const,
        english: "Hello",
        north: "Xin chào anh ơi",
        central: "Xin chào anh ơi",
        south: "Chào anh nha ơi",
        phoneticNorth: "sin chow",
        phoneticCentral: "sin chow",
        phoneticSouth: "chow",
        textbook: "Xin chào",
        streetNote: "Note",
        priority: 3 as const,
        sortOrder: 0,
      },
    ];

    const packProgress = await audioService.downloadOfflineAudioPack(samplePhrases, [
      "north",
      "south",
    ]);
    expect(packProgress.cloudUnavailableMessage).toContain("not configured");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const matchSpy = vi.fn();
    const keysSpy = vi.fn(async () => {
      await Promise.resolve();
      return [
        {
          url: "https://noi.local/tts?region=north&slow=0&voice=auto&text=Xin+ch%C3%A0o+anh+%C6%A1i",
        },
      ] as Request[];
    });
    vi.stubGlobal("caches", {
      delete: vi.fn(async () => Promise.resolve(true)),
      open: vi.fn(async () => {
        await Promise.resolve();
        return {
          keys: keysSpy,
          match: matchSpy,
        };
      }),
    });

    const stats = await audioService.getPhraseAudioCacheStats(samplePhrases, ["north", "south"]);
    expect(stats.totalCount).toBe(2);
    expect(stats.cachedCount).toBe(1);
    expect(keysSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it("waits for browser voiceschanged when voices load asynchronously and matches speaker profile", async () => {
    const utterances: { text: string; voice: FakeVoice | null; pitch: number }[] = [];
    let voices: FakeVoice[] = [];
    const listeners = new Set<() => void>();

    class AsyncVoiceUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: FakeVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      speechSynthesis: {
        getVoices: () => voices,
        speak: (u: AsyncVoiceUtterance) => {
          utterances.push({ text: u.text, voice: u.voice, pitch: u.pitch });
          u.onstart?.();
          u.onend?.();
        },
        cancel: vi.fn(),
        addEventListener: (_event: string, cb: () => void) => {
          listeners.add(cb);
        },
        removeEventListener: (_event: string, cb: () => void) => {
          listeners.delete(cb);
        },
      },
    });
    vi.stubGlobal("SpeechSynthesisUtterance", AsyncVoiceUtterance);
    vi.stubGlobal("navigator", { onLine: true });

    setTimeout(() => {
      voices = [
        {
          voiceURI: "ms-hoaimy",
          name: "Microsoft HoaiMy Online (Natural) - Vietnamese",
          lang: "vi-VN",
          localService: false,
        },
        {
          voiceURI: "ms-namminh",
          name: "Microsoft NamMinh Online (Natural) - Vietnamese",
          lang: "vi-VN",
          localService: false,
        },
      ];
      for (const cb of listeners) {
        cb();
      }
    }, 15);

    await audioService.speakVietnamese("Xin chào nhé", "north", {
      ttsSource: "device-only",
      ttsVoiceProfile: "male",
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0]?.voice?.voiceURI).toBe("ms-namminh");

    await audioService.speakVietnamese("Chào bạn nha", "south", {
      ttsSource: "device-only",
      ttsVoiceProfile: "female",
    });

    expect(utterances).toHaveLength(2);
    expect(utterances[1]?.voice?.voiceURI).toBe("ms-hoaimy");
  });
});
