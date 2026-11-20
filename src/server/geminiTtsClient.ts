import { GoogleGenAI } from "@google/genai";
import { buildRegionalVoiceSpec } from "../services/ttsDialectProfile.ts";
import { conditionTtsWav } from "../services/wavPostProcess.ts";
import type { DialectRegion, TtsVoiceProfile } from "../types/vietnamese.ts";
import { TtsRateLimitError } from "./rateLimiter.ts";
import { isValidWavBuffer } from "./ttsDiskCache.ts";

export const PRIMARY_TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const FALLBACK_TTS_MODEL = "gemini-3.8-flash-tts";

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;
const DEFAULT_BILLING_COOLDOWN_MS = 300_000;
const DEFAULT_AUTH_COOLDOWN_MS = 300_000;

const TRANSIENT_STATUS_CODES = new Set([408, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export class TtsTimeoutError extends Error {
  readonly status = 504;

  constructor() {
    super("Vietnamese cloud voice timed out. Please try again.");
  }
}

export class TtsAuthError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Vietnamese cloud voice could not authenticate. Check Settings > Secrets.");
    this.status = status;
  }
}

export class TtsBillingError extends Error {
  readonly status = 402;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 300) {
    super(
      "Vietnamese cloud voice credits are depleted. Manage billing in AI Studio or use an on-device voice or Tone Melody.",
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = "status" in err ? (err as { status?: unknown }).status : undefined;
  if (typeof status === "number") return status;
  if (err instanceof Error) {
    const codeMatch = /"code"\s*:\s*(\d{3})/.exec(err.message);
    if (codeMatch?.[1]) return Number(codeMatch[1]);
  }
  return undefined;
}

function isBillingDepletedError(err: unknown, status: number | undefined): boolean {
  if (status === 402) return true;
  if (err instanceof Error) {
    return /prepayment credits|credits are depleted|billing#prepay/i.test(err.message);
  }
  return false;
}

function isUpstreamAuthError(err: unknown, status: number | undefined): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 400 && err instanceof Error) {
    return /api[_ ]?key|unauthenticated|permission|credentials|invalid authentication/i.test(
      err.message,
    );
  }
  return false;
}

function parseRateLimitCooldownMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : "";
  const retryMatch = /retryDelay"\s*:\s*"([\d.]+)s"|retry in ([\d.]+)s/i.exec(msg);
  const rawSeconds = retryMatch?.[1] ?? retryMatch?.[2];
  if (rawSeconds) {
    const parsedMs = Math.ceil(Number(rawSeconds) * 1000);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(5_000, parsedMs));
    }
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function isTransientUpstreamError(err: unknown, status: number | undefined): boolean {
  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) {
    return true;
  }
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }
  if (
    err instanceof Error &&
    /fetch failed|network|socket hang up|econnreset|etimedout/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

export interface GeminiTtsClientOptions {
  aiClient?: GoogleGenAI | null | undefined;
  apiKey?: string | undefined;
  upstreamTimeoutMs: number;
  now?: () => number;
}

export class GeminiTtsClient {
  private readonly fixedAiClient: GoogleGenAI | null | undefined;
  private readonly fixedApiKey: string | undefined;
  private readonly upstreamTimeoutMs: number;
  private readonly now: () => number;
  private readonly modelCooldownUntil = new Map<string, number>();
  private authCooldown: { apiKey: string; until: number } | null = null;
  private billingCooldown: { apiKey: string; until: number } | null = null;
  private cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;

  constructor(options: GeminiTtsClientOptions) {
    this.fixedAiClient = options.aiClient;
    this.fixedApiKey = options.apiKey;
    this.upstreamTimeoutMs = options.upstreamTimeoutMs;
    this.now = options.now ?? Date.now;
  }

  private getApiKey(): string {
    if (this.fixedApiKey !== undefined) return this.fixedApiKey.trim();
    return process.env["GEMINI_API_KEY"]?.trim() ?? "";
  }

  resolveAiClient(): GoogleGenAI | null {
    if (this.fixedAiClient !== undefined) {
      return this.fixedAiClient;
    }
    const apiKey = this.getApiKey();
    if (!apiKey) return null;
    if (this.cachedAiClient?.apiKey === apiKey) {
      return this.cachedAiClient.client;
    }
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    this.cachedAiClient = { apiKey, client };
    return client;
  }

  getCooldownModels(): string[] {
    const ts = this.now();
    return Array.from(this.modelCooldownUntil.entries())
      .filter(([, until]) => until > ts)
      .map(([model]) => model);
  }

  hasAvailableModel(): boolean {
    const ts = this.now();
    for (const model of [PRIMARY_TTS_MODEL, FALLBACK_TTS_MODEL]) {
      const blockedUntil = this.modelCooldownUntil.get(model) ?? 0;
      if (blockedUntil <= ts) {
        return true;
      }
    }
    return false;
  }

  isAuthHealthy(): boolean {
    if (!this.authCooldown) return true;
    if (this.authCooldown.apiKey !== this.getApiKey() || this.now() >= this.authCooldown.until) {
      this.authCooldown = null;
      return true;
    }
    return false;
  }

  getBillingCooldownRemainingSeconds(): number {
    if (!this.billingCooldown) return 0;
    if (this.billingCooldown.apiKey !== this.getApiKey()) {
      this.billingCooldown = null;
      return 0;
    }
    const remainingMs = this.billingCooldown.until - this.now();
    if (remainingMs <= 0) {
      this.billingCooldown = null;
      return 0;
    }
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  isBillingHealthy(): boolean {
    return this.getBillingCooldownRemainingSeconds() === 0;
  }

  private async synthesizeWithModel(
    ai: GoogleGenAI,
    model: string,
    text: string,
    styleDirective: string,
    voiceName: string,
    timeoutMs: number,
  ): Promise<Buffer> {
    if (timeoutMs <= 0) {
      throw new TtsTimeoutError();
    }
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new TtsTimeoutError());
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text,
                  speechMetadata: {
                    style: styleDirective,
                  },
                },
              ],
            },
          ],
          config: {
            abortSignal: controller.signal,
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: "vi-VN",
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
        timeoutPromise,
      ]);

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error("No audio data returned by Vietnamese TTS model.");
      }
      const conditioned = conditionTtsWav(Buffer.from(base64Audio, "base64"));
      if (!isValidWavBuffer(conditioned)) {
        throw new Error("Invalid audio payload returned by Vietnamese TTS model.");
      }
      return conditioned;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new TtsTimeoutError();
      }
      throw err;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async shouldRetryModelError(
    model: string,
    err: unknown,
    attempt: number,
    deadlineMs: number,
  ): Promise<boolean> {
    const status = getErrorStatus(err);
    if (isUpstreamAuthError(err, status)) {
      this.authCooldown = {
        apiKey: this.getApiKey(),
        until: this.now() + DEFAULT_AUTH_COOLDOWN_MS,
      };
      throw new TtsAuthError(status ?? 403);
    }
    if (isBillingDepletedError(err, status)) {
      this.billingCooldown = {
        apiKey: this.getApiKey(),
        until: this.now() + DEFAULT_BILLING_COOLDOWN_MS,
      };
      throw new TtsBillingError(Math.ceil(DEFAULT_BILLING_COOLDOWN_MS / 1000));
    }
    if (status === 429) {
      const cooldownMs = parseRateLimitCooldownMs(err);
      this.modelCooldownUntil.set(model, this.now() + cooldownMs);
      throw new TtsRateLimitError(Math.max(1, Math.ceil(cooldownMs / 1000)));
    }
    const remainingMs = deadlineMs - this.now();
    if (attempt === 0 && isTransientUpstreamError(err, status) && remainingMs > 500) {
      const jitterMs = 300 + Math.floor(Math.random() * 200);
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(jitterMs, Math.max(50, remainingMs - 100)));
      });
      return true;
    }
    return false;
  }

  private async tryModelWithTransientRetry(
    ai: GoogleGenAI,
    model: string,
    normalizedText: string,
    styleDirective: string,
    voiceName: string,
    deadlineMs: number,
  ): Promise<Buffer> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remainingMs = deadlineMs - this.now();
      if (remainingMs <= 0) {
        throw new TtsTimeoutError();
      }
      try {
        return await this.synthesizeWithModel(
          ai,
          model,
          normalizedText,
          styleDirective,
          voiceName,
          remainingMs,
        );
      } catch (err) {
        if (await this.shouldRetryModelError(model, err, attempt, deadlineMs)) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("TTS generation failed.");
  }

  async generateSpeech(
    ai: GoogleGenAI,
    text: string,
    region: DialectRegion,
    slow: boolean,
    voiceProfile: TtsVoiceProfile,
  ): Promise<Buffer> {
    const billingCooldownRemaining = this.getBillingCooldownRemainingSeconds();
    if (billingCooldownRemaining > 0) {
      throw new TtsBillingError(billingCooldownRemaining);
    }

    const spec = buildRegionalVoiceSpec(text, region, slow, voiceProfile);
    const models = [PRIMARY_TTS_MODEL, FALLBACK_TTS_MODEL];
    const deadlineMs = this.now() + this.upstreamTimeoutMs;

    let lastError: unknown;
    let longestCooldownRemainingMs = 0;

    for (const model of models) {
      const currentNow = this.now();
      if (currentNow >= deadlineMs) {
        lastError ??= new TtsTimeoutError();
        break;
      }

      const blockedUntil = this.modelCooldownUntil.get(model) ?? 0;
      if (blockedUntil > currentNow) {
        longestCooldownRemainingMs = Math.max(
          longestCooldownRemainingMs,
          blockedUntil - currentNow,
        );
        continue;
      }

      try {
        const result = await this.tryModelWithTransientRetry(
          ai,
          model,
          spec.spokenText,
          spec.styleDirective,
          spec.voiceName,
          deadlineMs,
        );
        this.authCooldown = null;
        this.billingCooldown = null;
        return result;
      } catch (err) {
        if (err instanceof TtsAuthError || err instanceof TtsBillingError) {
          throw err;
        }
        lastError = err;
        if (err instanceof TtsRateLimitError) {
          longestCooldownRemainingMs = Math.max(
            longestCooldownRemainingMs,
            err.retryAfterSeconds * 1000,
          );
        }
      }
    }

    if (longestCooldownRemainingMs > 0) {
      throw new TtsRateLimitError(Math.max(1, Math.ceil(longestCooldownRemainingMs / 1000)));
    }

    throw lastError instanceof Error ? lastError : new Error("TTS generation failed.");
  }
}
