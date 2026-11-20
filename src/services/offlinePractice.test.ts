import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeSpeakerMedianHz,
  detectPitchHz,
  evaluateAcousticToneMatch,
  normalizeSegmentContour,
  segmentVoicedSyllables,
  startOfflineAcousticSession,
} from "./offlineAcousticPractice";
import { startVietnameseRecognition } from "./speechRecognitionService";
import {
  approximateVietnamesePhonetic,
  detectSyllableTone,
  getPhraseToneSyllables,
  getRegionalToneContour,
  playVietnameseToneContour,
  stopToneContour,
} from "./toneAudioService";

describe("Offline Vietnamese tone audio & phonetic service", () => {
  it("detects all 6 Vietnamese tones accurately", () => {
    expect(detectSyllableTone("ba")).toBe("ngang");
    expect(detectSyllableTone("bà")).toBe("huyen");
    expect(detectSyllableTone("bá")).toBe("sac");
    expect(detectSyllableTone("bả")).toBe("hoi");
    expect(detectSyllableTone("bã")).toBe("nga");
    expect(detectSyllableTone("bạ")).toBe("nang");
  });

  it("models Northern 6-tone separation vs Southern/Central hỏi-ngã merger", () => {
    const northHoi = getRegionalToneContour("hoi", "north");
    const northNga = getRegionalToneContour("nga", "north");
    const southHoi = getRegionalToneContour("hoi", "south");
    const southNga = getRegionalToneContour("nga", "south");

    expect(northHoi).not.toEqual(northNga);
    expect(southHoi).toEqual(southNga);
  });

  it("extracts syllable tone sequence and regional phonetic guide offline", () => {
    const syllables = getPhraseToneSyllables("Tính tiền nha!", "south");
    expect(syllables.map((s) => s.syllable)).toEqual(["Tính", "tiền", "nha"]);
    expect(syllables.map((s) => s.tone)).toEqual(["sac", "huyen", "ngang"]);

    expect(approximateVietnamesePhonetic("gì", "south")).toBe("yee");
    expect(approximateVietnamesePhonetic("gì", "central")).toBe("yee");
    expect(approximateVietnamesePhonetic("gì", "north")).toBe("zee");

    expect(approximateVietnamesePhonetic("tính tiền", "south")).toBe("tin tee-en");
    expect(approximateVietnamesePhonetic("tính tiền", "north")).toBe("ting tee-en");

    expect(approximateVietnamesePhonetic("rồi", "south")).toBe("roy");
    expect(approximateVietnamesePhonetic("rồi", "north")).toBe("zoy");

    expect(approximateVietnamesePhonetic("về", "central")).toBe("veh");
    expect(approximateVietnamesePhonetic("về", "south")).toBe("yeh");

    expect(approximateVietnamesePhonetic("xin lỗi", "north")).toBe("sin loy");
    expect(approximateVietnamesePhonetic("bịch", "south")).toBe("bit");
    expect(approximateVietnamesePhonetic("bịch", "north")).toBe("bik");
    expect(approximateVietnamesePhonetic("xíu", "south")).toBe("see-oo");
    expect(approximateVietnamesePhonetic("Việt", "south")).toBe("vee-et");
    expect(approximateVietnamesePhonetic("trái", "south")).toBe("trai");
    expect(approximateVietnamesePhonetic("trái", "north")).toBe("chai");
  });
});

describe("Offline acoustic pitch & syllable practice engine", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("detects fundamental pitch frequency accurately across human voice range and rejects silence", () => {
    const sampleRate = 48000;
    for (const freq of [92, 145, 180, 240, 340]) {
      const buffer = new Float32Array(2048);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = 0.25 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const detected = detectPitchHz(buffer, sampleRate);
      expect(detected).not.toBeNull();
      if (detected !== null) {
        expect(Math.abs(detected - freq)).toBeLessThan(6);
      }
    }

    expect(detectPitchHz(new Float32Array(2048), sampleRate)).toBeNull();
  });

  it("segments voiced syllable bursts separated by silent pauses", () => {
    const samples = [
      { timeMs: 0, rms: 0.05, hz: 190 },
      { timeMs: 40, rms: 0.06, hz: 210 },
      { timeMs: 80, rms: 0.05, hz: 235 },
      { timeMs: 120, rms: 0.002, hz: null },
      { timeMs: 250, rms: 0.002, hz: null },
      { timeMs: 270, rms: 0.05, hz: 200 },
      { timeMs: 320, rms: 0.06, hz: 165 },
      { timeMs: 360, rms: 0.05, hz: 150 },
    ];

    const segments = segmentVoicedSyllables(samples);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.slope).toBeGreaterThan(0.1);
    expect(segments[1]?.slope).toBeLessThan(-0.1);

    const medianHz = computeSpeakerMedianHz(segments);
    expect(medianHz).toBeGreaterThan(180);
    expect(medianHz).toBeLessThan(220);

    const firstSegment = segments[0];
    expect(firstSegment).toBeDefined();
    if (firstSegment) {
      const normalized = normalizeSegmentContour(firstSegment, medianHz, 6);
      expect(normalized).toHaveLength(6);
      expect(normalized[5] ?? 0).toBeGreaterThan(normalized[0] ?? 1);
    }

    const evaluation = evaluateAcousticToneMatch("Tính tiền", segments, "south");
    expect(evaluation.accuracy).toBe(100);
    expect(evaluation.words.map((w) => w.status)).toEqual(["exact", "exact"]);
    expect(evaluation.words[0]?.measuredContour).toHaveLength(6);
    expect(evaluation.words[1]?.measuredContour).toHaveLength(6);
  });

  it("handles tone playback cancellation and unavailable microphone guards cleanly", async () => {
    expect(await playVietnameseToneContour("   ", "south")).toBe(false);
    expect(() => {
      stopToneContour();
    }).not.toThrow();

    let errorMsg = "";
    const stop = startOfflineAcousticSession("Xin chào", "south", {
      onLiveLevel: () => undefined,
      onComplete: () => undefined,
      onError: (msg) => {
        errorMsg = msg;
      },
    });
    expect(errorMsg).toContain("unavailable");
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it("aggregates finalized speech segments and emits no-speech on silent end", () => {
    const instances: {
      onresult: ((ev: { results: unknown }) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      abort: () => void;
    }[] = [];

    class FakeSpeechRecognition {
      lang = "";
      interimResults = false;
      maxAlternatives = 1;
      continuous = false;
      onresult: ((ev: { results: unknown }) => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();

      constructor() {
        instances.push(this);
      }
    }

    vi.stubGlobal("window", { webkitSpeechRecognition: FakeSpeechRecognition });

    const onResult = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    startVietnameseRecognition({
      onInterim: vi.fn(),
      onResult,
      onError,
      onEnd,
    });

    const firstInstance = instances[0];
    expect(firstInstance).toBeDefined();
    firstInstance?.onresult?.({
      results: {
        length: 2,
        0: { isFinal: true, length: 1, 0: { transcript: "Xin chào" } },
        1: {
          isFinal: true,
          length: 2,
          0: { transcript: "bạn" },
          1: { transcript: "anh" },
        },
      },
    });
    expect(onResult).toHaveBeenCalledWith(["Xin chào bạn", "Xin chào anh"]);
    expect(onEnd).toHaveBeenCalledTimes(1);

    const onErrorSilent = vi.fn();
    const onEndSilent = vi.fn();
    startVietnameseRecognition({
      onInterim: vi.fn(),
      onResult: vi.fn(),
      onError: onErrorSilent,
      onEnd: onEndSilent,
    });
    instances[1]?.onend?.();
    expect(onErrorSilent).toHaveBeenCalledWith(
      "no-speech",
      "No speech detected — tap the mic and speak clearly.",
    );
    expect(onEndSilent).toHaveBeenCalledTimes(1);
  });

  it("aborts cleanly and stops mic tracks when stopped before getUserMedia resolves", async () => {
    const trackStopSpy = vi.fn();
    const deferred: { resolve?: (stream: MediaStream) => void } = {};
    const getUserMediaSpy = vi.fn(
      async () =>
        await new Promise<MediaStream>((resolve) => {
          deferred.resolve = resolve;
        }),
    );

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: getUserMediaSpy },
    });
    vi.stubGlobal("window", {
      AudioContext: class FakeAudioContext {
        state = "running";
        sampleRate = 44100;
        resume = vi.fn(async () => {
          await Promise.resolve();
        });
      },
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    const onComplete = vi.fn();
    const onError = vi.fn();
    const stop = startOfflineAcousticSession("Xin chào", "south", {
      onLiveLevel: vi.fn(),
      onComplete,
      onError,
    });

    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

    stop();

    deferred.resolve?.({
      getTracks: () => [{ stop: trackStopSpy }],
    } as unknown as MediaStream);

    await Promise.resolve();
    await Promise.resolve();

    expect(trackStopSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("aborts tone playback cleanly when AudioContext stays suspended", async () => {
    vi.stubGlobal("window", {
      AudioContext: class SuspendedToneAudioContext {
        state = "suspended";
        sampleRate = 44100;
        currentTime = 0;
        resume = vi.fn(async () => {
          await Promise.resolve();
        });
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    const played = await playVietnameseToneContour("Xin chào", "south");
    expect(played).toBe(false);
  });

  it("finalizes acoustic session cleanly if the active microphone track ends unexpectedly", async () => {
    const trackListeners = new Map<string, () => void>();
    const trackStopSpy = vi.fn();

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          await Promise.resolve();
          return {
            getTracks: () => [
              {
                stop: trackStopSpy,
                addEventListener: (ev: string, cb: () => void) => {
                  trackListeners.set(ev, cb);
                },
                removeEventListener: (ev: string) => {
                  trackListeners.delete(ev);
                },
              },
            ],
          } as unknown as MediaStream;
        }),
      },
    });
    vi.stubGlobal("window", {
      AudioContext: class RunningMicAudioContext {
        state = "running";
        sampleRate = 44100;
        resume = vi.fn(async () => {
          await Promise.resolve();
        });
        createMediaStreamSource = vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }));
        createAnalyser = vi.fn(() => ({
          fftSize: 2048,
          connect: vi.fn(),
          disconnect: vi.fn(),
          getFloatTimeDomainData: vi.fn(),
        }));
      },
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    const onComplete = vi.fn();
    const onError = vi.fn();
    startOfflineAcousticSession("Xin chào", "south", {
      onLiveLevel: vi.fn(),
      onComplete,
      onError,
    });

    await new Promise((r) => setTimeout(r, 15));
    const endedHandler = trackListeners.get("ended");
    expect(endedHandler).toBeDefined();
    endedHandler?.();

    await new Promise((r) => setTimeout(r, 15));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(trackStopSpy).toHaveBeenCalled();
  });

  it("errors cleanly and stops mic tracks when AudioContext remains suspended on capture start", async () => {
    const trackStopSpy = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          await Promise.resolve();
          return {
            getTracks: () => [{ stop: trackStopSpy }],
          } as unknown as MediaStream;
        }),
      },
    });
    vi.stubGlobal("window", {
      AudioContext: class SuspendedMicAudioContext {
        state = "suspended";
        sampleRate = 44100;
        resume = vi.fn(async () => {
          await Promise.resolve();
        });
      },
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    const onComplete = vi.fn();
    const onError = vi.fn();
    startOfflineAcousticSession("Xin chào", "south", {
      onLiveLevel: vi.fn(),
      onComplete,
      onError,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(trackStopSpy).toHaveBeenCalledTimes(1);
  });
});
