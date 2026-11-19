import type { PlaybackPacingProfile } from "../playbackPacing";

export interface StretchTimelineMap {
  readonly inSamples: Uint32Array;
  readonly outSamples: Uint32Array;
  readonly inputLength: number;
  readonly outputLength: number;
}

export interface SpeechValleyBoundary {
  readonly cutSample: number;
  readonly insertSilenceSamples: number;
  readonly isTrueSilence: boolean;
  readonly depth: number;
}

export interface SpeechSegmentationPlan {
  readonly speechStartSample: number;
  readonly speechEndSample: number;
  readonly boundaries: SpeechValleyBoundary[];
  readonly speechFloorRms: number;
}

interface EnvelopeAnalysis {
  readonly smoothedRms: Float32Array;
  readonly hopSamples: number;
  readonly winSamples: number;
  readonly peakRms: number;
}

interface CandidateBoundary {
  readonly cutSample: number;
  readonly insertMs: number;
  readonly isTrueSilence: boolean;
  readonly depth: number;
}

const ENV_WINDOW_SEC = 0.036;
const ENV_HOP_SEC = 0.005;
const SPEECH_EDGE_MARGIN_SEC = 0.02;
const DEFAULT_EDGE_GUARD_SEC = 0.16;
const MIN_SPEECH_FOR_VALLEYS_SEC = 0.34;
// 20ms of smoothed silence after the 36ms RMS window + 5-tap kernel corresponds to ~55-60ms raw silence
const MIN_SILENCE_RUN_SEC = 0.02;
const VALLEY_LOOK_SEC = 0.16;
const DEFAULT_MIN_VALLEY_SEPARATION_SEC = 0.22;
const MIN_VALLEY_DEPTH = 0.8;
const MAX_CONNECTED_VALLEY_REL_RMS = 0.12;
const MAX_CONNECTED_TROUGH_AVG_REL_RMS = 0.15;
const MIN_CONNECTED_VALLEY_PAUSE_MS = 90;
const MAX_CONNECTED_VALLEY_INSERT_MS = 260;
const VALLEY_SNAP_HALF_WINDOW_SEC = 0.005;

export interface SpeechSegmentationOptions {
  readonly expectedSyllableCount?: number | undefined;
}

export function createIdentityTimelineMap(length: number): StretchTimelineMap {
  const safeLen = Math.max(0, Math.round(length));
  return {
    inSamples: new Uint32Array([0, safeLen]),
    outSamples: new Uint32Array([0, safeLen]),
    inputLength: safeLen,
    outputLength: safeLen,
  };
}

function interpolateMonotonic(
  keys: Uint32Array,
  values: Uint32Array,
  target: number,
  maxValue: number,
): number {
  const count = Math.min(keys.length, values.length);
  if (count === 0) return 0;
  if (target <= (keys[0] ?? 0)) return values[0] ?? 0;
  const lastIdx = count - 1;
  if (target >= (keys[lastIdx] ?? 0)) return Math.min(maxValue, values[lastIdx] ?? maxValue);

  let lo = 0;
  let hi = lastIdx;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if ((keys[mid] ?? 0) <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const k0 = keys[lo] ?? 0;
  const k1 = keys[hi] ?? k0;
  const v0 = values[lo] ?? 0;
  const v1 = values[hi] ?? v0;
  if (k1 <= k0) return Math.min(maxValue, v0);
  const ratio = (target - k0) / (k1 - k0);
  return Math.max(0, Math.min(maxValue, Math.round(v0 + ratio * (v1 - v0))));
}

export function mapOutputSampleToInputSample(
  timeline: StretchTimelineMap,
  outSample: number,
): number {
  return interpolateMonotonic(
    timeline.outSamples,
    timeline.inSamples,
    outSample,
    timeline.inputLength,
  );
}

export function mapInputSampleToOutputSample(
  timeline: StretchTimelineMap,
  inSample: number,
): number {
  return interpolateMonotonic(
    timeline.inSamples,
    timeline.outSamples,
    inSample,
    timeline.outputLength,
  );
}

function computePercentileRms(values: Float32Array, percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentile)));
  return sorted[idx] ?? 0;
}

function computeSmoothedEnvelope(guide: Float32Array, sampleRate: number): EnvelopeAnalysis {
  const winSamples = Math.max(16, Math.round(sampleRate * ENV_WINDOW_SEC));
  const hopSamples = Math.max(8, Math.round(sampleRate * ENV_HOP_SEC));
  const frameCount = Math.max(1, Math.floor((guide.length - 1) / hopSamples) + 1);
  const rawRms = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const center = f * hopSamples;
    const start = Math.max(0, center - (winSamples >> 1));
    const end = Math.min(guide.length, start + winSamples);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = guide[i] ?? 0;
      sumSq += s * s;
    }
    const count = Math.max(1, end - start);
    rawRms[f] = Math.sqrt(sumSq / count);
  }

  // 5-tap smoothing bridges brief intra-syllable glottal creaks (nặng / ngã tones)
  const smoothedRms = new Float32Array(frameCount);
  const last = frameCount - 1;
  for (let f = 0; f < frameCount; f++) {
    const m2 = rawRms[Math.max(0, f - 2)] ?? 0;
    const m1 = rawRms[Math.max(0, f - 1)] ?? 0;
    const c0 = rawRms[f] ?? 0;
    const p1 = rawRms[Math.min(last, f + 1)] ?? 0;
    const p2 = rawRms[Math.min(last, f + 2)] ?? 0;
    smoothedRms[f] = 0.1 * m2 + 0.2 * m1 + 0.4 * c0 + 0.2 * p1 + 0.1 * p2;
  }

  const peakRms = computePercentileRms(smoothedRms, 0.98);
  return { smoothedRms, hopSamples, winSamples, peakRms };
}

function findSpeechBounds(
  env: EnvelopeAnalysis,
  inputLen: number,
  sampleRate: number,
  speechFloorRms: number,
): { speechStartSample: number; speechEndSample: number } {
  const { smoothedRms, hopSamples } = env;
  let firstActive = -1;
  let lastActive = -1;

  for (let f = 0; f < smoothedRms.length; f++) {
    if ((smoothedRms[f] ?? 0) >= speechFloorRms) {
      if (firstActive < 0) firstActive = f;
      lastActive = f;
    }
  }

  if (firstActive < 0 || lastActive < 0) {
    return { speechStartSample: 0, speechEndSample: inputLen };
  }

  const marginSamples = Math.round(sampleRate * SPEECH_EDGE_MARGIN_SEC);
  const speechStartSample = Math.max(0, firstActive * hopSamples - marginSamples);
  const speechEndSample = Math.min(inputLen, lastActive * hopSamples + marginSamples);
  return { speechStartSample, speechEndSample };
}

function snapCutToLowestAmplitude(
  guide: Float32Array,
  approxSample: number,
  sampleRate: number,
): number {
  const halfWin = Math.max(1, Math.round(sampleRate * VALLEY_SNAP_HALF_WINDOW_SEC));
  const lo = Math.max(0, approxSample - halfWin);
  const hi = Math.min(guide.length - 1, approxSample + halfWin);
  let bestIdx = approxSample;
  let bestAbs = Number.POSITIVE_INFINITY;

  for (let i = lo; i <= hi; i++) {
    const amp = Math.abs(guide[i] ?? 0);
    if (amp < bestAbs) {
      bestAbs = amp;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function collectInteriorSilenceCandidates(
  env: EnvelopeAnalysis,
  startFrame: number,
  endFrame: number,
  silenceFloorRms: number,
  sampleRate: number,
  pacing: PlaybackPacingProfile,
): CandidateBoundary[] {
  const { smoothedRms, hopSamples } = env;
  const minRunFrames = Math.max(4, Math.round((MIN_SILENCE_RUN_SEC * sampleRate) / hopSamples));
  const candidates: CandidateBoundary[] = [];

  let runStart = -1;
  for (let f = startFrame; f <= endFrame; f++) {
    const isSilent = (smoothedRms[f] ?? 0) <= silenceFloorRms;
    if (isSilent && runStart < 0) {
      runStart = f;
    } else if ((!isSilent || f === endFrame) && runStart >= 0) {
      const runEnd = isSilent ? f : f - 1;
      const runFrames = runEnd - runStart + 1;
      if (runFrames >= minRunFrames) {
        const origGapMs = (runFrames * hopSamples * 1000) / sampleRate + ENV_WINDOW_SEC * 1000;
        const desiredExtraMs = Math.max(
          pacing.valleyPauseMs * 0.7,
          origGapMs * (pacing.silenceScale - 1) + pacing.valleyPauseMs * 0.85,
        );
        const maxExtraMs = Math.max(0, pacing.maxExpandedSilenceMs - origGapMs);
        const insertMs = Math.round(Math.min(desiredExtraMs, maxExtraMs));
        if (insertMs >= 15) {
          const centerFrame = (runStart + runEnd) >> 1;
          candidates.push({
            cutSample: centerFrame * hopSamples,
            insertMs,
            isTrueSilence: true,
            depth: 1,
          });
        }
      }
      runStart = -1;
    }
  }

  return candidates;
}

function findWindowPeak(rms: Float32Array, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i <= to; i++) {
    const val = rms[i] ?? 0;
    if (val > peak) peak = val;
  }
  return peak;
}

function isDeepSustainedTrough(
  smoothedRms: Float32Array,
  f: number,
  silenceFloorRms: number,
  maxValleyRms: number,
  maxTroughAvgRms: number,
): boolean {
  const cur = smoothedRms[f] ?? 0;
  if (cur <= silenceFloorRms || cur >= maxValleyRms) return false;
  const prev = smoothedRms[f - 1] ?? 0;
  const next = smoothedRms[f + 1] ?? 0;
  if (cur > prev || cur > next || (cur === prev && cur === next)) return false;
  return (prev + cur + next) / 3 <= maxTroughAvgRms;
}

function collectConnectedValleyCandidates(
  env: EnvelopeAnalysis,
  startFrame: number,
  endFrame: number,
  silenceFloorRms: number,
  sampleRate: number,
  pacing: PlaybackPacingProfile,
): CandidateBoundary[] {
  const { smoothedRms, hopSamples, peakRms } = env;
  const lookFrames = Math.max(4, Math.round((VALLEY_LOOK_SEC * sampleRate) / hopSamples));
  const minPeakThreshold = peakRms * 0.24;
  const maxValleyRms = peakRms * MAX_CONNECTED_VALLEY_REL_RMS;
  const maxTroughAvgRms = peakRms * MAX_CONNECTED_TROUGH_AVG_REL_RMS;
  const candidates: CandidateBoundary[] = [];

  for (let f = Math.max(2, startFrame); f <= Math.min(smoothedRms.length - 3, endFrame); f++) {
    if (!isDeepSustainedTrough(smoothedRms, f, silenceFloorRms, maxValleyRms, maxTroughAvgRms)) {
      continue;
    }

    const leftPeak = findWindowPeak(smoothedRms, Math.max(0, f - lookFrames), f - 2);
    const rightPeak = findWindowPeak(
      smoothedRms,
      f + 2,
      Math.min(smoothedRms.length - 1, f + lookFrames),
    );
    if (leftPeak < minPeakThreshold || rightPeak < minPeakThreshold) continue;

    const minSide = Math.min(leftPeak, rightPeak);
    const depth = 1 - (smoothedRms[f] ?? 0) / minSide;
    if (depth < MIN_VALLEY_DEPTH) continue;

    const prominenceWeight =
      0.38 + 0.2 * Math.min(1, (depth - MIN_VALLEY_DEPTH) / (1 - MIN_VALLEY_DEPTH));
    const insertMs = Math.min(
      MAX_CONNECTED_VALLEY_INSERT_MS,
      Math.round(pacing.valleyPauseMs * prominenceWeight),
    );
    if (insertMs >= 20) {
      candidates.push({
        cutSample: f * hopSamples,
        insertMs,
        isTrueSilence: false,
        depth,
      });
    }
  }

  return candidates;
}

function resolveBoundarySpacingGuards(
  activeDurationSec: number,
  expectedSyllableCount?: number,
): { maxBoundaries: number; minSepSec: number; edgeGuardSec: number } {
  if (expectedSyllableCount === undefined || !Number.isFinite(expectedSyllableCount)) {
    return {
      maxBoundaries: Number.POSITIVE_INFINITY,
      minSepSec: DEFAULT_MIN_VALLEY_SEPARATION_SEC,
      edgeGuardSec: DEFAULT_EDGE_GUARD_SEC,
    };
  }
  const count = Math.max(0, Math.round(expectedSyllableCount));
  if (count <= 1) {
    return {
      maxBoundaries: 0,
      minSepSec: DEFAULT_MIN_VALLEY_SEPARATION_SEC,
      edgeGuardSec: DEFAULT_EDGE_GUARD_SEC,
    };
  }
  const avgSyllableSec = activeDurationSec / count;
  return {
    maxBoundaries: count - 1,
    minSepSec: Math.max(0.2, Math.min(0.45, avgSyllableSec * 0.65)),
    edgeGuardSec: Math.max(0.15, Math.min(0.32, avgSyllableSec * 0.55)),
  };
}

function selectSpacedBoundaries(
  candidates: CandidateBoundary[],
  guide: Float32Array,
  sampleRate: number,
  minSepSec: number,
  maxBoundaries: number,
): SpeechValleyBoundary[] {
  if (candidates.length === 0 || maxBoundaries <= 0) return [];

  const minSepSamples = Math.round(sampleRate * minSepSec);
  const prioritized = [...candidates].sort((a, b) => {
    if (a.isTrueSilence !== b.isTrueSilence) return a.isTrueSilence ? -1 : 1;
    return b.depth - a.depth;
  });

  const kept: CandidateBoundary[] = [];
  for (const cand of prioritized) {
    if (kept.length >= maxBoundaries) break;
    const tooClose = kept.some(
      (other) => Math.abs(other.cutSample - cand.cutSample) < minSepSamples,
    );
    if (!tooClose) {
      kept.push(cand);
    }
  }

  return kept
    .sort((a, b) => a.cutSample - b.cutSample)
    .map((cand) => ({
      cutSample: snapCutToLowestAmplitude(guide, cand.cutSample, sampleRate),
      insertSilenceSamples: Math.max(0, Math.round((cand.insertMs / 1000) * sampleRate)),
      isTrueSilence: cand.isTrueSilence,
      depth: cand.depth,
    }));
}

export function analyzeSpeechSegmentation(
  guide: Float32Array,
  sampleRate: number,
  pacing: PlaybackPacingProfile,
  options?: SpeechSegmentationOptions,
): SpeechSegmentationPlan {
  if (guide.length === 0 || sampleRate <= 0) {
    return {
      speechStartSample: 0,
      speechEndSample: guide.length,
      boundaries: [],
      speechFloorRms: 0,
    };
  }

  const env = computeSmoothedEnvelope(guide, sampleRate);
  if (env.peakRms < 1e-4) {
    return {
      speechStartSample: 0,
      speechEndSample: guide.length,
      boundaries: [],
      speechFloorRms: 0,
    };
  }

  const speechFloorRms = env.peakRms * 0.08;
  const silenceFloorRms = env.peakRms * 0.06;
  const { speechStartSample, speechEndSample } = findSpeechBounds(
    env,
    guide.length,
    sampleRate,
    speechFloorRms,
  );

  const activeDurationSec = (speechEndSample - speechStartSample) / sampleRate;
  const { maxBoundaries, minSepSec, edgeGuardSec } = resolveBoundarySpacingGuards(
    activeDurationSec,
    options?.expectedSyllableCount,
  );
  if (
    maxBoundaries <= 0 ||
    pacing.valleyPauseMs < 15 ||
    activeDurationSec < MIN_SPEECH_FOR_VALLEYS_SEC
  ) {
    return { speechStartSample, speechEndSample, boundaries: [], speechFloorRms };
  }

  const guardSamples = Math.round(sampleRate * edgeGuardSec);
  const startFrame = Math.ceil((speechStartSample + guardSamples) / env.hopSamples);
  const endFrame = Math.floor((speechEndSample - guardSamples) / env.hopSamples);
  if (endFrame <= startFrame + 2) {
    return { speechStartSample, speechEndSample, boundaries: [], speechFloorRms };
  }

  const silenceCandidates = collectInteriorSilenceCandidates(
    env,
    startFrame,
    endFrame,
    silenceFloorRms,
    sampleRate,
    pacing,
  );
  const valleyCandidates =
    pacing.valleyPauseMs >= MIN_CONNECTED_VALLEY_PAUSE_MS
      ? collectConnectedValleyCandidates(
          env,
          startFrame,
          endFrame,
          silenceFloorRms,
          sampleRate,
          pacing,
        )
      : [];
  const boundaries = selectSpacedBoundaries(
    [...silenceCandidates, ...valleyCandidates],
    guide,
    sampleRate,
    minSepSec,
    maxBoundaries,
  );

  return {
    speechStartSample,
    speechEndSample,
    boundaries,
    speechFloorRms,
  };
}
