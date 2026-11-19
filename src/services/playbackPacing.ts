import {
  DEFAULT_PLAYBACK_SPEED,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
} from "../types/vietnamese";

export const VOWEL_RATE_FLOOR = 0.6;
export const CONSONANT_RATE_FLOOR = 0.84;
export const NATIVE_SLOW_SPEED_THRESHOLD = 75;
export const NATIVE_SLOW_ANCHOR_PERCENT = 68;
export const NATIVE_SLOW_VOWEL_RATE_FLOOR = 0.78;
export const NATIVE_SLOW_CONSONANT_RATE_FLOOR = 0.9;
export const MAX_VALLEY_PAUSE_MS = 560;
export const NATIVE_SLOW_MAX_VALLEY_PAUSE_MS = 440;
export const MAX_SILENCE_SCALE = 2.1;
export const MAX_EXPANDED_SILENCE_MS = 820;
export const BASE_TONE_NOTE_SEC = 0.24;
export const BASE_TONE_GAP_SEC = 0.065;
const DEVICE_TTS_TURNAROUND_MS = 110;

export type DeviceTtsChunkMode = "phrase" | "pair" | "syllable";

export interface PlaybackPacingOptions {
  readonly baseClipIsSlow?: boolean | undefined;
}

export interface PlaybackPacingProfile {
  readonly speedPercent: number;
  readonly slowdownIntensity: number;
  readonly vowelRate: number;
  readonly consonantRate: number;
  readonly valleyPauseMs: number;
  readonly silenceScale: number;
  readonly maxExpandedSilenceMs: number;
  readonly toneNoteSec: number;
  readonly toneGapSec: number;
  readonly deviceTtsRate: number;
  readonly deviceChunkMode: DeviceTtsChunkMode;
  readonly deviceChunkPauseMs: number;
  readonly paceLabel: string;
}

export function clampPlaybackSpeedPercent(speedPercent: number): number {
  if (!Number.isFinite(speedPercent)) return DEFAULT_PLAYBACK_SPEED;
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, Math.round(speedPercent)));
}

export function speedFactorToPercent(speedFactor: number): number {
  if (!Number.isFinite(speedFactor)) return DEFAULT_PLAYBACK_SPEED;
  return clampPlaybackSpeedPercent(speedFactor * 100);
}

export function shouldUseNativeSlowClip(speedPercent: number): boolean {
  return clampPlaybackSpeedPercent(speedPercent) <= NATIVE_SLOW_SPEED_THRESHOLD;
}

export function getSmartPaceLabel(speedPercent: number): string {
  const clamped = clampPlaybackSpeedPercent(speedPercent);
  if (clamped >= 95) return "Normal";
  if (clamped >= 70) return "Clear slow";
  if (clamped >= 45) return "Spaced words";
  if (clamped >= 25) return "Syllable-paced";
  return "Ultra spaced";
}

function resolveDeviceChunkMode(speedPercent: number): DeviceTtsChunkMode {
  if (speedPercent >= 55) return "phrase";
  if (speedPercent >= 30) return "pair";
  return "syllable";
}

function computeResidualStretchFromNativeSlow(clamped: number): {
  vowelRate: number;
  consonantRate: number;
  valleyPauseMs: number;
  silenceScale: number;
} {
  if (clamped >= NATIVE_SLOW_ANCHOR_PERCENT) {
    return {
      vowelRate: 1,
      consonantRate: 1,
      valleyPauseMs: 0,
      silenceScale: 1,
    };
  }
  const span = Math.max(1, NATIVE_SLOW_ANCHOR_PERCENT - MIN_PLAYBACK_SPEED);
  const subIntensity = Math.min(1, Math.max(0, (NATIVE_SLOW_ANCHOR_PERCENT - clamped) / span));
  const remaining = Math.max(0, 1 - subIntensity);
  return {
    vowelRate:
      NATIVE_SLOW_VOWEL_RATE_FLOOR + (1 - NATIVE_SLOW_VOWEL_RATE_FLOOR) * remaining ** 1.45,
    consonantRate:
      NATIVE_SLOW_CONSONANT_RATE_FLOOR + (1 - NATIVE_SLOW_CONSONANT_RATE_FLOOR) * remaining ** 1.25,
    valleyPauseMs: Math.round(NATIVE_SLOW_MAX_VALLEY_PAUSE_MS * subIntensity ** 1.65),
    silenceScale: 1 + 0.9 * subIntensity ** 1.4,
  };
}

export function computePlaybackPacing(
  speedPercent: number,
  options?: PlaybackPacingOptions,
): PlaybackPacingProfile {
  const clamped = clampPlaybackSpeedPercent(speedPercent);
  const span = MAX_PLAYBACK_SPEED - MIN_PLAYBACK_SPEED;
  const slowdownIntensity = span > 0 ? (MAX_PLAYBACK_SPEED - clamped) / span : 0;

  if (clamped >= 99) {
    return {
      speedPercent: clamped,
      slowdownIntensity: 0,
      vowelRate: 1,
      consonantRate: 1,
      valleyPauseMs: 0,
      silenceScale: 1,
      maxExpandedSilenceMs: MAX_EXPANDED_SILENCE_MS,
      toneNoteSec: BASE_TONE_NOTE_SEC,
      toneGapSec: BASE_TONE_GAP_SEC,
      deviceTtsRate: 1,
      deviceChunkMode: "phrase",
      deviceChunkPauseMs: 0,
      paceLabel: getSmartPaceLabel(clamped),
    };
  }

  const remaining = Math.max(0, 1 - slowdownIntensity);
  const baseVowelRate = VOWEL_RATE_FLOOR + (1 - VOWEL_RATE_FLOOR) * remaining ** 1.6;
  const baseConsonantRate = CONSONANT_RATE_FLOOR + (1 - CONSONANT_RATE_FLOOR) * remaining ** 1.3;
  const baseValleyPauseMs = Math.round(MAX_VALLEY_PAUSE_MS * slowdownIntensity ** 1.75);
  const baseSilenceScale = 1 + (MAX_SILENCE_SCALE - 1) * slowdownIntensity ** 1.5;

  const deviceTtsRate = Number(baseVowelRate.toFixed(2));
  const deviceChunkMode = resolveDeviceChunkMode(clamped);
  const deviceChunkPauseMs =
    deviceChunkMode === "phrase"
      ? 0
      : Math.max(80, Math.round(baseValleyPauseMs - DEVICE_TTS_TURNAROUND_MS));

  const clipStretch =
    options?.baseClipIsSlow === true
      ? computeResidualStretchFromNativeSlow(clamped)
      : {
          vowelRate: baseVowelRate,
          consonantRate: baseConsonantRate,
          valleyPauseMs: baseValleyPauseMs,
          silenceScale: baseSilenceScale,
        };

  return {
    speedPercent: clamped,
    slowdownIntensity,
    vowelRate: clipStretch.vowelRate,
    consonantRate: clipStretch.consonantRate,
    valleyPauseMs: clipStretch.valleyPauseMs,
    silenceScale: clipStretch.silenceScale,
    maxExpandedSilenceMs: MAX_EXPANDED_SILENCE_MS,
    toneNoteSec: BASE_TONE_NOTE_SEC / baseVowelRate,
    toneGapSec: BASE_TONE_GAP_SEC + baseValleyPauseMs / 1000,
    deviceTtsRate,
    deviceChunkMode,
    deviceChunkPauseMs,
    paceLabel: getSmartPaceLabel(clamped),
  };
}

function splitClauseIntoChunks(clause: string, mode: "pair" | "syllable"): string[] {
  const words = clause
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (words.length <= 1) return words;
  if (mode === "syllable") return words;

  const pairs: string[] = [];
  for (let i = 0; i < words.length; i += 2) {
    const first = words[i];
    const second = words[i + 1];
    if (first === undefined) continue;
    pairs.push(second !== undefined ? `${first} ${second}` : first);
  }
  return pairs;
}

export function splitVietnameseSpeechChunks(text: string, mode: DeviceTtsChunkMode): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (mode === "phrase") return [trimmed];

  // Respect explicit clause separators (commas, semicolons, slashes, sentence stops) before pairing
  const clauses = trimmed
    .split(/(?<=[,;:.!?])\s+|\s+\/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  for (const clause of clauses) {
    chunks.push(...splitClauseIntoChunks(clause, mode));
  }
  return chunks.length > 0 ? chunks : [trimmed];
}

export function countVietnameseSyllables(text: string): number {
  const cleaned = text.replace(/\//g, " ").trim();
  if (!cleaned) return 0;
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 0);
  return tokens.length;
}
