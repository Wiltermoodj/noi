import { adaptTextForRegionalSpeech } from "../services/ttsDialectProfile.ts";
import type { DialectRegion, TtsVoiceProfile } from "../types/vietnamese.ts";
import { synthesizeKokoroRegionalVietnameseTts } from "./kokoroVietnameseTts.ts";
import { isValidMp3Buffer } from "./ttsDiskCache.ts";

const MAX_CHUNK_CHARS = 180;
const GOOGLE_TTS_ENDPOINT = "https://translate.google.com/translate_tts";
const WEB_TTS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface WebTtsSynthesisResult {
  audioBuffer: Buffer;
  contentType: "audio/mpeg" | "audio/wav";
}

export type WebTtsSynthesizer = (
  text: string,
  region: DialectRegion,
  slow: boolean,
  voiceProfile: TtsVoiceProfile,
  timeoutMs: number,
) => Promise<WebTtsSynthesisResult>;

function splitOversizedSegment(segment: string, maxChars: number): string[] {
  const words = segment.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word.length <= maxChars ? word : word.slice(0, maxChars);
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      chunks.push(current);
      current = word.length <= maxChars ? word : word.slice(0, maxChars);
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export function splitTextIntoSpeechChunks(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const clauses = normalized
    .split(/(?<=[.!?,;:])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const clause of clauses) {
    if (clause.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitOversizedSegment(clause, maxChars));
      continue;
    }

    if (!current) {
      current = clause;
    } else if (current.length + 1 + clause.length <= maxChars) {
      current = `${current} ${clause}`;
    } else {
      chunks.push(current);
      current = clause;
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function fetchGoogleTranslateTtsChunk(
  chunk: string,
  slow: boolean,
  timeoutMs: number,
): Promise<Buffer> {
  if (timeoutMs <= 0) {
    throw new Error("Browser regional Vietnamese voice timed out.");
  }

  const params = new URLSearchParams({
    ie: "UTF-8",
    q: chunk,
    tl: "vi",
    client: "tw-ob",
    ttsspeed: slow ? "0.24" : "1",
  });

  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${GOOGLE_TTS_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        "User-Agent": WEB_TTS_USER_AGENT,
        Accept: "audio/mpeg, audio/*;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Browser regional TTS returned HTTP ${String(response.status)}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isValidMp3Buffer(buffer)) {
      throw new Error("Browser regional TTS returned an invalid audio payload.");
    }
    return buffer;
  } finally {
    clearTimeout(timerId);
  }
}

async function synthesizeGoogleTranslateFallback(
  text: string,
  region: DialectRegion,
  slow: boolean,
  timeoutMs: number,
): Promise<WebTtsSynthesisResult> {
  const spokenText = adaptTextForRegionalSpeech(text, region);
  const chunks = splitTextIntoSpeechChunks(spokenText);
  if (chunks.length === 0) {
    throw new Error("Text is required for Vietnamese speech synthesis.");
  }

  const deadlineMs = Date.now() + Math.max(1_000, timeoutMs);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const remainingMs = deadlineMs - Date.now();
    const audioChunk = await fetchGoogleTranslateTtsChunk(chunk, slow, remainingMs);
    buffers.push(audioChunk);
  }

  const audioBuffer =
    buffers.length === 1 ? (buffers[0] ?? Buffer.alloc(0)) : Buffer.concat(buffers);
  if (!isValidMp3Buffer(audioBuffer)) {
    throw new Error("Browser regional TTS produced an empty audio clip.");
  }

  return {
    audioBuffer,
    contentType: "audio/mpeg",
  };
}

export async function synthesizeWebRegionalVietnameseTts(
  text: string,
  region: DialectRegion,
  slow: boolean,
  voiceProfile: TtsVoiceProfile,
  timeoutMs = 15_000,
): Promise<WebTtsSynthesisResult> {
  const totalBudgetMs = Math.max(2_000, timeoutMs);
  const deadlineMs = Date.now() + totalBudgetMs;
  const reservedFallbackMs = Math.min(4_000, Math.floor(totalBudgetMs * 0.35));
  const kokoroBudgetMs = Math.max(1_500, totalBudgetMs - reservedFallbackMs);

  try {
    return await synthesizeKokoroRegionalVietnameseTts(
      text,
      region,
      slow,
      voiceProfile,
      kokoroBudgetMs,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn("Kokoro regional Vietnamese TTS unavailable, using web fallback:", message);
    const remainingMs = Math.max(1_500, deadlineMs - Date.now());
    return synthesizeGoogleTranslateFallback(text, region, slow, remainingMs);
  }
}
