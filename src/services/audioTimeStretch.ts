import {
  analyzeSpeechSegmentation,
  createIdentityTimelineMap,
  type StretchTimelineMap,
} from "./audio/speechSegmentation";
import { computePlaybackPacing, speedFactorToPercent } from "./playbackPacing";

const SOFT_LIMIT_THRESHOLD = 0.92;
const SOFT_LIMIT_HEADROOM = 0.07;
const TWO_PI = Math.PI * 2;
const PEAK_MIN_REL_MAG = 1e-3;
const TRANSIENT_MIN_ENERGY = 0.05;
const TRANSIENT_NORM_FLUX_THRESHOLD = 0.42;
const TRANSIENT_ENERGY_RATIO = 3.0;
const TRANSIENT_HF_ENERGY_RATIO = 4.5;
const TRANSIENT_HF_MIN_SHARE = 0.15;
const TRANSIENT_COOLDOWN_SEC = 0.04;
const UNVOICED_FLATNESS_THRESHOLD = 0.28;
const UNVOICED_LOW_CUT_HZ = 250;
const TRANSIENT_HF_HZ = 2500;
const MAX_IF_DEVIATION_BINS = 2.5;
const TRANSIENT_HOLD_SEC = 0.03;
const VALLEY_FADE_OUT_SEC = 0.03;
const VALLEY_FADE_IN_SEC = 0.014;
const MIN_EDGE_PASSTHROUGH_SEC = 0.025;

export type AudioStretchMode = "intelligible" | "uniform";

export interface StretchAudioOptions {
  readonly mode?: AudioStretchMode | undefined;
  readonly expectedSyllableCount?: number | undefined;
  readonly baseClipIsSlow?: boolean | undefined;
}

export interface StretchedAudioResult {
  readonly channels: Float32Array[];
  readonly timeline: StretchTimelineMap;
}

type FrameSpeechClass = "transient" | "unvoiced" | "voiced";

interface FftPlan {
  readonly size: number;
  readonly bitRev: Uint32Array;
  readonly cosTable: Float64Array;
  readonly sinTable: Float64Array;
}

interface VocoderTables {
  readonly fftSize: number;
  readonly halfSize: number;
  readonly fullFft: FftPlan;
  readonly halfFft: FftPlan;
  readonly window: Float64Array;
  readonly dWindow: Float64Array;
  readonly omega: Float64Array;
  readonly realIfftCos: Float64Array;
  readonly realIfftSin: Float64Array;
}

interface FrameAnalysis {
  readonly xRe: Float64Array;
  readonly xIm: Float64Array;
  readonly mag: Float64Array;
  readonly instFreq: Float64Array;
  readonly maxMag: number;
  readonly frameEnergy: number;
  readonly hfEnergy: number;
  readonly spectralFlatness: number;
}

interface PhaseVocoderState {
  readonly prevMag: Float64Array;
  readonly prevInstFreq: Float64Array;
  readonly prevSynPhase: Float64Array;
  readonly nextSynPhase: Float64Array;
  readonly rotCos: Float64Array;
  readonly rotSin: Float64Array;
  readonly prevPeaks: Int32Array;
  readonly curPeaks: Int32Array;
  prevPeakCount: number;
  prevEnergy: number;
  prevHfEnergy: number;
  lastTransientFrame: number;
  rngState: number;
}

interface WorkspaceBuffers {
  readonly fftRe: Float64Array;
  readonly fftIm: Float64Array;
  readonly zRe: Float64Array;
  readonly zIm: Float64Array;
  readonly rotRe: Float64Array;
  readonly rotIm: Float64Array;
  readonly chanRe: Float64Array;
  readonly chanIm: Float64Array;
  readonly chan2Re: Float64Array;
  readonly chan2Im: Float64Array;
}

const fftPlanCache = new Map<number, FftPlan>();
const vocoderTablesCache = new Map<number, VocoderTables>();

function getFftPlan(size: number): FftPlan {
  const cached = fftPlanCache.get(size);
  if (cached) return cached;

  const bits = Math.round(Math.log2(size));
  const bitRev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let rev = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
    bitRev[i] = rev;
  }

  const half = size >> 1;
  const cosTable = new Float64Array(half);
  const sinTable = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const angle = (TWO_PI * k) / size;
    cosTable[k] = Math.cos(angle);
    sinTable[k] = -Math.sin(angle);
  }

  const plan: FftPlan = { size, bitRev, cosTable, sinTable };
  fftPlanCache.set(size, plan);
  return plan;
}

function getVocoderTables(fftSize: number): VocoderTables {
  const cached = vocoderTablesCache.get(fftSize);
  if (cached) return cached;

  const halfSize = fftSize >> 1;
  const fullFft = getFftPlan(fftSize);
  const halfFft = getFftPlan(halfSize);
  const window = new Float64Array(fftSize);
  const dWindow = new Float64Array(fftSize);
  const dScale = Math.PI / fftSize;

  for (let i = 0; i < fftSize; i++) {
    const theta = (TWO_PI * (i + 0.5)) / fftSize;
    window[i] = 0.5 * (1 - Math.cos(theta));
    dWindow[i] = dScale * Math.sin(theta);
  }

  const omega = new Float64Array(halfSize + 1);
  for (let k = 0; k <= halfSize; k++) {
    omega[k] = (TWO_PI * k) / fftSize;
  }

  const realIfftCos = new Float64Array(halfSize);
  const realIfftSin = new Float64Array(halfSize);
  for (let k = 0; k < halfSize; k++) {
    const angle = (TWO_PI * k) / fftSize;
    realIfftCos[k] = Math.cos(angle);
    realIfftSin[k] = Math.sin(angle);
  }

  const tables: VocoderTables = {
    fftSize,
    halfSize,
    fullFft,
    halfFft,
    window,
    dWindow,
    omega,
    realIfftCos,
    realIfftSin,
  };
  vocoderTablesCache.set(fftSize, tables);
  return tables;
}

function bitReversePermute(
  re: Float64Array,
  im: Float64Array,
  bitRev: Uint32Array,
  size: number,
): void {
  for (let i = 0; i < size; i++) {
    const j = bitRev[i] ?? 0;
    if (i < j) {
      const tmpRe = re[i] ?? 0;
      const tmpIm = im[i] ?? 0;
      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = tmpRe;
      im[j] = tmpIm;
    }
  }
}

function runFftButterflyStage(
  re: Float64Array,
  im: Float64Array,
  plan: FftPlan,
  len: number,
  inverse: boolean,
): void {
  const { size, cosTable, sinTable } = plan;
  const half = len >> 1;
  const stride = size / len;
  const sign = inverse ? -1 : 1;

  for (let base = 0; base < size; base += len) {
    for (let k = 0; k < half; k++) {
      const twIdx = k * stride;
      const wr = cosTable[twIdx] ?? 1;
      const wi = sign * (sinTable[twIdx] ?? 0);
      const evenIdx = base + k;
      const oddIdx = evenIdx + half;
      const oddRe = re[oddIdx] ?? 0;
      const oddIm = im[oddIdx] ?? 0;
      const tRe = wr * oddRe - wi * oddIm;
      const tIm = wr * oddIm + wi * oddRe;
      const evenRe = re[evenIdx] ?? 0;
      const evenIm = im[evenIdx] ?? 0;
      re[evenIdx] = evenRe + tRe;
      im[evenIdx] = evenIm + tIm;
      re[oddIdx] = evenRe - tRe;
      im[oddIdx] = evenIm - tIm;
    }
  }
}

function fftInPlace(re: Float64Array, im: Float64Array, plan: FftPlan, inverse: boolean): void {
  const { size, bitRev } = plan;
  bitReversePermute(re, im, bitRev, size);

  for (let len = 2; len <= size; len <<= 1) {
    runFftButterflyStage(re, im, plan, len, inverse);
  }

  if (inverse) {
    const invSize = 1 / size;
    for (let i = 0; i < size; i++) {
      re[i] = (re[i] ?? 0) * invSize;
      im[i] = (im[i] ?? 0) * invSize;
    }
  }
}

function wrapPhase(angle: number): number {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  else if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

function selectFftSize(sampleRate: number): number {
  if (sampleRate < 32000) return 1024;
  if (sampleRate < 72000) return 2048;
  return 4096;
}

function buildPaddedChannel(
  input: Float32Array,
  fftSize: number,
  sampleRate: number,
): Float32Array {
  const half = fftSize >> 1;
  const padded = new Float32Array(input.length + fftSize * 2);
  padded.set(input, half);

  const edgeTaper = Math.min(Math.floor(input.length / 8), Math.round(sampleRate * 0.003));
  for (let i = 0; i < edgeTaper; i++) {
    const gain = 0.5 * (1 - Math.cos((Math.PI * (i + 0.5)) / edgeTaper));
    const headIdx = half + i;
    const tailIdx = half + input.length - 1 - i;
    padded[headIdx] = (padded[headIdx] ?? 0) * gain;
    padded[tailIdx] = (padded[tailIdx] ?? 0) * gain;
  }

  return padded;
}

function loadZeroPhaseGuideFft(
  paddedGuide: Float32Array,
  inStart: number,
  tables: VocoderTables,
  work: WorkspaceBuffers,
): void {
  const { fftSize, halfSize, fullFft, window, dWindow } = tables;
  const { fftRe, fftIm } = work;
  const mask = fftSize - 1;

  for (let i = 0; i < fftSize; i++) {
    const sample = paddedGuide[inStart + i] ?? 0;
    const dst = (i + halfSize) & mask;
    fftRe[dst] = sample * (window[i] ?? 0);
    fftIm[dst] = sample * (dWindow[i] ?? 0);
  }

  fftInPlace(fftRe, fftIm, fullFft, false);
}

function computeInstantaneousFrequency(
  re: number,
  im: number,
  dRe: number,
  dIm: number,
  magSq: number,
  baseOmega: number,
  maxDelta: number,
): number {
  if (magSq <= 1e-18) return baseOmega;
  const rawDelta = -(dIm * re - dRe * im) / magSq;
  const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
  return baseOmega + clampedDelta;
}

function analyzeGuideFrame(
  paddedGuide: Float32Array,
  inStart: number,
  tables: VocoderTables,
  work: WorkspaceBuffers,
  analysis: FrameAnalysis,
  hfStartBin: number,
  unvoicedStartBin: number,
): FrameAnalysis {
  const { fftSize, halfSize, omega } = tables;
  const { fftRe, fftIm } = work;
  const { xRe, xIm, mag, instFreq } = analysis;

  loadZeroPhaseGuideFft(paddedGuide, inStart, tables, work);

  const maxDelta = (TWO_PI * MAX_IF_DEVIATION_BINS) / fftSize;
  let maxMag = 0;
  let frameEnergy = 0;
  let hfEnergy = 0;
  let logPowerSum = 0;
  let arithPowerSum = 0;
  let flatnessCount = 0;

  const dcRe = fftRe[0] ?? 0;
  xRe[0] = dcRe;
  xIm[0] = 0;
  mag[0] = Math.abs(dcRe);
  instFreq[0] = 0;

  const nyqRe = fftRe[halfSize] ?? 0;
  xRe[halfSize] = nyqRe;
  xIm[halfSize] = 0;
  mag[halfSize] = Math.abs(nyqRe);
  instFreq[halfSize] = Math.PI;

  for (let k = 1; k < halfSize; k++) {
    const mk = fftSize - k;
    const fkRe = fftRe[k] ?? 0;
    const fkIm = fftIm[k] ?? 0;
    const fmkRe = fftRe[mk] ?? 0;
    const fmkIm = fftIm[mk] ?? 0;

    const re = 0.5 * (fkRe + fmkRe);
    const im = 0.5 * (fkIm - fmkIm);
    const dRe = 0.5 * (fkIm + fmkIm);
    const dIm = 0.5 * (fmkRe - fkRe);

    xRe[k] = re;
    xIm[k] = im;

    const magSq = re * re + im * im;
    const m = Math.sqrt(magSq);
    mag[k] = m;
    if (m > maxMag) maxMag = m;

    frameEnergy += magSq;
    if (k >= hfStartBin) hfEnergy += magSq;
    if (k >= unvoicedStartBin) {
      const p = magSq + 1e-18;
      logPowerSum += Math.log(p);
      arithPowerSum += p;
      flatnessCount++;
    }

    const baseOmega = omega[k] ?? 0;
    instFreq[k] = computeInstantaneousFrequency(re, im, dRe, dIm, magSq, baseOmega, maxDelta);
  }

  const invScale = 1 / fftSize;
  const scaledEnergy = frameEnergy * invScale;
  const scaledHfEnergy = hfEnergy * invScale;
  const meanArith = flatnessCount > 0 ? arithPowerSum / flatnessCount : 0;
  const spectralFlatness =
    flatnessCount > 0 && meanArith > 1e-16 ? Math.exp(logPowerSum / flatnessCount) / meanArith : 0;

  return {
    xRe,
    xIm,
    mag,
    instFreq,
    maxMag,
    frameEnergy: scaledEnergy,
    hfEnergy: scaledHfEnergy,
    spectralFlatness,
  };
}

function computeNormalizedFlux(mag: Float64Array, prevMag: Float64Array, halfSize: number): number {
  let flux = 0;
  let totalMag = 0;
  for (let k = 1; k < halfSize; k++) {
    const cur = mag[k] ?? 0;
    const prev = prevMag[k] ?? 0;
    if (cur > prev) flux += cur - prev;
    totalMag += cur;
  }
  return totalMag > 1e-9 ? flux / totalMag : 0;
}

function findSpectralPeaks(
  mag: Float64Array,
  maxMag: number,
  halfSize: number,
  peaksOut: Int32Array,
): number {
  const threshold = maxMag * PEAK_MIN_REL_MAG;
  let count = 0;
  for (let k = 1; k < halfSize; k++) {
    const m = mag[k] ?? 0;
    if (m > threshold && m >= (mag[k - 1] ?? 0) && m >= (mag[k + 1] ?? 0)) {
      peaksOut[count] = k;
      count++;
    }
  }
  return count;
}

function matchPreviousPeak(pk: number, prevPeaks: Int32Array, prevPeakCount: number): number {
  let bestBin = pk;
  let bestDist = 3;
  for (let i = 0; i < prevPeakCount; i++) {
    const prevBin = prevPeaks[i] ?? 0;
    const dist = Math.abs(prevBin - pk);
    if (dist < bestDist) {
      bestDist = dist;
      bestBin = prevBin;
      if (dist === 0) break;
    }
  }
  return bestBin;
}

function applyIdentityPhaseReset(
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  halfSize: number,
): void {
  const { xRe, xIm } = analysis;
  const { rotCos, rotSin, nextSynPhase } = state;
  for (let k = 0; k <= halfSize; k++) {
    rotCos[k] = 1;
    rotSin[k] = 0;
    nextSynPhase[k] = Math.atan2(xIm[k] ?? 0, xRe[k] ?? 0);
  }
}

function applyUnvoicedPhaseDecorrelation(
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  halfSize: number,
  synHop: number,
  unvoicedStartBin: number,
): void {
  const { xRe, xIm, instFreq } = analysis;
  const { prevInstFreq, prevSynPhase, nextSynPhase, rotCos, rotSin } = state;
  let rng = state.rngState;

  rotCos[0] = 1;
  rotSin[0] = 0;
  nextSynPhase[0] = 0;

  for (let k = 1; k < unvoicedStartBin; k++) {
    const anaPhase = Math.atan2(xIm[k] ?? 0, xRe[k] ?? 0);
    const avgOmega = 0.5 * ((prevInstFreq[k] ?? 0) + (instFreq[k] ?? 0));
    const synPhase = wrapPhase((prevSynPhase[k] ?? 0) + avgOmega * synHop);
    const delta = synPhase - anaPhase;
    rotCos[k] = Math.cos(delta);
    rotSin[k] = Math.sin(delta);
    nextSynPhase[k] = synPhase;
  }

  for (let k = unvoicedStartBin; k < halfSize; k++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    const randPhase = (rng / 0xffffffff) * TWO_PI - Math.PI;
    const anaPhase = Math.atan2(xIm[k] ?? 0, xRe[k] ?? 0);
    const delta = randPhase - anaPhase;
    rotCos[k] = Math.cos(delta);
    rotSin[k] = Math.sin(delta);
    nextSynPhase[k] = randPhase;
  }

  rotCos[halfSize] = 1;
  rotSin[halfSize] = 0;
  nextSynPhase[halfSize] = 0;
  state.rngState = rng;
}

function applyPerBinTrapezoidalPhases(
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  halfSize: number,
  synHop: number,
): void {
  const { xRe, xIm, instFreq } = analysis;
  const { prevInstFreq, prevSynPhase, nextSynPhase, rotCos, rotSin } = state;

  for (let k = 1; k < halfSize; k++) {
    const anaPhase = Math.atan2(xIm[k] ?? 0, xRe[k] ?? 0);
    const avgOmega = 0.5 * ((prevInstFreq[k] ?? 0) + (instFreq[k] ?? 0));
    const synPhase = wrapPhase((prevSynPhase[k] ?? 0) + avgOmega * synHop);
    const delta = synPhase - anaPhase;
    rotCos[k] = Math.cos(delta);
    rotSin[k] = Math.sin(delta);
    nextSynPhase[k] = synPhase;
  }
  rotCos[0] = 1;
  rotSin[0] = 0;
  nextSynPhase[0] = 0;
  rotCos[halfSize] = 1;
  rotSin[halfSize] = 0;
  nextSynPhase[halfSize] = 0;
}

function applyScaledIplPhases(
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  halfSize: number,
  synHop: number,
  peakCount: number,
): void {
  if (peakCount === 0) {
    applyPerBinTrapezoidalPhases(analysis, state, halfSize, synHop);
    return;
  }

  const { xRe, xIm, instFreq } = analysis;
  const { prevInstFreq, prevSynPhase, nextSynPhase, rotCos, rotSin, prevPeaks, curPeaks } = state;

  for (let p = 0; p < peakCount; p++) {
    const pk = curPeaks[p] ?? 1;
    const lo = p === 0 ? 1 : Math.floor(((curPeaks[p - 1] ?? 1) + pk) * 0.5) + 1;
    const hi =
      p === peakCount - 1 ? halfSize - 1 : Math.floor((pk + (curPeaks[p + 1] ?? halfSize)) * 0.5);

    const srcBin = matchPreviousPeak(pk, prevPeaks, state.prevPeakCount);
    const anaPhase = Math.atan2(xIm[pk] ?? 0, xRe[pk] ?? 0);
    const avgOmega = 0.5 * ((prevInstFreq[srcBin] ?? 0) + (instFreq[pk] ?? 0));
    const synPeakPhase = wrapPhase((prevSynPhase[srcBin] ?? 0) + avgOmega * synHop);
    const delta = synPeakPhase - anaPhase;
    const rc = Math.cos(delta);
    const rs = Math.sin(delta);

    for (let k = lo; k <= hi; k++) {
      rotCos[k] = rc;
      rotSin[k] = rs;
      nextSynPhase[k] = wrapPhase(Math.atan2(xIm[k] ?? 0, xRe[k] ?? 0) + delta);
    }
  }

  rotCos[0] = 1;
  rotSin[0] = 0;
  nextSynPhase[0] = 0;
  rotCos[halfSize] = 1;
  rotSin[halfSize] = 0;
  nextSynPhase[halfSize] = 0;
}

function updatePhaseStateForFrame(
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  frameIdx: number,
  halfSize: number,
  synHop: number,
  transientCooldownFrames: number,
  unvoicedStartBin: number,
): FrameSpeechClass {
  const peakCount = findSpectralPeaks(analysis.mag, analysis.maxMag, halfSize, state.curPeaks);
  let frameClass: FrameSpeechClass = "voiced";

  if (frameIdx === 0) {
    applyIdentityPhaseReset(analysis, state, halfSize);
  } else {
    const normFlux = computeNormalizedFlux(analysis.mag, state.prevMag, halfSize);
    const hasEnergySurge =
      analysis.frameEnergy > state.prevEnergy * TRANSIENT_ENERGY_RATIO ||
      (analysis.hfEnergy > state.prevHfEnergy * TRANSIENT_HF_ENERGY_RATIO &&
        analysis.hfEnergy > analysis.frameEnergy * TRANSIENT_HF_MIN_SHARE);
    const isTransient =
      frameIdx - state.lastTransientFrame >= transientCooldownFrames &&
      analysis.frameEnergy > TRANSIENT_MIN_ENERGY &&
      normFlux > TRANSIENT_NORM_FLUX_THRESHOLD &&
      hasEnergySurge;

    if (isTransient) {
      // Only hard-reset phase when rising from genuine quiet so overlapping voiced Hann frames never cancel mid-word
      if (state.prevEnergy < analysis.frameEnergy * 0.18) {
        applyIdentityPhaseReset(analysis, state, halfSize);
      } else {
        applyScaledIplPhases(analysis, state, halfSize, synHop, peakCount);
      }
      state.lastTransientFrame = frameIdx;
      frameClass = "transient";
    } else if (
      analysis.spectralFlatness > UNVOICED_FLATNESS_THRESHOLD &&
      analysis.frameEnergy > 1e-6
    ) {
      applyUnvoicedPhaseDecorrelation(analysis, state, halfSize, synHop, unvoicedStartBin);
      frameClass = "unvoiced";
    } else {
      applyScaledIplPhases(analysis, state, halfSize, synHop, peakCount);
    }
  }

  state.prevMag.set(analysis.mag);
  state.prevInstFreq.set(analysis.instFreq);
  state.prevSynPhase.set(state.nextSynPhase);
  state.prevPeaks.set(state.curPeaks.subarray(0, peakCount));
  state.prevPeakCount = peakCount;
  state.prevEnergy = analysis.frameEnergy;
  state.prevHfEnergy = analysis.hfEnergy;
  return frameClass;
}

function packHalfSizeRealIfft(tables: VocoderTables, work: WorkspaceBuffers): void {
  const { halfSize, realIfftCos, realIfftSin } = tables;
  const { rotRe, rotIm, zRe, zIm } = work;

  for (let k = 0; k < halfSize; k++) {
    const mk = halfSize - k;
    const xrK = rotRe[k] ?? 0;
    const xiK = rotIm[k] ?? 0;
    const xrMk = rotRe[mk] ?? 0;
    const xiMk = rotIm[mk] ?? 0;

    const er = 0.5 * (xrK + xrMk);
    const ei = 0.5 * (xiK - xiMk);
    const dr = 0.5 * (xrK - xrMk);
    const di = 0.5 * (xiK + xiMk);

    const c = realIfftCos[k] ?? 1;
    const s = realIfftSin[k] ?? 0;
    const or = dr * c - di * s;
    const oi = dr * s + di * c;

    zRe[k] = er - oi;
    zIm[k] = ei + or;
  }
}

function overlapAddShiftedHalfIfft(
  zRe: Float64Array,
  zIm: Float64Array,
  window: Float64Array,
  halfSize: number,
  outAccum: Float32Array,
  outPos: number,
): void {
  const quarter = halfSize >> 1;
  for (let n = 0; n < quarter; n++) {
    const evenDst = halfSize + (n << 1);
    const oddDst = evenDst + 1;
    outAccum[outPos + evenDst] =
      (outAccum[outPos + evenDst] ?? 0) + (zRe[n] ?? 0) * (window[evenDst] ?? 0);
    outAccum[outPos + oddDst] =
      (outAccum[outPos + oddDst] ?? 0) + (zIm[n] ?? 0) * (window[oddDst] ?? 0);
  }
  for (let n = quarter; n < halfSize; n++) {
    const evenDst = (n - quarter) << 1;
    const oddDst = evenDst + 1;
    outAccum[outPos + evenDst] =
      (outAccum[outPos + evenDst] ?? 0) + (zRe[n] ?? 0) * (window[evenDst] ?? 0);
    outAccum[outPos + oddDst] =
      (outAccum[outPos + oddDst] ?? 0) + (zIm[n] ?? 0) * (window[oddDst] ?? 0);
  }
}

function synthesizeRotatedSpectrumAndOverlapAdd(
  specRe: Float64Array,
  specIm: Float64Array,
  rotCos: Float64Array,
  rotSin: Float64Array,
  tables: VocoderTables,
  work: WorkspaceBuffers,
  outAccum: Float32Array,
  outPos: number,
): void {
  const { halfSize, halfFft, window } = tables;
  const { rotRe, rotIm, zRe, zIm } = work;

  rotRe[0] = specRe[0] ?? 0;
  rotIm[0] = 0;
  rotRe[halfSize] = specRe[halfSize] ?? 0;
  rotIm[halfSize] = 0;

  for (let k = 1; k < halfSize; k++) {
    const sr = specRe[k] ?? 0;
    const si = specIm[k] ?? 0;
    const rc = rotCos[k] ?? 1;
    const rs = rotSin[k] ?? 0;
    rotRe[k] = sr * rc - si * rs;
    rotIm[k] = sr * rs + si * rc;
  }

  packHalfSizeRealIfft(tables, work);
  fftInPlace(zRe, zIm, halfFft, true);
  overlapAddShiftedHalfIfft(zRe, zIm, window, halfSize, outAccum, outPos);
}

function analyzePairedChannels(
  chA: Float32Array,
  chB: Float32Array | null,
  inStart: number,
  tables: VocoderTables,
  work: WorkspaceBuffers,
): void {
  const { fftSize, halfSize, fullFft, window } = tables;
  const { fftRe, fftIm, chanRe, chanIm, chan2Re, chan2Im } = work;
  const mask = fftSize - 1;

  for (let i = 0; i < fftSize; i++) {
    const w = window[i] ?? 0;
    const dst = (i + halfSize) & mask;
    fftRe[dst] = (chA[inStart + i] ?? 0) * w;
    fftIm[dst] = chB ? (chB[inStart + i] ?? 0) * w : 0;
  }

  fftInPlace(fftRe, fftIm, fullFft, false);

  chanRe[0] = fftRe[0] ?? 0;
  chanIm[0] = 0;
  chanRe[halfSize] = fftRe[halfSize] ?? 0;
  chanIm[halfSize] = 0;

  if (chB) {
    chan2Re[0] = fftIm[0] ?? 0;
    chan2Im[0] = 0;
    chan2Re[halfSize] = fftIm[halfSize] ?? 0;
    chan2Im[halfSize] = 0;
  }

  for (let k = 1; k < halfSize; k++) {
    const mk = fftSize - k;
    const fkRe = fftRe[k] ?? 0;
    const fkIm = fftIm[k] ?? 0;
    const fmkRe = fftRe[mk] ?? 0;
    const fmkIm = fftIm[mk] ?? 0;

    chanRe[k] = 0.5 * (fkRe + fmkRe);
    chanIm[k] = 0.5 * (fkIm - fmkIm);
    if (chB) {
      chan2Re[k] = 0.5 * (fkIm + fmkIm);
      chan2Im[k] = 0.5 * (fmkRe - fkRe);
    }
  }
}

function synthesizeMultiChannelFrame(
  paddedChannels: Float32Array[],
  inStart: number,
  rotCos: Float64Array,
  rotSin: Float64Array,
  tables: VocoderTables,
  work: WorkspaceBuffers,
  outAccums: Float32Array[],
  outPos: number,
): void {
  for (let c = 0; c < paddedChannels.length; c += 2) {
    const chA = paddedChannels[c];
    const chB = paddedChannels[c + 1] ?? null;
    if (!chA) continue;

    analyzePairedChannels(chA, chB, inStart, tables, work);

    const accumA = outAccums[c];
    if (accumA) {
      synthesizeRotatedSpectrumAndOverlapAdd(
        work.chanRe,
        work.chanIm,
        rotCos,
        rotSin,
        tables,
        work,
        accumA,
        outPos,
      );
    }

    const accumB = outAccums[c + 1];
    if (chB && accumB) {
      synthesizeRotatedSpectrumAndOverlapAdd(
        work.chan2Re,
        work.chan2Im,
        rotCos,
        rotSin,
        tables,
        work,
        accumB,
        outPos,
      );
    }
  }
}

function createWorkspaceBuffers(fftSize: number): WorkspaceBuffers {
  const halfSize = fftSize >> 1;
  return {
    fftRe: new Float64Array(fftSize),
    fftIm: new Float64Array(fftSize),
    zRe: new Float64Array(halfSize),
    zIm: new Float64Array(halfSize),
    rotRe: new Float64Array(halfSize + 1),
    rotIm: new Float64Array(halfSize + 1),
    chanRe: new Float64Array(halfSize + 1),
    chanIm: new Float64Array(halfSize + 1),
    chan2Re: new Float64Array(halfSize + 1),
    chan2Im: new Float64Array(halfSize + 1),
  };
}

function createPhaseVocoderState(halfSize: number): PhaseVocoderState {
  return {
    prevMag: new Float64Array(halfSize + 1),
    prevInstFreq: new Float64Array(halfSize + 1),
    prevSynPhase: new Float64Array(halfSize + 1),
    nextSynPhase: new Float64Array(halfSize + 1),
    rotCos: new Float64Array(halfSize + 1),
    rotSin: new Float64Array(halfSize + 1),
    prevPeaks: new Int32Array(halfSize + 1),
    curPeaks: new Int32Array(halfSize + 1),
    prevPeakCount: 0,
    prevEnergy: 0,
    prevHfEnergy: 0,
    lastTransientFrame: -100,
    rngState: 0x12345678,
  };
}

function applySoftLimiterAndEdgeFade(
  data: Float32Array,
  sampleRate: number,
  fadeInSec = 0.004,
  fadeOutSec = 0.008,
): Float32Array {
  if (data.length === 0) return data;

  for (let i = 0; i < data.length; i++) {
    const x = data[i] ?? 0;
    const absX = Math.abs(x);
    if (absX > SOFT_LIMIT_THRESHOLD) {
      const compressed =
        SOFT_LIMIT_THRESHOLD +
        SOFT_LIMIT_HEADROOM * Math.tanh((absX - SOFT_LIMIT_THRESHOLD) / SOFT_LIMIT_HEADROOM);
      data[i] = x < 0 ? -compressed : compressed;
    }
  }

  const fadeInSamples = Math.min(Math.floor(data.length / 4), Math.round(sampleRate * fadeInSec));
  for (let i = 0; i < fadeInSamples; i++) {
    const gain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
    data[i] = (data[i] ?? 0) * gain;
  }

  const fadeOutSamples = Math.min(Math.floor(data.length / 4), Math.round(sampleRate * fadeOutSec));
  const tailStart = data.length - fadeOutSamples;
  for (let i = 0; i < fadeOutSamples; i++) {
    const gain = 0.5 * (1 + Math.cos((Math.PI * i) / fadeOutSamples));
    data[tailStart + i] = (data[tailStart + i] ?? 0) * gain;
  }

  return data;
}

function buildMonoGuide(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;

  const guide = new Float32Array(first.length);
  const invCount = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < guide.length; i++) {
      guide[i] = (guide[i] ?? 0) + (ch[i] ?? 0) * invCount;
    }
  }
  return guide;
}

function normalizeAndTrimOutput(
  accum: Float32Array,
  weightSum: Float32Array,
  halfSize: number,
  expectedOutLen: number,
  sampleRate: number,
  fadeInSec = 0.004,
  fadeOutSec = 0.008,
): Float32Array {
  const result = new Float32Array(expectedOutLen);
  for (let i = 0; i < expectedOutLen; i++) {
    const srcIdx = halfSize + i;
    const w = weightSum[srcIdx] ?? 0;
    result[i] = w > 1e-6 ? (accum[srcIdx] ?? 0) / w : 0;
  }
  return applySoftLimiterAndEdgeFade(result, sampleRate, fadeInSec, fadeOutSec);
}

function synthesizeVocoderFrame(
  channels: Float32Array[],
  paddedChannels: Float32Array[],
  inStart: number,
  analysis: FrameAnalysis,
  state: PhaseVocoderState,
  tables: VocoderTables,
  work: WorkspaceBuffers,
  outAccums: Float32Array[],
  weightSum: Float32Array,
  outPos: number,
): void {
  const { fftSize, window } = tables;
  if (channels.length === 1) {
    const accum = outAccums[0];
    if (accum) {
      synthesizeRotatedSpectrumAndOverlapAdd(
        analysis.xRe,
        analysis.xIm,
        state.rotCos,
        state.rotSin,
        tables,
        work,
        accum,
        outPos,
      );
    }
  } else {
    synthesizeMultiChannelFrame(
      paddedChannels,
      inStart,
      state.rotCos,
      state.rotSin,
      tables,
      work,
      outAccums,
      outPos,
    );
  }

  for (let i = 0; i < fftSize; i++) {
    const w = window[i] ?? 0;
    weightSum[outPos + i] = (weightSum[outPos + i] ?? 0) + w * w;
  }
}

interface SegmentStretchResult {
  readonly channels: Float32Array[];
  readonly inAnchors: number[];
  readonly outAnchors: number[];
}

interface NutsmSegmentParams {
  readonly channels: Float32Array[];
  readonly sampleRate: number;
  readonly vowelRate: number;
  readonly consonantRate: number;
  readonly fadeInSec: number;
  readonly fadeOutSec: number;
}

function createFrameAnalysisBuffer(halfSize: number): FrameAnalysis {
  return {
    xRe: new Float64Array(halfSize + 1),
    xIm: new Float64Array(halfSize + 1),
    mag: new Float64Array(halfSize + 1),
    instFreq: new Float64Array(halfSize + 1),
    maxMag: 0,
    frameEnergy: 0,
    hfEnergy: 0,
    spectralFlatness: 0,
  };
}

function stretchUniformSegment(
  channels: Float32Array[],
  sampleRate: number,
  clampedSpeed: number,
): SegmentStretchResult {
  const first = channels[0];
  if (!first || first.length < 32) {
    const len = first?.length ?? 0;
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      inAnchors: [0, len],
      outAnchors: [0, len],
    };
  }

  const inputLen = first.length;
  const expectedOutLen = Math.max(1, Math.round(inputLen / clampedSpeed));
  const fftSize = selectFftSize(sampleRate);
  const tables = getVocoderTables(fftSize);
  const { halfSize } = tables;
  const synHop = fftSize >> 2;
  const work = createWorkspaceBuffers(fftSize);
  const state = createPhaseVocoderState(halfSize);

  const guide = buildMonoGuide(channels);
  const paddedGuide = buildPaddedChannel(guide, fftSize, sampleRate);
  const paddedChannels =
    channels.length === 1
      ? [paddedGuide]
      : channels.map((ch) => buildPaddedChannel(ch, fftSize, sampleRate));

  const outBufLen = expectedOutLen + fftSize * 2;
  const outAccums = channels.map(() => new Float32Array(outBufLen));
  const weightSum = new Float32Array(outBufLen);
  const analysisBuf = createFrameAnalysisBuffer(halfSize);

  const hfStartBin = Math.min(
    halfSize - 1,
    Math.max(1, Math.round((TRANSIENT_HF_HZ * fftSize) / sampleRate)),
  );
  const unvoicedStartBin = Math.min(
    halfSize - 1,
    Math.max(1, Math.round((UNVOICED_LOW_CUT_HZ * fftSize) / sampleRate)),
  );
  const transientCooldownFrames = Math.max(
    1,
    Math.round((TRANSIENT_COOLDOWN_SEC * sampleRate) / synHop),
  );

  let frameIdx = 0;
  for (let outPos = 0; outPos <= expectedOutLen + synHop; outPos += synHop) {
    const inStart = Math.min(inputLen, Math.max(0, Math.round(outPos * clampedSpeed)));
    const analysis = analyzeGuideFrame(
      paddedGuide,
      inStart,
      tables,
      work,
      analysisBuf,
      hfStartBin,
      unvoicedStartBin,
    );

    updatePhaseStateForFrame(
      analysis,
      state,
      frameIdx,
      halfSize,
      synHop,
      transientCooldownFrames,
      unvoicedStartBin,
    );

    synthesizeVocoderFrame(
      channels,
      paddedChannels,
      inStart,
      analysis,
      state,
      tables,
      work,
      outAccums,
      weightSum,
      outPos,
    );

    frameIdx++;
  }

  return {
    channels: outAccums.map((accum) =>
      normalizeAndTrimOutput(accum, weightSum, halfSize, expectedOutLen, sampleRate),
    ),
    inAnchors: [0, inputLen],
    outAnchors: [0, expectedOutLen],
  };
}

function resolveNutsmFrameRate(
  frameClass: FrameSpeechClass,
  vowelRate: number,
  consonantRate: number,
  transientHoldRemaining: number,
): { targetRate: number; nextHold: number } {
  if (frameClass === "transient") {
    return { targetRate: consonantRate, nextHold: -1 };
  }
  if (transientHoldRemaining > 0) {
    return { targetRate: consonantRate, nextHold: transientHoldRemaining - 1 };
  }
  if (frameClass === "unvoiced") {
    return { targetRate: consonantRate, nextHold: 0 };
  }
  return { targetRate: vowelRate, nextHold: 0 };
}

function stretchNutsmSegment(params: NutsmSegmentParams): SegmentStretchResult {
  const { channels, sampleRate, vowelRate, consonantRate, fadeInSec, fadeOutSec } = params;
  const first = channels[0];
  if (!first || first.length < 32) {
    const len = first?.length ?? 0;
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      inAnchors: [0, len],
      outAnchors: [0, len],
    };
  }

  const inputLen = first.length;
  const minRate = Math.max(0.25, Math.min(vowelRate, consonantRate));
  const fftSize = selectFftSize(sampleRate);
  const tables = getVocoderTables(fftSize);
  const { halfSize } = tables;
  const synHop = fftSize >> 2;
  const work = createWorkspaceBuffers(fftSize);
  const state = createPhaseVocoderState(halfSize);

  const guide = buildMonoGuide(channels);
  const paddedGuide = buildPaddedChannel(guide, fftSize, sampleRate);
  const paddedChannels =
    channels.length === 1
      ? [paddedGuide]
      : channels.map((ch) => buildPaddedChannel(ch, fftSize, sampleRate));

  const maxOutLen = Math.ceil(inputLen / minRate) + synHop * 6;
  const outBufLen = maxOutLen + fftSize * 2;
  const outAccums = channels.map(() => new Float32Array(outBufLen));
  const weightSum = new Float32Array(outBufLen);
  const analysisBuf = createFrameAnalysisBuffer(halfSize);

  const hfStartBin = Math.min(
    halfSize - 1,
    Math.max(1, Math.round((TRANSIENT_HF_HZ * fftSize) / sampleRate)),
  );
  const unvoicedStartBin = Math.min(
    halfSize - 1,
    Math.max(1, Math.round((UNVOICED_LOW_CUT_HZ * fftSize) / sampleRate)),
  );
  const transientCooldownFrames = Math.max(
    1,
    Math.round((TRANSIENT_COOLDOWN_SEC * sampleRate) / synHop),
  );
  const transientHoldFrames = Math.max(1, Math.round((TRANSIENT_HOLD_SEC * sampleRate) / synHop));

  const inAnchors: number[] = [0];
  const outAnchors: number[] = [0];
  let inCursor = 0;
  let outPos = 0;
  let frameIdx = 0;
  let smoothedRate = vowelRate;
  let transientHoldRemaining = 0;

  while (inCursor < inputLen && outPos + fftSize < outBufLen) {
    const inStart = Math.min(inputLen, Math.max(0, Math.round(inCursor)));
    const analysis = analyzeGuideFrame(
      paddedGuide,
      inStart,
      tables,
      work,
      analysisBuf,
      hfStartBin,
      unvoicedStartBin,
    );

    const frameClass = updatePhaseStateForFrame(
      analysis,
      state,
      frameIdx,
      halfSize,
      synHop,
      transientCooldownFrames,
      unvoicedStartBin,
    );

    const rateDecision = resolveNutsmFrameRate(
      frameClass,
      vowelRate,
      consonantRate,
      transientHoldRemaining,
    );
    transientHoldRemaining =
      rateDecision.nextHold < 0 ? transientHoldFrames : rateDecision.nextHold;

    const alpha = rateDecision.targetRate > smoothedRate ? 0.16 : 0.1;
    smoothedRate += alpha * (rateDecision.targetRate - smoothedRate);

    synthesizeVocoderFrame(
      channels,
      paddedChannels,
      inStart,
      analysis,
      state,
      tables,
      work,
      outAccums,
      weightSum,
      outPos,
    );

    inCursor += synHop * smoothedRate;
    outPos += synHop;
    frameIdx++;

    if (frameIdx % 4 === 0) {
      inAnchors.push(Math.min(inputLen, Math.round(inCursor)));
      outAnchors.push(outPos);
    }
  }

  const finalOutLen = Math.max(1, outPos);

  // Synthesize two tail frames to keep Hann overlap-add weights balanced at the segment end
  for (let tail = 0; tail < 2 && outPos + fftSize < outBufLen; tail++) {
    const analysis = analyzeGuideFrame(
      paddedGuide,
      inputLen,
      tables,
      work,
      analysisBuf,
      hfStartBin,
      unvoicedStartBin,
    );
    updatePhaseStateForFrame(
      analysis,
      state,
      frameIdx,
      halfSize,
      synHop,
      transientCooldownFrames,
      unvoicedStartBin,
    );
    synthesizeVocoderFrame(
      channels,
      paddedChannels,
      inputLen,
      analysis,
      state,
      tables,
      work,
      outAccums,
      weightSum,
      outPos,
    );
    outPos += synHop;
    frameIdx++;
  }

  if (inAnchors.at(-1) !== inputLen || outAnchors.at(-1) !== finalOutLen) {
    inAnchors.push(inputLen);
    outAnchors.push(finalOutLen);
  }

  return {
    channels: outAccums.map((accum) =>
      normalizeAndTrimOutput(
        accum,
        weightSum,
        halfSize,
        finalOutLen,
        sampleRate,
        fadeInSec,
        fadeOutSec,
      ),
    ),
    inAnchors,
    outAnchors,
  };
}

interface AssembledPiece {
  readonly channels: Float32Array[] | null;
  readonly length: number;
  readonly inOffset: number;
  readonly inAnchors: number[];
  readonly outAnchors: number[];
}

function sliceChannelsRange(channels: Float32Array[], start: number, end: number): Float32Array[] {
  return channels.map((ch) => ch.slice(start, end));
}

function copyPieceChannels(
  pieceChannels: Float32Array[],
  outChannels: Float32Array[],
  outOffset: number,
): void {
  for (let c = 0; c < outChannels.length; c++) {
    const dst = outChannels[c];
    const src = pieceChannels[c];
    if (dst && src) {
      dst.set(src, outOffset);
    }
  }
}

function appendPieceAnchors(
  piece: AssembledPiece,
  inputLen: number,
  outOffset: number,
  mergedIn: number[],
  mergedOut: number[],
): void {
  for (let i = 0; i < piece.inAnchors.length; i++) {
    const absIn = Math.min(inputLen, piece.inOffset + (piece.inAnchors[i] ?? 0));
    const absOut = outOffset + (piece.outAnchors[i] ?? 0);
    if (mergedIn.length === 0 || mergedIn.at(-1) !== absIn || mergedOut.at(-1) !== absOut) {
      mergedIn.push(absIn);
      mergedOut.push(absOut);
    }
  }
}

function assembleStretchedPieces(
  channelCount: number,
  inputLen: number,
  pieces: AssembledPiece[],
): StretchedAudioResult {
  const totalOutLen = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const outChannels = Array.from({ length: channelCount }, () => new Float32Array(totalOutLen));
  const mergedIn: number[] = [];
  const mergedOut: number[] = [];

  let outOffset = 0;
  for (const piece of pieces) {
    if (piece.channels) {
      copyPieceChannels(piece.channels, outChannels, outOffset);
    }
    appendPieceAnchors(piece, inputLen, outOffset, mergedIn, mergedOut);
    outOffset += piece.length;
  }

  if (mergedIn.length === 0) {
    return {
      channels: outChannels,
      timeline: createIdentityTimelineMap(totalOutLen),
    };
  }

  return {
    channels: outChannels,
    timeline: {
      inSamples: Uint32Array.from(mergedIn),
      outSamples: Uint32Array.from(mergedOut),
      inputLength: inputLen,
      outputLength: totalOutLen,
    },
  };
}

function buildPassthroughPiece(
  channels: Float32Array[],
  start: number,
  end: number,
): AssembledPiece {
  const len = end - start;
  return {
    channels: sliceChannelsRange(channels, start, end),
    length: len,
    inOffset: start,
    inAnchors: [0, len],
    outAnchors: [0, len],
  };
}

function buildStretchedSpeechPiece(
  channels: Float32Array[],
  start: number,
  end: number,
  sampleRate: number,
  vowelRate: number,
  consonantRate: number,
  fadeInSec: number,
  fadeOutSec: number,
): AssembledPiece {
  const stretched = stretchNutsmSegment({
    channels: sliceChannelsRange(channels, start, end),
    sampleRate,
    vowelRate,
    consonantRate,
    fadeInSec,
    fadeOutSec,
  });
  return {
    channels: stretched.channels,
    length: stretched.channels[0]?.length ?? 0,
    inOffset: start,
    inAnchors: stretched.inAnchors,
    outAnchors: stretched.outAnchors,
  };
}

function buildSilenceGapPiece(cutSample: number, silenceSamples: number): AssembledPiece {
  return {
    channels: null,
    length: silenceSamples,
    inOffset: cutSample,
    inAnchors: [0, 0],
    outAnchors: [0, silenceSamples],
  };
}

function buildIntelligibleSpeechPieces(
  channels: Float32Array[],
  sampleRate: number,
  effectiveStart: number,
  effectiveEnd: number,
  inputLen: number,
  boundaries: readonly { readonly cutSample: number; readonly insertSilenceSamples: number }[],
  vowelRate: number,
  consonantRate: number,
): AssembledPiece[] {
  const pieces: AssembledPiece[] = [];
  let cursor = effectiveStart;

  for (const boundary of boundaries) {
    if (boundary.cutSample <= cursor || boundary.cutSample >= effectiveEnd) continue;
    pieces.push(
      buildStretchedSpeechPiece(
        channels,
        cursor,
        boundary.cutSample,
        sampleRate,
        vowelRate,
        consonantRate,
        cursor > effectiveStart ? VALLEY_FADE_IN_SEC : 0.004,
        VALLEY_FADE_OUT_SEC,
      ),
    );
    if (boundary.insertSilenceSamples > 0) {
      pieces.push(buildSilenceGapPiece(boundary.cutSample, boundary.insertSilenceSamples));
    }
    cursor = boundary.cutSample;
  }

  if (cursor < effectiveEnd) {
    pieces.push(
      buildStretchedSpeechPiece(
        channels,
        cursor,
        effectiveEnd,
        sampleRate,
        vowelRate,
        consonantRate,
        cursor > effectiveStart ? VALLEY_FADE_IN_SEC : 0.004,
        effectiveEnd < inputLen ? VALLEY_FADE_OUT_SEC : 0.008,
      ),
    );
  }

  return pieces;
}

function stretchIntelligibleChannels(
  channels: Float32Array[],
  sampleRate: number,
  clampedSpeed: number,
  expectedSyllableCount?: number,
  baseClipIsSlow?: boolean,
): StretchedAudioResult {
  const first = channels[0];
  if (!first || first.length < 32) {
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      timeline: createIdentityTimelineMap(first?.length ?? 0),
    };
  }

  const inputLen = first.length;
  const pacing = computePlaybackPacing(speedFactorToPercent(clampedSpeed), { baseClipIsSlow });
  if (pacing.vowelRate >= 0.99 && pacing.valleyPauseMs < 15) {
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      timeline: createIdentityTimelineMap(inputLen),
    };
  }

  const plan = analyzeSpeechSegmentation(buildMonoGuide(channels), sampleRate, pacing, {
    expectedSyllableCount,
  });
  const minEdgeSamples = Math.round(sampleRate * MIN_EDGE_PASSTHROUGH_SEC);
  const effectiveStart = plan.speechStartSample >= minEdgeSamples ? plan.speechStartSample : 0;
  const effectiveEnd =
    inputLen - plan.speechEndSample >= minEdgeSamples ? plan.speechEndSample : inputLen;

  const pieces: AssembledPiece[] = [];
  if (effectiveStart > 0) {
    pieces.push(buildPassthroughPiece(channels, 0, effectiveStart));
  }
  pieces.push(
    ...buildIntelligibleSpeechPieces(
      channels,
      sampleRate,
      effectiveStart,
      effectiveEnd,
      inputLen,
      plan.boundaries,
      pacing.vowelRate,
      pacing.consonantRate,
    ),
  );
  if (effectiveEnd < inputLen) {
    pieces.push(buildPassthroughPiece(channels, effectiveEnd, inputLen));
  }

  return assembleStretchedPieces(channels.length, inputLen, pieces);
}

export function stretchAudioChannelsWithMap(
  channels: Float32Array[],
  sampleRate: number,
  speedFactor: number,
  options?: StretchAudioOptions,
): StretchedAudioResult {
  if (channels.length === 0) {
    return { channels: [], timeline: createIdentityTimelineMap(0) };
  }
  const first = channels[0];
  if (!first || first.length === 0) {
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      timeline: createIdentityTimelineMap(0),
    };
  }

  const clampedSpeed = Math.min(1, Math.max(0.1, speedFactor));
  if (clampedSpeed >= 0.99 || first.length < 32) {
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      timeline: createIdentityTimelineMap(first.length),
    };
  }

  if (options?.mode === "uniform") {
    const res = stretchUniformSegment(channels, sampleRate, clampedSpeed);
    const outLen = res.channels[0]?.length ?? 0;
    return {
      channels: res.channels,
      timeline: {
        inSamples: Uint32Array.from(res.inAnchors),
        outSamples: Uint32Array.from(res.outAnchors),
        inputLength: first.length,
        outputLength: outLen,
      },
    };
  }

  return stretchIntelligibleChannels(
    channels,
    sampleRate,
    clampedSpeed,
    options?.expectedSyllableCount,
    options?.baseClipIsSlow,
  );
}

export function stretchAudioChannels(
  channels: Float32Array[],
  sampleRate: number,
  speedFactor: number,
  options?: StretchAudioOptions,
): Float32Array[] {
  return stretchAudioChannelsWithMap(channels, sampleRate, speedFactor, options).channels;
}

export function stretchAudioChannelData(
  input: Float32Array,
  sampleRate: number,
  speedFactor: number,
  options?: StretchAudioOptions,
): Float32Array {
  const stretched = stretchAudioChannels([input], sampleRate, speedFactor, options);
  return stretched[0] ?? new Float32Array(input);
}

export function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const win = window as Window & {
    webkitAudioContext?: new () => AudioContext;
  };
  return typeof AudioContext !== "undefined" ? AudioContext : (win.webkitAudioContext ?? null);
}
