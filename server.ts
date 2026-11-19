import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GoogleGenAI } from "@google/genai";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  GeminiTtsClient,
  getErrorStatus,
  PRIMARY_TTS_MODEL,
  TtsAuthError,
  TtsBillingError,
  TtsTimeoutError,
} from "./src/server/geminiTtsClient.ts";
import { TtsRateLimitError, TtsRateLimiter } from "./src/server/rateLimiter.ts";
import { type CachedAudioContentType, TtsDiskCache } from "./src/server/ttsDiskCache.ts";
import {
  synthesizeWebRegionalVietnameseTts,
  type WebTtsSynthesizer,
} from "./src/server/webVietnameseTts.ts";
import type { DialectRegion, TtsVoiceProfile } from "./src/types/vietnamese.ts";

const BROWSER_REGIONAL_ENGINE = "browser-regional";

interface CachedAudioEntry {
  buffer: Buffer;
  contentType: CachedAudioContentType;
  engine: "gemini" | typeof BROWSER_REGIONAL_ENGINE;
}

interface TtsRequestBody {
  text?: unknown;
  region?: unknown;
  slow?: unknown;
  voiceProfile?: unknown;
}

export interface ServerOptions {
  aiClient?: GoogleGenAI | null;
  apiKey?: string;
  webTtsFallback?: WebTtsSynthesizer | null;
  diskCacheDir?: string;
  maxMemoryCacheEntries?: number;
  maxDiskCacheEntries?: number;
  maxDiskCacheBytes?: number;
  upstreamTimeoutMs?: number;
  maxRequestsPerWindow?: number;
  maxMissesPerWindow?: number;
  maxGlobalMissesPerWindow?: number;
  maxConcurrentUpstream?: number;
  rateLimitWindowMs?: number;
  isProduction?: boolean;
  now?: () => number;
}

const parsedPort = Number(process.env["PORT"]);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const MAX_TEXT_LENGTH = 400;
const DEFAULT_MAX_MEMORY_CACHE_ENTRIES = 240;
const DEFAULT_MAX_DISK_CACHE_ENTRIES = 500;
const DEFAULT_MAX_DISK_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 180;
const DEFAULT_MAX_MISSES_PER_WINDOW = 25;
const DEFAULT_MAX_GLOBAL_MISSES_PER_WINDOW = 120;
const DEFAULT_MAX_CONCURRENT_UPSTREAM = 8;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function parseRegion(value: unknown): DialectRegion {
  if (value === "north" || value === "central" || value === "south") {
    return value;
  }
  return "south";
}

function parseVoiceProfile(value: unknown): TtsVoiceProfile {
  if (value === "female" || value === "male" || value === "auto") {
    return value;
  }
  return "auto";
}

function isAllowedNativeOrAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (
    origin === "https://localhost" ||
    origin === "http://localhost" ||
    origin === "capacitor://localhost" ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }
  const appUrl = process.env["APP_URL"]?.trim().replace(/\/+$/, "");
  if (appUrl && origin === appUrl) {
    return true;
  }
  return false;
}

function getAssetLinksPayload(): unknown[] {
  const rawPackageName = process.env["ANDROID_PACKAGE_NAME"]?.trim();
  const packageName =
    rawPackageName && rawPackageName.length > 0 ? rawPackageName : "app.noi.vietnamese";
  const rawFingerprints = process.env["ANDROID_SHA256_FINGERPRINTS"]?.trim() ?? "";
  const fingerprints = rawFingerprints
    .split(",")
    .map((fp) => fp.trim())
    .filter((fp) => fp.length > 0);

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints:
          fingerprints.length > 0
            ? fingerprints
            : ["REPLACE_WITH_GOOGLE_PLAY_APP_SIGNING_SHA256_FINGERPRINT"],
      },
    },
  ];
}

class TtsNotConfiguredError extends Error {
  readonly status = 503;

  constructor() {
    super("Regional Vietnamese cloud TTS is not configured on this server.");
  }
}

function formatTtsError(err: unknown): {
  status: number;
  message: string;
  retryAfterSeconds?: number;
} {
  if (err instanceof TtsNotConfiguredError) {
    return {
      status: 503,
      message: err.message,
    };
  }
  if (err instanceof TtsRateLimitError) {
    return {
      status: 429,
      message: err.message,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }
  if (err instanceof TtsBillingError) {
    return {
      status: 402,
      message: err.message,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }
  if (err instanceof TtsTimeoutError) {
    return {
      status: 504,
      message: err.message,
    };
  }
  if (err instanceof TtsAuthError) {
    return {
      status: err.status,
      message: err.message,
    };
  }

  const rawMessage = err instanceof Error ? err.message : "Failed to synthesize Vietnamese audio.";
  const statusVal = getErrorStatus(err);
  const status = typeof statusVal === "number" && statusVal >= 400 ? statusVal : 500;

  if (status === 401 || status === 403) {
    return {
      status,
      message: "Vietnamese cloud voice could not authenticate. Check Settings > Secrets.",
    };
  }
  if (status === 402) {
    return {
      status: 402,
      message:
        "Vietnamese cloud voice credits are depleted. Manage billing in AI Studio or use an on-device voice or Tone Melody.",
      retryAfterSeconds: 300,
    };
  }
  if (status === 429) {
    return {
      status,
      message: "Vietnamese voice rate limit reached. Try again in a moment.",
      retryAfterSeconds: 60,
    };
  }
  return { status, message: rawMessage };
}

function sendAudioResponse(
  res: Response,
  region: DialectRegion,
  entry: CachedAudioEntry,
  cacheState: "memory" | "disk" | "miss",
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("X-TTS-Region", region);
  res.setHeader("X-TTS-Cache", cacheState);
  res.setHeader("X-TTS-Engine", entry.engine);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(entry.buffer);
}

function sendTtsErrorResponse(res: Response, err: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const formatted = formatTtsError(err);
  if (
    (formatted.status === 429 || formatted.status === 402) &&
    formatted.retryAfterSeconds !== undefined
  ) {
    res.setHeader("Retry-After", String(formatted.retryAfterSeconds));
    res.status(formatted.status).json({
      error: formatted.message,
      retryAfterSeconds: formatted.retryAfterSeconds,
    });
    return;
  }
  if (formatted.status >= 500 && formatted.status !== 503 && formatted.status !== 504) {
    console.warn("Vietnamese TTS fallback triggered:", formatted.message);
  }
  res.status(formatted.status).json({ error: formatted.message });
}

function getClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function validateTtsRequest(
  req: Request,
  res: Response,
): {
  text: string;
  region: DialectRegion;
  slow: boolean;
  voiceProfile: TtsVoiceProfile;
  cacheKey: string;
  webCacheKey: string;
} | null {
  const body = (req.body ?? {}) as TtsRequestBody;
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    res.status(400).json({ error: "Text is required for Vietnamese speech synthesis." });
    return null;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: "Phrase is too long for single-clip playback." });
    return null;
  }

  const region = parseRegion(body.region);
  const slow = body.slow === true;
  const voiceProfile = parseVoiceProfile(body.voiceProfile);
  const cacheVersion = slow ? "v7" : "v6";
  const cacheKey = `${cacheVersion}:${region}:${slow ? "slow" : "normal"}:${voiceProfile}:${text}`;
  const webCacheKey = `${cacheVersion}-web:${region}:${slow ? "slow" : "normal"}:${voiceProfile}:${text}`;
  return { text, region, slow, voiceProfile, cacheKey, webCacheKey };
}

function shouldFallbackFromGeminiError(err: unknown): boolean {
  if (
    err instanceof TtsBillingError ||
    err instanceof TtsAuthError ||
    err instanceof TtsTimeoutError ||
    err instanceof TtsRateLimitError
  ) {
    return true;
  }
  const status = getErrorStatus(err);
  if (status === 400) return false;
  return true;
}

export function createApp(options: ServerOptions = {}): Express {
  const envCacheDir = process.env["TTS_CACHE_DIR"]?.trim();
  const diskCacheDir =
    options.diskCacheDir ??
    (envCacheDir && envCacheDir.length > 0
      ? path.resolve(envCacheDir)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".tts-cache"));
  const maxMemoryCacheEntries = options.maxMemoryCacheEntries ?? DEFAULT_MAX_MEMORY_CACHE_ENTRIES;
  const maxConcurrentUpstream = options.maxConcurrentUpstream ?? DEFAULT_MAX_CONCURRENT_UPSTREAM;
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const webTtsFallback: WebTtsSynthesizer | null =
    options.webTtsFallback === undefined
      ? synthesizeWebRegionalVietnameseTts
      : options.webTtsFallback;

  const diskCache = new TtsDiskCache({
    cacheDir: diskCacheDir,
    maxEntries: options.maxDiskCacheEntries ?? DEFAULT_MAX_DISK_CACHE_ENTRIES,
    maxBytes: options.maxDiskCacheBytes ?? DEFAULT_MAX_DISK_CACHE_BYTES,
    now,
  });

  const rateLimiter = new TtsRateLimiter({
    maxRequestsPerWindow: options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW,
    maxMissesPerWindow: options.maxMissesPerWindow ?? DEFAULT_MAX_MISSES_PER_WINDOW,
    maxGlobalMissesPerWindow:
      options.maxGlobalMissesPerWindow ?? DEFAULT_MAX_GLOBAL_MISSES_PER_WINDOW,
    windowMs: options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const ttsClient = new GeminiTtsClient({
    aiClient: options.aiClient,
    apiKey: options.apiKey,
    upstreamTimeoutMs,
    now,
  });

  const audioCache = new Map<string, CachedAudioEntry>();
  const inflightResolutions = new Map<
    string,
    Promise<{ entry: CachedAudioEntry; cacheState: "memory" | "disk" | "miss" }>
  >();
  let activeUpstreamCount = 0;

  const setCachedAudio = (key: string, entry: CachedAudioEntry): void => {
    if (audioCache.has(key)) {
      audioCache.delete(key);
    } else if (audioCache.size >= maxMemoryCacheEntries) {
      const oldestKey = audioCache.keys().next().value;
      if (oldestKey !== undefined) {
        audioCache.delete(oldestKey);
      }
    }
    audioCache.set(key, entry);
  };

  const isGeminiReady = (): boolean =>
    ttsClient.resolveAiClient() !== null &&
    ttsClient.isAuthHealthy() &&
    ttsClient.isBillingHealthy();

  const resolveWebFallbackAudio = async (
    params: {
      clientIp: string;
      text: string;
      region: DialectRegion;
      slow: boolean;
      voiceProfile: TtsVoiceProfile;
      webCacheKey: string;
    },
    rateLimitAlreadyChecked: boolean,
  ): Promise<{ entry: CachedAudioEntry; cacheState: "memory" | "disk" | "miss" }> => {
    if (!webTtsFallback) {
      throw new TtsNotConfiguredError();
    }

    const memHit = audioCache.get(params.webCacheKey);
    if (memHit) {
      setCachedAudio(params.webCacheKey, memHit);
      return { entry: memHit, cacheState: "memory" };
    }

    const diskWav = await diskCache.read(params.webCacheKey, "audio/wav");
    if (diskWav) {
      const entry: CachedAudioEntry = {
        buffer: diskWav,
        contentType: "audio/wav",
        engine: BROWSER_REGIONAL_ENGINE,
      };
      setCachedAudio(params.webCacheKey, entry);
      return { entry, cacheState: "disk" };
    }

    const diskMp3 = await diskCache.read(params.webCacheKey, "audio/mpeg");
    if (diskMp3) {
      const entry: CachedAudioEntry = {
        buffer: diskMp3,
        contentType: "audio/mpeg",
        engine: BROWSER_REGIONAL_ENGINE,
      };
      setCachedAudio(params.webCacheKey, entry);
      return { entry, cacheState: "disk" };
    }

    if (!rateLimitAlreadyChecked) {
      const missRetryAfter = rateLimiter.checkUpstreamMiss(params.clientIp);
      if (missRetryAfter !== null) {
        throw new TtsRateLimitError(missRetryAfter);
      }
    }

    if (activeUpstreamCount >= maxConcurrentUpstream) {
      throw new TtsRateLimitError(3);
    }

    activeUpstreamCount += 1;
    try {
      const synthesized = await webTtsFallback(
        params.text,
        params.region,
        params.slow,
        params.voiceProfile,
        upstreamTimeoutMs,
      );
      const entry: CachedAudioEntry = {
        buffer: synthesized.audioBuffer,
        contentType: synthesized.contentType,
        engine: BROWSER_REGIONAL_ENGINE,
      };
      setCachedAudio(params.webCacheKey, entry);
      void diskCache.write(params.webCacheKey, entry.buffer, entry.contentType);
      return { entry, cacheState: "miss" };
    } finally {
      activeUpstreamCount = Math.max(0, activeUpstreamCount - 1);
    }
  };

  const synthesizeWithGemini = async (
    ai: GoogleGenAI,
    params: {
      clientIp: string;
      text: string;
      region: DialectRegion;
      slow: boolean;
      voiceProfile: TtsVoiceProfile;
      cacheKey: string;
    },
  ): Promise<{ entry: CachedAudioEntry; cacheState: "miss" }> => {
    const missRetryAfter = rateLimiter.checkUpstreamMiss(params.clientIp);
    if (missRetryAfter !== null) {
      throw new TtsRateLimitError(missRetryAfter);
    }
    if (activeUpstreamCount >= maxConcurrentUpstream) {
      throw new TtsRateLimitError(3);
    }

    activeUpstreamCount += 1;
    try {
      const wavBuffer = await ttsClient.generateSpeech(
        ai,
        params.text,
        params.region,
        params.slow,
        params.voiceProfile,
      );
      const entry: CachedAudioEntry = {
        buffer: wavBuffer,
        contentType: "audio/wav",
        engine: "gemini",
      };
      setCachedAudio(params.cacheKey, entry);
      void diskCache.write(params.cacheKey, wavBuffer, "audio/wav");
      return { entry, cacheState: "miss" };
    } finally {
      activeUpstreamCount = Math.max(0, activeUpstreamCount - 1);
    }
  };

  const synthesizeOrFallback = async (params: {
    clientIp: string;
    text: string;
    region: DialectRegion;
    slow: boolean;
    voiceProfile: TtsVoiceProfile;
    cacheKey: string;
    webCacheKey: string;
  }): Promise<{ entry: CachedAudioEntry; cacheState: "memory" | "disk" | "miss" }> => {
    const diskCached = await diskCache.read(params.cacheKey, "audio/wav");
    if (diskCached) {
      const entry: CachedAudioEntry = {
        buffer: diskCached,
        contentType: "audio/wav",
        engine: "gemini",
      };
      setCachedAudio(params.cacheKey, entry);
      return { entry, cacheState: "disk" };
    }

    const ai = ttsClient.resolveAiClient();
    if (!isGeminiReady() && webTtsFallback) {
      return resolveWebFallbackAudio(params, false);
    }
    if (!ai) {
      throw new TtsNotConfiguredError();
    }

    try {
      return await synthesizeWithGemini(ai, params);
    } catch (geminiError) {
      if (webTtsFallback && shouldFallbackFromGeminiError(geminiError)) {
        try {
          return await resolveWebFallbackAudio(params, true);
        } catch {
          throw geminiError;
        }
      }
      throw geminiError;
    }
  };

  const handleTtsPost = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    const totalRetryAfter = rateLimiter.checkTotalRequest(clientIp);
    if (totalRetryAfter !== null) {
      sendTtsErrorResponse(res, new TtsRateLimitError(totalRetryAfter));
      return;
    }

    const parsed = validateTtsRequest(req, res);
    if (!parsed) return;

    const { text, region, slow, voiceProfile, cacheKey, webCacheKey } = parsed;
    const cached = audioCache.get(cacheKey);
    if (cached) {
      setCachedAudio(cacheKey, cached);
      sendAudioResponse(res, region, cached, "memory");
      return;
    }

    if (!isGeminiReady() && webTtsFallback) {
      const webCached = audioCache.get(webCacheKey);
      if (webCached) {
        setCachedAudio(webCacheKey, webCached);
        sendAudioResponse(res, region, webCached, "memory");
        return;
      }
    }

    const existingInflight = inflightResolutions.get(cacheKey);
    if (existingInflight) {
      try {
        const joined = await existingInflight;
        sendAudioResponse(res, region, joined.entry, "memory");
      } catch (err) {
        sendTtsErrorResponse(res, err);
      }
      return;
    }

    const resolutionPromise = synthesizeOrFallback({
      clientIp,
      text,
      region,
      slow,
      voiceProfile,
      cacheKey,
      webCacheKey,
    }).finally(() => {
      inflightResolutions.delete(cacheKey);
    });

    inflightResolutions.set(cacheKey, resolutionPromise);
    try {
      const resolved = await resolutionPromise;
      sendAudioResponse(res, region, resolved.entry, resolved.cacheState);
    } catch (err) {
      sendTtsErrorResponse(res, err);
    }
  };

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));

  app.use("/api", (req: Request, res: Response, next) => {
    const origin = req.headers.origin;
    if (isAllowedNativeOrAppOrigin(origin) && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader(
        "Access-Control-Expose-Headers",
        "X-TTS-Cache, X-TTS-Region, X-TTS-Engine, Retry-After",
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/healthz", (_req: Request, res: Response, next: NextFunction) => {
    void diskCache
      .ensureWritable()
      .then((diskCacheWritable) => {
        res.status(diskCacheWritable ? 200 : 503).json({
          ok: diskCacheWritable,
          diskCacheWritable,
          ttsConfigured: ttsClient.resolveAiClient() !== null,
          browserRegionalFallbackEnabled: webTtsFallback !== null,
          uptimeSeconds: Math.floor(process.uptime()),
          memoryCacheEntries: audioCache.size,
          activeUpstreamCount,
          upstreamCooldownModels: ttsClient.getCooldownModels(),
          upstreamAuthHealthy: ttsClient.isAuthHealthy(),
          upstreamBillingHealthy: ttsClient.isBillingHealthy(),
        });
      })
      .catch(next);
  });

  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(getAssetLinksPayload());
  });

  app.get("/privacy", (_req: Request, res: Response) => {
    const rootDir = path.dirname(fileURLToPath(import.meta.url));
    const isProd = options.isProduction ?? process.env["NODE_ENV"] === "production";
    const privacyFile = isProd
      ? path.resolve(rootDir, "dist", "privacy.html")
      : path.resolve(rootDir, "public", "privacy.html");
    res.sendFile(privacyFile, (err: Error | null | undefined) => {
      if (err !== null && err !== undefined && !res.headersSent) {
        res.status(404).type("text/plain").send("Privacy policy page not found.");
      }
    });
  });

  app.get("/api/tts/status", (_req: Request, res: Response, next: NextFunction) => {
    void diskCache
      .countClips()
      .then((cachedClips) => {
        const geminiAvailable = isGeminiReady();
        const browserRegionalAvailable = webTtsFallback !== null;
        const available = geminiAvailable || browserRegionalAvailable;
        const engine = geminiAvailable
          ? PRIMARY_TTS_MODEL
          : browserRegionalAvailable
            ? BROWSER_REGIONAL_ENGINE
            : PRIMARY_TTS_MODEL;
        res.json({
          available,
          engine,
          cachedClips,
        });
      })
      .catch(next);
  });

  app.post("/api/tts", (req: Request, res: Response, next: NextFunction) => {
    void handleTtsPost(req, res).catch(next);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      _next(err);
      return;
    }
    const status = getErrorStatus(err) ?? 500;
    const message =
      status === 400
        ? "Malformed JSON request payload."
        : "Unexpected server error while processing request.";
    res.status(status).json({ error: message });
  });

  return app;
}

async function startServer(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  const rootDir = path.dirname(fileURLToPath(import.meta.url));

  const isProduction = process.env["NODE_ENV"] === "production";
  let viteClose: (() => Promise<void>) | null = null;
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const disableHmr = process.env["DISABLE_HMR"] === "true";
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : { server: httpServer },
      },
      appType: "spa",
    });
    viteClose = async () => vite.close();
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(rootDir, "dist");
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const baseName = path.basename(filePath);
          if (baseName === "sw.js" || baseName === "registerSW.js") {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          } else if (baseName === "manifest.webmanifest") {
            res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
            res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
          }
        },
      }),
    );
    app.get("/{*path}", (_req: Request, res: Response, next: NextFunction) => {
      res.sendFile(path.join(distDir, "index.html"), (err: Error | null | undefined) => {
        if (err !== null && err !== undefined && !res.headersSent) {
          next(err);
        }
      });
    });
  }

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 15_000;
  httpServer.keepAliveTimeout = 65_000;

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.warn(`Server listening on http://0.0.0.0:${String(PORT)}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExitTimer = setTimeout(() => {
      process.exit(0);
    }, 5000);
    forceExitTimer.unref();
    void (async () => {
      if (viteClose) {
        await viteClose().catch(() => undefined);
      }
      httpServer.close(() => {
        clearTimeout(forceExitTimer);
        process.exit(0);
      });
    })();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection in server:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception in server:", err);
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentFilePath = fileURLToPath(import.meta.url);
if (invokedPath === currentFilePath) {
  void startServer();
}
