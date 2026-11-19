import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { conditionTtsWav } from "../services/wavPostProcess.ts";
import type { DialectRegion, TtsVoiceProfile } from "../types/vietnamese.ts";
import { isValidWavBuffer } from "./ttsDiskCache.ts";
import { phonemizeVietnameseForRegion } from "./vietnameseRegionalG2p.ts";

const KOKORO_MODEL_URL =
  "https://huggingface.co/loanhviet/Kokoro-Vietnamese-Lite/resolve/main/kokoro_vi_lite.onnx";
const KOKORO_MODEL_FILENAME = "kokoro_vi_lite.onnx";
const MIN_MODEL_BYTES = 1_000_000;
const KOKORO_SAMPLE_RATE = 24_000;
const CLAUSE_PAUSE_SAMPLES = Math.round(KOKORO_SAMPLE_RATE * 0.14);

let cachedSessionPromise: Promise<ort.InferenceSession> | null = null;
let activeModelDownload: Promise<string> | null = null;
let cachedModelPath: string | null = null;

function resolveModelDirectory(modelDir?: string): string {
  if (modelDir && modelDir.trim().length > 0) {
    return path.resolve(modelDir);
  }
  const envCacheDir = process.env["TTS_CACHE_DIR"]?.trim();
  const baseCacheDir =
    envCacheDir && envCacheDir.length > 0
      ? path.resolve(envCacheDir)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".tts-cache");
  return path.join(baseCacheDir, "models");
}

async function isValidCachedModelFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size >= MIN_MODEL_BYTES;
  } catch {
    return false;
  }
}

async function downloadModelFile(targetPath: string, timeoutMs: number): Promise<string> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  const controller = new AbortController();
  const timerId = setTimeout(
    () => {
      controller.abort();
    },
    Math.max(5_000, timeoutMs),
  );

  try {
    const response = await fetch(KOKORO_MODEL_URL, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download Kokoro Vietnamese model (HTTP ${String(response.status)}).`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_MODEL_BYTES) {
      throw new Error("Downloaded Kokoro Vietnamese model was unexpectedly truncated.");
    }
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, targetPath);
    return targetPath;
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timerId);
  }
}

async function ensureKokoroModelPath(
  modelDir: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const targetPath = path.join(resolveModelDirectory(modelDir), KOKORO_MODEL_FILENAME);
  if (await isValidCachedModelFile(targetPath)) {
    return targetPath;
  }
  if (activeModelDownload) {
    return activeModelDownload;
  }
  activeModelDownload = downloadModelFile(targetPath, timeoutMs).finally(() => {
    activeModelDownload = null;
  });
  return activeModelDownload;
}

async function getKokoroSession(
  modelDir: string | undefined,
  timeoutMs: number,
): Promise<ort.InferenceSession> {
  const modelPath = await ensureKokoroModelPath(modelDir, timeoutMs);
  if (cachedSessionPromise && cachedModelPath === modelPath) {
    return cachedSessionPromise;
  }
  cachedModelPath = modelPath;
  cachedSessionPromise = ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  }).catch((err: unknown) => {
    cachedSessionPromise = null;
    cachedModelPath = null;
    throw err;
  });
  return cachedSessionPromise;
}

function encodeMonoFloat32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const out = Buffer.allocUnsafe(44 + dataSize);
  out.write("RIFF", 0, 4, "ascii");
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8, 4, "ascii");
  out.write("fmt ", 12, 4, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, 4, "ascii");
  out.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const intVal = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
    out.writeInt16LE(intVal, 44 + i * 2);
  }
  return out;
}

function trimChunkSilence(samples: Float32Array): Float32Array {
  const threshold = 0.008;
  const padSamples = Math.round(KOKORO_SAMPLE_RATE * 0.03);
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i] ?? 0) >= threshold) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1 || last < first) {
    return samples;
  }
  const start = Math.max(0, first - padSamples);
  const end = Math.min(samples.length, last + 1 + padSamples);
  return samples.subarray(start, end);
}

function concatWaveformsWithPauses(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  if (chunks.length === 1) return chunks[0] ?? new Float32Array(0);

  let totalLength = 0;
  for (let i = 0; i < chunks.length; i++) {
    totalLength += chunks[i]?.length ?? 0;
    if (i < chunks.length - 1) {
      totalLength += CLAUSE_PAUSE_SAMPLES;
    }
  }

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    merged.set(chunk, offset);
    offset += chunk.length;
    if (i < chunks.length - 1) {
      offset += CLAUSE_PAUSE_SAMPLES;
    }
  }
  return merged;
}

function selectKokoroVoiceId(voiceProfile: TtsVoiceProfile): bigint {
  return voiceProfile === "male" ? 1n : 0n;
}

export async function synthesizeKokoroRegionalVietnameseTts(
  text: string,
  region: DialectRegion,
  slow: boolean,
  voiceProfile: TtsVoiceProfile,
  timeoutMs = 20_000,
  modelDir?: string,
): Promise<{ audioBuffer: Buffer; contentType: "audio/wav" }> {
  const { chunks } = phonemizeVietnameseForRegion(text, region);
  if (chunks.length === 0) {
    throw new Error("Text is required for Vietnamese speech synthesis.");
  }

  const session = await getKokoroSession(modelDir, timeoutMs);
  const voiceId = selectKokoroVoiceId(voiceProfile);
  const speedValue = slow ? 0.78 : 0.96;
  const speedTensor = new ort.Tensor("float32", new Float32Array([speedValue]), [1]);
  const voiceTensor = new ort.Tensor("int64", BigInt64Array.of(voiceId), [1]);

  const waveforms: Float32Array[] = [];
  for (const chunk of chunks) {
    const inputIds = new ort.Tensor(
      "int64",
      BigInt64Array.from(chunk.tokens, (id) => BigInt(id)),
      [1, chunk.tokens.length],
    );
    const outputs = await session.run({
      input_ids: inputIds,
      speed: speedTensor,
      voice: voiceTensor,
    });
    const waveformTensor = outputs["waveform"];
    if (!waveformTensor || !(waveformTensor.data instanceof Float32Array)) {
      throw new Error("Kokoro regional Vietnamese TTS returned an unexpected tensor payload.");
    }
    waveforms.push(trimChunkSilence(waveformTensor.data));
  }

  const combined = concatWaveformsWithPauses(waveforms);
  if (combined.length === 0) {
    throw new Error("Kokoro regional Vietnamese TTS produced an empty audio clip.");
  }

  const rawWav = encodeMonoFloat32ToWav(combined, KOKORO_SAMPLE_RATE);
  const conditionedWav = conditionTtsWav(rawWav);
  if (!isValidWavBuffer(conditionedWav)) {
    throw new Error("Kokoro regional Vietnamese TTS produced an invalid WAV payload.");
  }

  return {
    audioBuffer: conditionedWav,
    contentType: "audio/wav",
  };
}
