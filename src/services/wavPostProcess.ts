const TARGET_RMS = 0.135;
const MAX_GAIN = 3.0;
const MIN_GAIN = 0.55;
const SOFT_LIMIT_THRESHOLD = 0.88;
const SOFT_LIMIT_HEADROOM = 0.08;
const SILENCE_THRESHOLD = 0.0045;
const LEAD_PAD_MS = 20;
const TRAIL_PAD_MS = 45;
const FADE_IN_MS = 5;
const FADE_OUT_MS = 12;
const HIGH_PASS_CUTOFF_HZ = 65;

interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array;
}

function parsePcmWav(buffer: Buffer): ParsedWav | null {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const availableBytes = buffer.length - payloadStart;

    if (chunkId === "fmt " && chunkSize >= 16 && availableBytes >= 16) {
      audioFormat = buffer.readUInt16LE(payloadStart);
      channels = buffer.readUInt16LE(payloadStart + 2);
      sampleRate = buffer.readUInt32LE(payloadStart + 4);
      bitsPerSample = buffer.readUInt16LE(payloadStart + 14);
    } else if (chunkId === "data") {
      dataStart = payloadStart;
      dataSize = Math.min(chunkSize, availableBytes);
      break;
    }

    if (chunkSize > availableBytes) {
      break;
    }
    const paddedSize = chunkSize + (chunkSize % 2);
    offset = payloadStart + paddedSize;
  }

  if (
    audioFormat !== 1 ||
    channels < 1 ||
    channels > 2 ||
    sampleRate < 8000 ||
    bitsPerSample !== 16 ||
    dataStart < 0 ||
    dataSize < 2
  ) {
    return null;
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  }

  return { sampleRate, channels, bitsPerSample, samples };
}

function encodePcmWav(samples: Float32Array, sampleRate: number, channels: number): Buffer {
  const dataSize = samples.length * 2;
  const out = Buffer.allocUnsafe(44 + dataSize);

  out.write("RIFF", 0, 4, "ascii");
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8, 4, "ascii");
  out.write("fmt ", 12, 4, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, 4, "ascii");
  out.writeUInt32LE(dataSize, 40);

  let seed = 0x12345678;
  for (let i = 0; i < samples.length; i++) {
    // TPDF dither (±1 LSB) eliminates quantization distortion on quiet tails
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r1 = seed / 0xffffffff - 0.5;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r2 = seed / 0xffffffff - 0.5;
    const dither = (r1 + r2) / 32768;

    const clamped = Math.max(-1, Math.min(1, (samples[i] ?? 0) + dither));
    const intVal = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
    out.writeInt16LE(intVal, 44 + i * 2);
  }

  return out;
}

function applyDcBlockingHighPass(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): void {
  const rc = 1 / (2 * Math.PI * HIGH_PASS_CUTOFF_HZ);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);

  for (let ch = 0; ch < channels; ch++) {
    let prevIn = samples[ch] ?? 0;
    let prevOut = 0;
    for (let i = ch; i < samples.length; i += channels) {
      const x = samples[i] ?? 0;
      const y = alpha * (prevOut + x - prevIn);
      samples[i] = y;
      prevIn = x;
      prevOut = y;
    }
  }
}

function trimExcessSilence(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): Float32Array {
  const frames = Math.floor(samples.length / channels);
  if (frames === 0) return samples;

  let firstActiveFrame = -1;
  let lastActiveFrame = -1;

  for (let f = 0; f < frames; f++) {
    let peak = 0;
    const base = f * channels;
    for (let ch = 0; ch < channels; ch++) {
      peak = Math.max(peak, Math.abs(samples[base + ch] ?? 0));
    }
    if (peak >= SILENCE_THRESHOLD) {
      if (firstActiveFrame === -1) firstActiveFrame = f;
      lastActiveFrame = f;
    }
  }

  if (firstActiveFrame === -1 || lastActiveFrame < firstActiveFrame) {
    return samples;
  }

  const leadPadFrames = Math.round((sampleRate * LEAD_PAD_MS) / 1000);
  const trailPadFrames = Math.round((sampleRate * TRAIL_PAD_MS) / 1000);
  const startFrame = Math.max(0, firstActiveFrame - leadPadFrames);
  const endFrame = Math.min(frames, lastActiveFrame + 1 + trailPadFrames);

  return samples.slice(startFrame * channels, endFrame * channels);
}

function computeActiveRms(samples: Float32Array, frameWin: number): number | null {
  let activeSumSq = 0;
  let activeCount = 0;

  for (let offset = 0; offset + frameWin <= samples.length; offset += frameWin) {
    let winSq = 0;
    for (let i = 0; i < frameWin; i++) {
      const s = samples[offset + i] ?? 0;
      winSq += s * s;
    }
    if (Math.sqrt(winSq / frameWin) > 0.015) {
      activeSumSq += winSq;
      activeCount += frameWin;
    }
  }

  return activeCount > 0 ? Math.sqrt(activeSumSq / activeCount) : null;
}

function applyEdgeFades(samples: Float32Array, sampleRate: number, channels: number): void {
  const totalFrames = Math.floor(samples.length / channels);
  const fadeInFrames = Math.min(
    Math.floor(totalFrames / 4),
    Math.round((sampleRate * FADE_IN_MS) / 1000),
  );
  for (let f = 0; f < fadeInFrames; f++) {
    const g = 0.5 * (1 - Math.cos((Math.PI * f) / fadeInFrames));
    const base = f * channels;
    for (let ch = 0; ch < channels; ch++) {
      samples[base + ch] = (samples[base + ch] ?? 0) * g;
    }
  }

  const fadeOutFrames = Math.min(
    Math.floor(totalFrames / 4),
    Math.round((sampleRate * FADE_OUT_MS) / 1000),
  );
  const tailStart = totalFrames - fadeOutFrames;
  for (let f = 0; f < fadeOutFrames; f++) {
    const g = 0.5 * (1 + Math.cos((Math.PI * f) / fadeOutFrames));
    const base = (tailStart + f) * channels;
    for (let ch = 0; ch < channels; ch++) {
      samples[base + ch] = (samples[base + ch] ?? 0) * g;
    }
  }
}

function normalizeAndSoftLimit(samples: Float32Array, sampleRate: number, channels: number): void {
  const frameWin = Math.max(1, Math.round(sampleRate * 0.02)) * channels;
  const activeRms = computeActiveRms(samples, frameWin);

  if (activeRms !== null) {
    const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / Math.max(1e-4, activeRms)));
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (samples[i] ?? 0) * gain;
    }
  }

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i] ?? 0;
    const absX = Math.abs(x);
    if (absX > SOFT_LIMIT_THRESHOLD) {
      const limited =
        SOFT_LIMIT_THRESHOLD +
        SOFT_LIMIT_HEADROOM * Math.tanh((absX - SOFT_LIMIT_THRESHOLD) / SOFT_LIMIT_HEADROOM);
      samples[i] = x < 0 ? -limited : limited;
    }
  }

  applyEdgeFades(samples, sampleRate, channels);
}

export function conditionTtsWav(wavBuffer: Buffer): Buffer {
  const parsed = parsePcmWav(wavBuffer);
  if (!parsed) {
    return wavBuffer;
  }

  const { sampleRate, channels } = parsed;
  const working = new Float32Array(parsed.samples);
  applyDcBlockingHighPass(working, sampleRate, channels);
  const trimmed = trimExcessSilence(working, sampleRate, channels);
  normalizeAndSoftLimit(trimmed, sampleRate, channels);
  return encodePcmWav(trimmed, sampleRate, channels);
}
