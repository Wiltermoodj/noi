import { describe, expect, it } from "vitest";
import { conditionTtsWav } from "./wavPostProcess";

function createTestWav(samples: Float32Array, sampleRate = 24000, extraChunk = false): Buffer {
  const dataSize = samples.length * 2;
  const extraSize = extraChunk ? 12 : 0;
  const buf = Buffer.alloc(44 + dataSize + extraSize);
  buf.write("RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(36 + dataSize + extraSize, 4);
  buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const val = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }
  if (extraChunk) {
    buf.write("C2PA", 44 + dataSize, 4, "ascii");
    buf.writeUInt32LE(4, 48 + dataSize);
    buf.write("test", 52 + dataSize, 4, "ascii");
  }
  return buf;
}

describe("conditionTtsWav", () => {
  it("strips metadata chunks, removes DC offset, trims excessive silence, and normalizes loudness", () => {
    const sr = 24000;
    const leadSilence = Math.round(sr * 0.25);
    const bodyLen = Math.round(sr * 0.3);
    const trailSilence = Math.round(sr * 0.25);
    const samples = new Float32Array(leadSilence + bodyLen + trailSilence);

    // Low-level speech-like tone with significant +0.12 DC offset
    samples.fill(0.12);
    for (let i = 0; i < bodyLen; i++) {
      samples[leadSilence + i] =
        0.12 +
        0.04 * Math.sin((2 * Math.PI * 180 * i) / sr) +
        0.02 * Math.sin((2 * Math.PI * 360 * i) / sr);
    }

    const inputWav = createTestWav(samples, sr, true);
    const conditioned = conditionTtsWav(inputWav);

    expect(conditioned.toString("ascii", 0, 4)).toBe("RIFF");
    expect(conditioned.toString("ascii", 36, 40)).toBe("data");
    const outDataSize = conditioned.readUInt32LE(40);
    expect(conditioned.length).toBe(44 + outDataSize);

    const outCount = outDataSize / 2;
    expect(outCount).toBeLessThan(samples.length * 0.7);

    let sum = 0;
    let maxAbs = 0;
    for (let i = 0; i < outCount; i++) {
      const s = conditioned.readInt16LE(44 + i * 2) / 32768;
      sum += s;
      maxAbs = Math.max(maxAbs, Math.abs(s));
    }

    expect(Math.abs(sum / outCount)).toBeLessThan(0.01);
    expect(maxAbs).toBeGreaterThan(0.15);
    expect(maxAbs).toBeLessThanOrEqual(0.97);
    expect(Math.abs(conditioned.readInt16LE(44) / 32768)).toBeLessThan(0.01);
    expect(Math.abs(conditioned.readInt16LE(44 + (outCount - 1) * 2) / 32768)).toBeLessThan(0.01);
  });

  it("returns non-WAV buffers untouched", () => {
    const raw = Buffer.from("not-a-wav-buffer");
    expect(conditionTtsWav(raw)).toBe(raw);
  });
});
