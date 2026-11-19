import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeSpeechSegmentation,
  mapInputSampleToOutputSample,
  mapOutputSampleToInputSample,
} from "./audio/speechSegmentation";
import { audioService } from "./audioService";
import { stretchAudioChannelsWithMap } from "./audioTimeStretch";
import {
  CONSONANT_RATE_FLOOR,
  computePlaybackPacing,
  countVietnameseSyllables,
  getSmartPaceLabel,
  MAX_VALLEY_PAUSE_MS,
  NATIVE_SLOW_MAX_VALLEY_PAUSE_MS,
  NATIVE_SLOW_VOWEL_RATE_FLOOR,
  shouldUseNativeSlowClip,
  splitVietnameseSpeechChunks,
  VOWEL_RATE_FLOOR,
} from "./playbackPacing";
import { playVietnameseToneContour, stopToneContour } from "./toneAudioService";

function buildMultiSyllableSpeechSignal(sampleRate: number): {
  signal: Float32Array;
  leadingSilenceSamples: number;
  trailingSilenceSamples: number;
  syllableCount: number;
} {
  const leadingSec = 0.08;
  const trailingSec = 0.08;
  const syllableSec = 0.24;
  const valleySec = 0.07;
  const syllableCount = 3;
  const totalSec =
    leadingSec + syllableCount * syllableSec + (syllableCount - 1) * valleySec + trailingSec;
  const signal = new Float32Array(Math.round(sampleRate * totalSec));

  const leadingSamples = Math.round(sampleRate * leadingSec);
  const syllableSamples = Math.round(sampleRate * syllableSec);
  const valleySamples = Math.round(sampleRate * valleySec);
  const consonantSamples = Math.round(sampleRate * 0.035);
  let rng = 1234567;

  for (let s = 0; s < syllableCount; s++) {
    const start = leadingSamples + s * (syllableSamples + valleySamples);
    const f0 = 155 + s * 25;
    let phase = 0;

    for (let i = 0; i < syllableSamples; i++) {
      const idx = start + i;
      if (idx >= signal.length) break;
      const t = i / sampleRate;
      if (i < consonantSamples) {
        // Sharp unvoiced consonant onset burst
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        const white = (rng / 0xffffffff) * 2 - 1;
        const burstEnv = Math.sin((Math.PI * i) / consonantSamples);
        signal[idx] = 0.35 * burstEnv * white;
      } else {
        // Voiced tonal vowel nucleus
        const vIdx = i - consonantSamples;
        const vLen = syllableSamples - consonantSamples;
        const env =
          Math.min(1, vIdx / (sampleRate * 0.015)) *
          Math.min(1, (vLen - vIdx) / (sampleRate * 0.02));
        phase += (2 * Math.PI * (f0 + 30 * t)) / sampleRate;
        signal[idx] =
          env * (0.45 * Math.sin(phase) + 0.22 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
      }
    }

    // Connected shallow inter-syllable valley (non-zero low-energy transition)
    if (s < syllableCount - 1) {
      const vStart = start + syllableSamples;
      for (let i = 0; i < valleySamples; i++) {
        const idx = vStart + i;
        if (idx >= signal.length) break;
        const dip = 0.04 + 0.04 * Math.abs((2 * i) / valleySamples - 1);
        signal[idx] = dip * Math.sin((2 * Math.PI * 160 * i) / sampleRate);
      }
    }
  }

  return {
    signal,
    leadingSilenceSamples: leadingSamples,
    trailingSilenceSamples: Math.round(sampleRate * trailingSec),
    syllableCount,
  };
}

describe("playbackPacing curve & Vietnamese intelligibility DSP", () => {
  afterEach(() => {
    audioService.stop();
    stopToneContour();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("computes monotonic curved pacing with Vietnamese tone-safe floor and smart labels", () => {
    const speeds = [100, 90, 75, 60, 50, 35, 25, 10];
    const profiles = speeds.map((s) => computePlaybackPacing(s));

    for (let i = 1; i < profiles.length; i++) {
      const prev = profiles[i - 1];
      const cur = profiles[i];
      if (!prev || !cur) continue;
      expect(cur.vowelRate).toBeLessThanOrEqual(prev.vowelRate);
      expect(cur.consonantRate).toBeLessThanOrEqual(prev.consonantRate);
      expect(cur.valleyPauseMs).toBeGreaterThanOrEqual(prev.valleyPauseMs);
      expect(cur.toneNoteSec).toBeGreaterThanOrEqual(prev.toneNoteSec);
      expect(cur.toneGapSec).toBeGreaterThanOrEqual(prev.toneGapSec);
    }

    const p100 = computePlaybackPacing(100);
    expect(p100.vowelRate).toBe(1);
    expect(p100.consonantRate).toBe(1);
    expect(p100.valleyPauseMs).toBe(0);
    expect(p100.deviceChunkMode).toBe("phrase");

    const p75 = computePlaybackPacing(75);
    expect(p75.vowelRate).toBeGreaterThan(0.78);
    expect(p75.vowelRate).toBeLessThan(0.9);
    expect(p75.consonantRate).toBeGreaterThan(p75.vowelRate);
    expect(p75.valleyPauseMs).toBeGreaterThan(25);
    expect(p75.valleyPauseMs).toBeLessThan(100);

    const p10 = computePlaybackPacing(10);
    expect(p10.vowelRate).toBeCloseTo(VOWEL_RATE_FLOOR, 4);
    expect(p10.consonantRate).toBeCloseTo(CONSONANT_RATE_FLOOR, 4);
    expect(p10.valleyPauseMs).toBe(MAX_VALLEY_PAUSE_MS);
    expect(p10.deviceTtsRate).toBeCloseTo(VOWEL_RATE_FLOOR, 2);
    expect(p10.deviceChunkMode).toBe("syllable");
    expect(p10.toneNoteSec).toBeLessThan(0.45);
    expect(p10.toneGapSec).toBeGreaterThan(0.55);

    // Native slow clips play completely untouched at 68-75% and never stretch below 0.78x
    expect(shouldUseNativeSlowClip(80)).toBe(false);
    expect(shouldUseNativeSlowClip(75)).toBe(true);
    const nativeSlow70 = computePlaybackPacing(70, { baseClipIsSlow: true });
    expect(nativeSlow70.vowelRate).toBe(1);
    expect(nativeSlow70.valleyPauseMs).toBe(0);
    const nativeSlow10 = computePlaybackPacing(10, { baseClipIsSlow: true });
    expect(nativeSlow10.vowelRate).toBeCloseTo(NATIVE_SLOW_VOWEL_RATE_FLOOR, 4);
    expect(nativeSlow10.valleyPauseMs).toBe(NATIVE_SLOW_MAX_VALLEY_PAUSE_MS);

    expect(getSmartPaceLabel(100)).toBe("Normal");
    expect(getSmartPaceLabel(75)).toBe("Clear slow");
    expect(getSmartPaceLabel(50)).toBe("Spaced words");
    expect(getSmartPaceLabel(30)).toBe("Syllable-paced");
    expect(getSmartPaceLabel(10)).toBe("Ultra spaced");
  });

  it("splits Vietnamese phrases cleanly for phrase, pair, and syllable device TTS modes", () => {
    expect(splitVietnameseSpeechChunks("Cho tôi một ly cà phê", "phrase")).toEqual([
      "Cho tôi một ly cà phê",
    ]);
    expect(splitVietnameseSpeechChunks("Cho tôi một ly cà phê", "pair")).toEqual([
      "Cho tôi",
      "một ly",
      "cà phê",
    ]);
    expect(splitVietnameseSpeechChunks("Xin chào, bạn khỏe không?", "pair")).toEqual([
      "Xin chào,",
      "bạn khỏe",
      "không?",
    ]);
    expect(splitVietnameseSpeechChunks("Cà phê sữa đá", "syllable")).toEqual([
      "Cà",
      "phê",
      "sữa",
      "đá",
    ]);
    expect(splitVietnameseSpeechChunks("Cảm ơn", "syllable")).toEqual(["Cảm", "ơn"]);
    expect(splitVietnameseSpeechChunks("Chào", "syllable")).toEqual(["Chào"]);
    expect(countVietnameseSyllables("Cái này nhiêu vậy chị?")).toBe(5);
    expect(countVietnameseSyllables("Anh ơi! / Chị ơi!")).toBe(4);
    expect(countVietnameseSyllables("vậy")).toBe(1);
  });

  it("does not split glottalized nặng/ngã words like vậy internally alone or phrase-finally", () => {
    const sampleRate = 24000;
    const pacing10 = computePlaybackPacing(10);

    // Simulate a 420ms single glottalized diphthong word "vậy" with a 35ms creaky dip mid-syllable
    const soloLen = Math.round(sampleRate * 0.54);
    const solo = new Float32Array(soloLen);
    const start = Math.round(sampleRate * 0.06);
    const wordLen = Math.round(sampleRate * 0.42);
    const dipStart = Math.round(wordLen * 0.46);
    const dipEnd = dipStart + Math.round(sampleRate * 0.035);
    for (let i = 0; i < wordLen; i++) {
      const env = i >= dipStart && i < dipEnd ? 0.14 : 0.55;
      solo[start + i] = env * Math.sin((2 * Math.PI * 145 * i) / sampleRate);
    }

    // Even without syllable count hint, brief mid-word glottal creak must not trigger a split
    const soloPlanNoHint = analyzeSpeechSegmentation(solo, sampleRate, pacing10);
    expect(soloPlanNoHint.boundaries).toHaveLength(0);

    // Even a hard 30ms complete glottal closure (0 amplitude) inside a solo word must not split it
    const soloHardStop = new Float32Array(soloLen);
    const hardStopEnd = dipStart + Math.round(sampleRate * 0.03);
    for (let i = 0; i < wordLen; i++) {
      const env = i >= dipStart && i < hardStopEnd ? 0 : 0.55;
      soloHardStop[start + i] = env * Math.sin((2 * Math.PI * 145 * i) / sampleRate);
    }
    expect(analyzeSpeechSegmentation(soloHardStop, sampleRate, pacing10).boundaries).toHaveLength(
      0,
    );

    // With explicit expectedSyllableCount=1, single words are strictly never split
    const soloPlanHint = analyzeSpeechSegmentation(solo, sampleRate, pacing10, {
      expectedSyllableCount: 1,
    });
    expect(soloPlanHint.boundaries).toHaveLength(0);

    // Multi-word phrase ending in glottalized "vậy?" (e.g. "Đang làm gì vậy?"):
    // 3 true 65ms inter-word gaps + 1 internal 35ms creak inside the final word "vậy?"
    const phraseLen = Math.round(sampleRate * 1.4);
    const phrase = new Float32Array(phraseLen);
    const wordStarts = [0.06, 0.34, 0.62, 0.91];
    const wordDurs = [0.21, 0.21, 0.22, 0.4];
    wordStarts.forEach((ws, idx) => {
      const s0 = Math.round(ws * sampleRate);
      const durSamples = Math.round((wordDurs[idx] ?? 0.21) * sampleRate);
      const creakStart = Math.round(durSamples * 0.48);
      const creakEnd = creakStart + Math.round(0.035 * sampleRate);
      for (let i = 0; i < durSamples; i++) {
        const isFinalWordCreak = idx === 3 && i >= creakStart && i < creakEnd;
        const amp = isFinalWordCreak ? 0.1 : 0.5;
        phrase[s0 + i] = amp * Math.sin((2 * Math.PI * (150 + idx * 15) * i) / sampleRate);
      }
    });

    const phrasePlan = analyzeSpeechSegmentation(phrase, sampleRate, pacing10, {
      expectedSyllableCount: 4,
    });
    expect(phrasePlan.boundaries).toHaveLength(3);
    const finalWordStart = Math.round(0.91 * sampleRate);
    for (const b of phrasePlan.boundaries) {
      expect(b.cutSample).toBeLessThan(finalWordStart);
    }
  });

  it("detects inter-syllable energy valleys, protects consonants, and preserves timeline monotonicity", () => {
    const sampleRate = 24000;
    const { signal, leadingSilenceSamples } = buildMultiSyllableSpeechSignal(sampleRate);
    const pacing10 = computePlaybackPacing(10);

    const plan = analyzeSpeechSegmentation(signal, sampleRate, pacing10);
    expect(plan.boundaries.length).toBeGreaterThanOrEqual(2);
    expect(plan.speechStartSample).toBeGreaterThan(0);
    expect(plan.speechStartSample).toBeLessThanOrEqual(leadingSilenceSamples);

    // At moderate slow speed (75%), connected speech valleys are never sliced apart
    const plan75 = analyzeSpeechSegmentation(signal, sampleRate, computePlaybackPacing(75));
    expect(plan75.boundaries).toHaveLength(0);

    const stretched50 = stretchAudioChannelsWithMap([signal], sampleRate, 0.5);
    const stretched10 = stretchAudioChannelsWithMap([signal], sampleRate, 0.1);
    const out50 = stretched50.channels[0];
    const out10 = stretched10.channels[0];
    expect(out50).toBeDefined();
    expect(out10).toBeDefined();
    if (!out50 || !out10) return;

    // 10% adds larger valley pauses than 50% while staying well below naive 10x uniform bloat
    expect(out10.length).toBeGreaterThan(out50.length * 1.25);
    expect(out10.length).toBeLessThan(signal.length * 6);

    // Zero NaNs and safe soft-limited amplitude headroom
    let peakAmp = 0;
    for (const s of out10) {
      expect(Number.isFinite(s)).toBe(true);
      peakAmp = Math.max(peakAmp, Math.abs(s));
    }
    expect(peakAmp).toBeLessThanOrEqual(0.995);
    expect(peakAmp).toBeGreaterThan(0.2);

    // Leading silence is passed through without bloat
    const speechStartOut = mapInputSampleToOutputSample(
      stretched10.timeline,
      plan.speechStartSample,
    );
    expect(speechStartOut).toBeLessThanOrEqual(plan.speechStartSample + 16);

    // Timeline map is monotonically non-decreasing and round-trips active speech cleanly
    const { inSamples, outSamples } = stretched10.timeline;
    expect(inSamples.length).toBe(outSamples.length);
    for (let i = 1; i < inSamples.length; i++) {
      expect(inSamples[i]).toBeGreaterThanOrEqual(inSamples[i - 1] ?? 0);
      expect(outSamples[i]).toBeGreaterThanOrEqual(outSamples[i - 1] ?? 0);
    }

    const midIn = Math.floor(signal.length * 0.5);
    const midOut = mapInputSampleToOutputSample(stretched10.timeline, midIn);
    const roundTripIn = mapOutputSampleToInputSample(stretched10.timeline, midOut);
    expect(Math.abs(roundTripIn - midIn)).toBeLessThan(sampleRate * 0.03);
  });

  it("keeps stereo channels phase-coherent during intelligible NUTSM + valley stretching", () => {
    const sampleRate = 24000;
    const { signal } = buildMultiSyllableSpeechSignal(sampleRate);
    const right = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      right[i] = (signal[i] ?? 0) * 0.75;
    }

    const result = stretchAudioChannelsWithMap([signal, right], sampleRate, 0.25);
    const [outL, outR] = result.channels;
    expect(outL).toBeDefined();
    expect(outR).toBeDefined();
    expect(outL?.length).toBe(outR?.length);

    if (outL && outR) {
      for (let i = 200; i < outL.length - 200; i += 40) {
        expect(Math.abs((outR[i] ?? 0) - (outL[i] ?? 0) * 0.75)).toBeLessThan(1e-3);
      }
    }
  });

  it("syncs Tone Melody note length and inter-syllable gaps to the curved pacing profile", async () => {
    vi.useFakeTimers();
    const scheduledNotes: { start: number; stop: number }[] = [];

    class MockToneAudioContext {
      readonly state = "running";
      currentTime = 1;
      readonly destination = {};

      async resume(): Promise<void> {
        await Promise.resolve();
      }

      createOscillator() {
        const record = { start: 0, stop: 0 };
        return {
          type: "triangle",
          frequency: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
          },
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn((t: number) => {
            record.start = t;
          }),
          stop: vi.fn((t?: number) => {
            if (typeof t === "number") {
              record.stop = t;
              scheduledNotes.push(record);
            }
          }),
        };
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
    }

    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal("AudioContext", MockToneAudioContext);

    const playPromise = playVietnameseToneContour("Cà phê", "south", 10);
    await vi.advanceTimersByTimeAsync(5000);
    const ok = await playPromise;

    expect(ok).toBe(true);
    expect(scheduledNotes).toHaveLength(2);
    const pacing10 = computePlaybackPacing(10);
    const first = scheduledNotes[0];
    const second = scheduledNotes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first && second) {
      const noteDur = first.stop - first.start - 0.02;
      const stepSec = second.start - first.start;
      expect(noteDur).toBeCloseTo(pacing10.toneNoteSec, 2);
      expect(stepSec).toBeCloseTo(pacing10.toneNoteSec + pacing10.toneGapSec, 2);
    }
  });

  it("paces on-device browser TTS in chunks at low speeds and cancels cleanly on stop()", async () => {
    vi.useFakeTimers();

    class MockUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    const spoken: { text: string; rate: number }[] = [];
    const synthMock = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [
        {
          voiceURI: "vi-south",
          name: "Mai Saigon",
          lang: "vi-VN",
          localService: true,
        } as SpeechSynthesisVoice,
      ],
      speak: vi.fn((u: MockUtterance) => {
        spoken.push({ text: u.text, rate: u.rate });
        queueMicrotask(() => {
          u.onstart?.();
          u.onend?.();
        });
      }),
      cancel: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("window", {
      speechSynthesis: synthMock,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    const playPromise = audioService.speakWithSettings("Cà phê sữa đá", "south", {
      playbackSpeed: 20,
      preferredViVoiceURI: "vi-south",
      ttsSource: "device-only",
    });

    await vi.advanceTimersByTimeAsync(5000);
    await playPromise;

    const pacing20 = computePlaybackPacing(20);
    expect(spoken.map((item) => item.text)).toEqual(["Cà", "phê", "sữa", "đá"]);
    for (const item of spoken) {
      expect(item.rate).toBeCloseTo(pacing20.deviceTtsRate, 2);
      expect(item.rate).toBeGreaterThanOrEqual(VOWEL_RATE_FLOOR);
    }

    // Verify stop() interrupts between chunks immediately
    spoken.length = 0;
    const interruptedPromise = audioService.speakWithSettings("Cà phê sữa đá", "south", {
      playbackSpeed: 20,
      preferredViVoiceURI: "vi-south",
      ttsSource: "device-only",
    });
    await vi.advanceTimersByTimeAsync(50);
    audioService.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await interruptedPromise;
    expect(spoken.length).toBe(1);
  });
});
