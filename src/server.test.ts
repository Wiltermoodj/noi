import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type ServerOptions } from "../server.ts";
import { GeminiTtsClient } from "./server/geminiTtsClient.ts";
import { TtsDiskCache } from "./server/ttsDiskCache.ts";
import { splitTextIntoSpeechChunks } from "./server/webVietnameseTts.ts";

function makeFakeWavBase64(): string {
  // Valid minimal RIFF/WAV header + 160 bytes of 16-bit PCM silence
  const pcmSize = 160;
  const buf = Buffer.alloc(44 + pcmSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + pcmSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(48000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(pcmSize, 40);
  return buf.toString("base64");
}

async function startTestServer(options: ServerOptions): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const app = createApp({
    webTtsFallback: null,
    ...options,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(addr.port)}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("Express TTS Server", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  const createTempCacheDir = (): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "noi-tts-test-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(async () => {
    while (servers.length > 0) {
      const srv = servers.pop();
      if (srv) await closeServer(srv);
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("exposes healthz and validates empty/oversized/malformed TTS requests", async () => {
    const { baseUrl, server } = await startTestServer({
      aiClient: null,
      apiKey: "",
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      diskCacheWritable: boolean;
      ttsConfigured: boolean;
    };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.diskCacheWritable).toBe(true);
    expect(healthJson.ttsConfigured).toBe(false);

    const emptyRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(emptyRes.status).toBe(400);

    const longRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "a".repeat(401) }),
    });
    expect(longRes.status).toBe(400);

    const malformedRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    expect(malformedRes.status).toBe(400);

    const unconfiguredRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào", region: "south" }),
    });
    expect(unconfiguredRes.status).toBe(503);
  });

  it("exposes X-TTS-Cache and Retry-After in CORS and deduplicates inflight synthesis", async () => {
    const wavB64 = makeFakeWavBase64();
    const generateContent = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: wavB64 } }],
            },
          },
        ],
      };
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
      maxMissesPerWindow: 1,
    });
    servers.push(server);

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://localhost",
        },
        body: JSON.stringify({ text: "Cảm ơn", region: "south" }),
      }),
      fetch(`${baseUrl}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://localhost",
        },
        body: JSON.stringify({ text: "Cảm ơn", region: "south" }),
      }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.headers.get("Access-Control-Expose-Headers")).toContain("X-TTS-Cache");
    expect(res1.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    const cacheHeaders = [res1.headers.get("X-TTS-Cache"), res2.headers.get("X-TTS-Cache")];
    expect(cacheHeaders).toContain("miss");
    expect(cacheHeaders).toContain("memory");
    expect(generateContent).toHaveBeenCalledTimes(1);

    const cachedRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Cảm ơn", region: "south" }),
    });
    expect(cachedRes.status).toBe(200);
    expect(cachedRes.headers.get("X-TTS-Cache")).toBe("memory");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest disk cache entries when cap is exceeded and cleans up corrupt wav files", async () => {
    const cacheDir = createTempCacheDir();
    const wavB64 = makeFakeWavBase64();
    const generateContent = vi.fn(async () => {
      await Promise.resolve();
      return {
        candidates: [{ content: { parts: [{ inlineData: { data: wavB64 } }] } }],
      };
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: cacheDir,
      maxDiskCacheEntries: 2,
    });
    servers.push(server);

    for (const phrase of ["Một", "Hai", "Ba"]) {
      const res = await fetch(`${baseUrl}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: phrase, region: "north" }),
      });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
    }

    await new Promise((r) => setTimeout(r, 50));
    const files = readdirSync(cacheDir).filter((name) => name.endsWith(".wav"));
    expect(files.length).toBeLessThanOrEqual(2);
    expect(readdirSync(cacheDir).some((name) => name.includes(".tmp"))).toBe(false);

    // Corrupt all cached .wav files and verify a fresh server instance rejects corrupt files and re-synthesizes cleanly
    for (const name of files) {
      writeFileSync(path.join(cacheDir, name), Buffer.from("corrupt-not-wav"));
    }

    const callsBeforeRestart = generateContent.mock.calls.length;
    const { baseUrl: baseUrl2, server: server2 } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: cacheDir,
      maxDiskCacheEntries: 2,
    });
    servers.push(server2);

    const resAfterCorrupt = await fetch(`${baseUrl2}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Ba", region: "north" }),
    });
    expect(resAfterCorrupt.status).toBe(200);
    expect(resAfterCorrupt.headers.get("X-TTS-Cache")).toBe("miss");
    expect(generateContent.mock.calls.length).toBe(callsBeforeRestart + 1);
    const bodyBuf = Buffer.from(await resAfterCorrupt.arrayBuffer());
    expect(bodyBuf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    await new Promise((r) => setTimeout(r, 50));
    const repairedFiles = readdirSync(cacheDir).filter((name) => name.endsWith(".wav"));
    expect(repairedFiles.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(cacheDir, repairedFiles[0] ?? ""))).toBe(true);
  });

  it("returns 504 on upstream timeout and 429 with Retry-After on per-IP rate limit", async () => {
    const wavB64 = makeFakeWavBase64();
    const generateContent = vi.fn(async (params: { contents: { parts: { text: string }[] }[] }) => {
      const text = params.contents[0]?.parts[0]?.text ?? "";
      if (text.includes("chậm")) {
        await new Promise(() => undefined);
      }
      await Promise.resolve();
      return {
        candidates: [{ content: { parts: [{ inlineData: { data: wavB64 } }] } }],
      };
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
      upstreamTimeoutMs: 40,
      maxMissesPerWindow: 2,
      rateLimitWindowMs: 30_000,
    });
    servers.push(server);

    const timeoutRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Quá chậm", region: "south" }),
    });
    expect(timeoutRes.status).toBe(504);

    const okRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Nhanh lên", region: "south" }),
    });
    expect(okRes.status).toBe(200);

    const limitedRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Thêm nữa", region: "south" }),
    });
    expect(limitedRes.status).toBe(429);
    expect(Number(limitedRes.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("exposes upstream diagnostics on /healthz and retries transient 502 upstream errors", async () => {
    const wavB64 = makeFakeWavBase64();
    let attempt = 0;
    const generateContent = vi.fn(async () => {
      attempt += 1;
      await Promise.resolve();
      if (attempt === 1) {
        throw Object.assign(new Error("Bad gateway"), { status: 502 });
      }
      return {
        candidates: [{ content: { parts: [{ inlineData: { data: wavB64 } }] } }],
      };
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      activeUpstreamCount: number;
      upstreamCooldownModels: string[];
      upstreamAuthHealthy: boolean;
    };
    expect(healthJson.activeUpstreamCount).toBe(0);
    expect(healthJson.upstreamCooldownModels).toEqual([]);
    expect(healthJson.upstreamAuthHealthy).toBe(true);

    const ttsRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Thử lại nhé", region: "north" }),
    });
    expect(ttsRes.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("fails fast on 403 auth errors without trying fallback model and updates healthz", async () => {
    const generateContent = vi.fn(async () => {
      await Promise.resolve();
      throw Object.assign(new Error("API key invalid"), { status: 403 });
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const ttsRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào ạ", region: "north" }),
    });
    expect(ttsRes.status).toBe(403);
    expect(generateContent).toHaveBeenCalledTimes(1);

    const healthRes = await fetch(`${baseUrl}/healthz`);
    const healthJson = (await healthRes.json()) as { upstreamAuthHealthy: boolean };
    expect(healthJson.upstreamAuthHealthy).toBe(false);
  });

  it("returns 504 when upstream SDK rejects with AbortError on timeout", async () => {
    const generateContent = vi.fn(
      async (params: { config?: { abortSignal?: AbortSignal } }) =>
        await new Promise<never>((_, reject) => {
          params.config?.abortSignal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
      upstreamTimeoutMs: 25,
    });
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Đợi chút nhé", region: "north" }),
    });
    expect(res.status).toBe(504);
  });

  it("fails fast on 402 billing credit depletion, enters cooldown, and updates status/healthz", async () => {
    const generateContent = vi.fn(async () => {
      await Promise.resolve();
      throw new Error(
        JSON.stringify({
          error: {
            code: 402,
            message: "Your prepayment credits are depleted.",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
      );
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const firstRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào", region: "south" }),
    });
    expect(firstRes.status).toBe(402);
    expect(Number(firstRes.headers.get("Retry-After"))).toBeGreaterThan(0);
    const firstJson = (await firstRes.json()) as { error: string; retryAfterSeconds: number };
    expect(firstJson.error).toContain("credits are depleted");
    expect(firstJson.error).not.toContain("RESOURCE_EXHAUSTED");
    expect(generateContent).toHaveBeenCalledTimes(1);

    const secondRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Cảm ơn", region: "south" }),
    });
    expect(secondRes.status).toBe(402);
    expect(generateContent).toHaveBeenCalledTimes(1);

    const statusRes = await fetch(`${baseUrl}/api/tts/status`);
    const statusJson = (await statusRes.json()) as { available: boolean };
    expect(statusJson.available).toBe(false);

    const healthRes = await fetch(`${baseUrl}/healthz`);
    const healthJson = (await healthRes.json()) as { upstreamBillingHealthy: boolean };
    expect(healthJson.upstreamBillingHealthy).toBe(false);
  });

  it("does not poison auth health on non-auth 400 errors and recovers after auth cooldown or key rotation", async () => {
    const generateContent = vi.fn(async () => {
      await Promise.resolve();
      throw Object.assign(new Error("INVALID_ARGUMENT: empty speech directive"), { status: 400 });
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const badReqRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào", region: "south" }),
    });
    expect(badReqRes.status).toBe(400);

    const healthRes = await fetch(`${baseUrl}/healthz`);
    const healthJson = (await healthRes.json()) as { upstreamAuthHealthy: boolean };
    expect(healthJson.upstreamAuthHealthy).toBe(true);

    let nowMs = 1_000_000;
    let currentKey = "key-bad";
    vi.stubEnv("GEMINI_API_KEY", currentKey);
    const client = new GeminiTtsClient({
      upstreamTimeoutMs: 5000,
      now: () => nowMs,
    });
    const fakeAiAuth = {
      models: {
        generateContent: vi.fn(async () => {
          await Promise.resolve();
          throw Object.assign(new Error("API key invalid"), { status: 403 });
        }),
      },
    } as unknown as GoogleGenAI;

    await expect(client.generateSpeech(fakeAiAuth, "Chào", "south", false, "auto")).rejects.toThrow(
      /authenticate/,
    );
    expect(client.isAuthHealthy()).toBe(false);

    // Recovers when API key rotates
    currentKey = "key-rotated";
    vi.stubEnv("GEMINI_API_KEY", currentKey);
    expect(client.isAuthHealthy()).toBe(true);

    // Recovers after auth cooldown TTL expires
    await expect(client.generateSpeech(fakeAiAuth, "Chào", "south", false, "auto")).rejects.toThrow(
      /authenticate/,
    );
    expect(client.isAuthHealthy()).toBe(false);
    nowMs += 300_001;
    expect(client.isAuthHealthy()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("recovers disk cache directory after external deletion and prunes orphan .tmp files", async () => {
    const cacheDir = createTempCacheDir();
    let nowMs = 1_700_000_000_000;
    const diskCache = new TtsDiskCache({
      cacheDir,
      maxEntries: 10,
      maxBytes: 1024 * 1024,
      now: () => nowMs,
    });

    expect(await diskCache.ensureWritable()).toBe(true);
    rmSync(cacheDir, { recursive: true, force: true });
    expect(existsSync(cacheDir)).toBe(false);
    expect(await diskCache.ensureWritable()).toBe(true);
    expect(existsSync(cacheDir)).toBe(true);

    const orphanPath = path.join(cacheDir, "stale.wav.123.tmp");
    writeFileSync(orphanPath, Buffer.from("partial"));
    const staleDate = new Date(nowMs - 400_000);
    utimesSync(orphanPath, staleDate, staleDate);

    const activeTmpPath = path.join(cacheDir, "active.wav.124.tmp");
    writeFileSync(activeTmpPath, Buffer.from("writing"));
    const freshDate = new Date(nowMs - 5_000);
    utimesSync(activeTmpPath, freshDate, freshDate);

    await diskCache.prune();
    expect(existsSync(orphanPath)).toBe(false);
    expect(existsSync(activeTmpPath)).toBe(true);
    nowMs += 1000;
  });

  it("excludes and unlinks truncated <=44 byte corrupt wav files when counting clips", async () => {
    const cacheDir = createTempCacheDir();
    writeFileSync(path.join(cacheDir, "truncated.wav"), Buffer.from("RIFF1234WAVEfmt "));
    const validWav = Buffer.from(makeFakeWavBase64(), "base64");
    writeFileSync(path.join(cacheDir, "valid.wav"), validWav);

    const diskCache = new TtsDiskCache({
      cacheDir,
      maxEntries: 10,
      maxBytes: 1024 * 1024,
    });

    const count = await diskCache.countClips();
    expect(count).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(path.join(cacheDir, "truncated.wav"))).toBe(false);
    expect(existsSync(path.join(cacheDir, "valid.wav"))).toBe(true);
  });

  it("falls back to browser-regional Vietnamese voice on 402 billing depletion and caches MP3 clips", async () => {
    const cacheDir = createTempCacheDir();
    const fakeMp3 = Buffer.alloc(256, 0xaa);
    fakeMp3[0] = 0xff;
    fakeMp3[1] = 0xf3;

    const generateContent = vi.fn(async () => {
      await Promise.resolve();
      throw new Error(
        JSON.stringify({
          error: {
            code: 402,
            message: "Your prepayment credits are depleted.",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
      );
    });
    const webFallback = vi.fn(async () => {
      await Promise.resolve();
      return {
        audioBuffer: fakeMp3,
        contentType: "audio/mpeg" as const,
      };
    });

    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;
    const { baseUrl, server } = await startTestServer({
      aiClient: fakeAi,
      webTtsFallback: webFallback,
      diskCacheDir: cacheDir,
    });
    servers.push(server);

    const firstRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào", region: "south" }),
    });
    expect(firstRes.status).toBe(200);
    expect(firstRes.headers.get("Content-Type")).toContain("audio/mpeg");
    expect(firstRes.headers.get("X-TTS-Engine")).toBe("browser-regional");
    expect(firstRes.headers.get("X-TTS-Cache")).toBe("miss");
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(webFallback).toHaveBeenCalledTimes(1);

    // Subsequent call uses memory cache without hitting Gemini or web fallback again
    const secondRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Xin chào", region: "south" }),
    });
    expect(secondRes.status).toBe(200);
    expect(secondRes.headers.get("X-TTS-Cache")).toBe("memory");
    expect(secondRes.headers.get("X-TTS-Engine")).toBe("browser-regional");
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(webFallback).toHaveBeenCalledTimes(1);

    const statusRes = await fetch(`${baseUrl}/api/tts/status`);
    const statusJson = (await statusRes.json()) as {
      available: boolean;
      engine: string;
      cachedClips: number;
    };
    expect(statusJson.available).toBe(true);
    expect(statusJson.engine).toBe("browser-regional");

    await new Promise((r) => setTimeout(r, 40));
    const mp3Files = readdirSync(cacheDir).filter((name) => name.endsWith(".mp3"));
    expect(mp3Files.length).toBe(1);
  });

  it("serves browser-regional voice when Gemini API key is unconfigured and chunks long text cleanly", async () => {
    const fakeMp3 = Buffer.alloc(256, 0xbb);
    fakeMp3[0] = 0x49;
    fakeMp3[1] = 0x44;
    fakeMp3[2] = 0x33;

    const webFallback = vi.fn(async () => {
      await Promise.resolve();
      return { audioBuffer: fakeMp3, contentType: "audio/mpeg" as const };
    });

    const { baseUrl, server } = await startTestServer({
      aiClient: null,
      apiKey: "",
      webTtsFallback: webFallback,
      diskCacheDir: createTempCacheDir(),
    });
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Cà phê sữa đá nha", region: "central" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-TTS-Region")).toBe("central");
    expect(res.headers.get("X-TTS-Engine")).toBe("browser-regional");

    const chunks = splitTextIntoSpeechChunks(
      "Cho mình một ly cà phê sữa đá ít ngọt nhé. Hôm nay trời Sài Gòn nắng đẹp quá, mình đi dạo quanh chợ Bến Thành rồi ghé ăn phở bò tái nạm với bạn bè.",
      80,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
  });

  it("caches regional WAV fallback clips on disk and separates cache entries by region and voiceProfile", async () => {
    const cacheDir = createTempCacheDir();
    const fakeWav = Buffer.from(makeFakeWavBase64(), "base64");
    const webFallback = vi.fn(async () => {
      await Promise.resolve();
      return { audioBuffer: fakeWav, contentType: "audio/wav" as const };
    });

    const { baseUrl, server } = await startTestServer({
      aiClient: null,
      apiKey: "",
      webTtsFallback: webFallback,
      diskCacheDir: cacheDir,
    });
    servers.push(server);

    const southFemaleRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Được rồi anh", region: "south", voiceProfile: "female" }),
    });
    expect(southFemaleRes.status).toBe(200);
    expect(southFemaleRes.headers.get("Content-Type")).toContain("audio/wav");
    expect(southFemaleRes.headers.get("X-TTS-Cache")).toBe("miss");

    const northFemaleRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Được rồi anh", region: "north", voiceProfile: "female" }),
    });
    expect(northFemaleRes.status).toBe(200);
    expect(northFemaleRes.headers.get("X-TTS-Cache")).toBe("miss");

    const southMaleRes = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Được rồi anh", region: "south", voiceProfile: "male" }),
    });
    expect(southMaleRes.status).toBe(200);
    expect(southMaleRes.headers.get("X-TTS-Cache")).toBe("miss");
    expect(webFallback).toHaveBeenCalledTimes(3);

    await new Promise((r) => setTimeout(r, 40));
    const wavFiles = readdirSync(cacheDir).filter((name) => name.endsWith(".wav"));
    expect(wavFiles.length).toBe(3);

    // Fresh server instance should serve cached WAV from disk without calling fallback again
    const { baseUrl: baseUrl2, server: server2 } = await startTestServer({
      aiClient: null,
      apiKey: "",
      webTtsFallback: webFallback,
      diskCacheDir: cacheDir,
    });
    servers.push(server2);

    const diskHitRes = await fetch(`${baseUrl2}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Được rồi anh", region: "south", voiceProfile: "female" }),
    });
    expect(diskHitRes.status).toBe(200);
    expect(diskHitRes.headers.get("Content-Type")).toContain("audio/wav");
    expect(diskHitRes.headers.get("X-TTS-Cache")).toBe("disk");
    expect(webFallback).toHaveBeenCalledTimes(3);
  });
});
