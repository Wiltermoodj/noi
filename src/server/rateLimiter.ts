export class TtsRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Vietnamese voice rate limit reached. Try again in ${String(retryAfterSeconds)}s.`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface RateWindowEntry {
  windowStart: number;
  totalRequests: number;
  upstreamMisses: number;
}

export interface RateLimiterOptions {
  maxRequestsPerWindow: number;
  maxMissesPerWindow: number;
  maxGlobalMissesPerWindow: number;
  windowMs: number;
  maxTrackedClients?: number;
  now?: () => number;
}

const DEFAULT_MAX_TRACKED_CLIENTS = 2000;

export class TtsRateLimiter {
  private readonly maxRequestsPerWindow: number;
  private readonly maxMissesPerWindow: number;
  private readonly maxGlobalMissesPerWindow: number;
  private readonly windowMs: number;
  private readonly maxTrackedClients: number;
  private readonly now: () => number;
  private readonly clientWindows = new Map<string, RateWindowEntry>();
  private globalMissWindow: { windowStart: number; count: number };

  constructor(options: RateLimiterOptions) {
    this.maxRequestsPerWindow = options.maxRequestsPerWindow;
    this.maxMissesPerWindow = options.maxMissesPerWindow;
    this.maxGlobalMissesPerWindow = options.maxGlobalMissesPerWindow;
    this.windowMs = options.windowMs;
    this.maxTrackedClients = options.maxTrackedClients ?? DEFAULT_MAX_TRACKED_CLIENTS;
    this.now = options.now ?? Date.now;
    this.globalMissWindow = { windowStart: this.now(), count: 0 };
  }

  private evictStaleWindows(ts: number): void {
    if (this.clientWindows.size < this.maxTrackedClients) return;
    for (const [key, entry] of this.clientWindows.entries()) {
      if (ts - entry.windowStart >= this.windowMs) {
        this.clientWindows.delete(key);
      }
    }
    while (this.clientWindows.size >= this.maxTrackedClients) {
      const oldestIp = this.clientWindows.keys().next().value;
      if (oldestIp === undefined) break;
      this.clientWindows.delete(oldestIp);
    }
  }

  private getOrCreateClientWindow(ip: string): RateWindowEntry {
    const ts = this.now();
    const existing = this.clientWindows.get(ip);
    if (!existing || ts - existing.windowStart >= this.windowMs) {
      this.evictStaleWindows(ts);
      const fresh: RateWindowEntry = { windowStart: ts, totalRequests: 0, upstreamMisses: 0 };
      this.clientWindows.set(ip, fresh);
      return fresh;
    }
    return existing;
  }

  checkTotalRequest(ip: string): number | null {
    const entry = this.getOrCreateClientWindow(ip);
    if (entry.totalRequests >= this.maxRequestsPerWindow) {
      return Math.max(1, Math.ceil((this.windowMs - (this.now() - entry.windowStart)) / 1000));
    }
    entry.totalRequests++;
    return null;
  }

  checkUpstreamMiss(ip: string): number | null {
    const ts = this.now();
    if (ts - this.globalMissWindow.windowStart >= this.windowMs) {
      this.globalMissWindow = { windowStart: ts, count: 0 };
    }
    if (this.globalMissWindow.count >= this.maxGlobalMissesPerWindow) {
      return Math.max(
        1,
        Math.ceil((this.windowMs - (ts - this.globalMissWindow.windowStart)) / 1000),
      );
    }

    const entry = this.getOrCreateClientWindow(ip);
    if (entry.upstreamMisses >= this.maxMissesPerWindow) {
      return Math.max(1, Math.ceil((this.windowMs - (ts - entry.windowStart)) / 1000));
    }
    entry.upstreamMisses++;
    this.globalMissWindow.count++;
    return null;
  }
}
