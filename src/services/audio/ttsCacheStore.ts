import type { DialectRegion, TtsVoiceProfile } from "../../types/vietnamese";

export const TTS_CACHE_NAME = "noi-vi-tts-v5";
const LEGACY_TTS_CACHE_NAMES = ["noi-vi-tts-v1", "noi-vi-tts-v2", "noi-vi-tts-v3", "noi-vi-tts-v4"];

const DEFAULT_MAX_MEMORY_CACHE_ENTRIES = 40;
const DEFAULT_MAX_MEMORY_CACHE_BYTES = 24 * 1024 * 1024;

export const OFFLINE_AUDIO_MEMORY_MAX_ENTRIES = 320;
export const OFFLINE_AUDIO_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;
export const OFFLINE_AUDIO_STORAGE_BUDGET_BYTES = 512 * 1024 * 1024;

export interface TtsCacheStoreOptions {
  maxMemoryEntries?: number;
  maxMemoryBytes?: number;
  maxStorageBytes?: number;
}

export interface OfflineAudioMemoryStats {
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
}

export interface OfflineAudioStorageStats {
  cachedClips: number;
  cachedBytes: number;
  storageBudgetBytes: number;
  quotaBytes: number | null;
  usageBytes: number | null;
  persisted: boolean;
}

export function buildTtsCacheUrl(
  text: string,
  region: DialectRegion,
  slow: boolean,
  voiceProfile: TtsVoiceProfile,
): string {
  const params = new URLSearchParams({
    region,
    slow: slow ? "2" : "0",
    voice: voiceProfile,
    text: text.trim(),
  });
  return `https://noi.local/tts?${params.toString()}`;
}

export async function isLikelyValidAudioBlob(blob: Blob): Promise<boolean> {
  if (blob.size === 0) return false;
  const normalizedType = blob.type.toLowerCase();
  if (normalizedType.includes("text/html") || normalizedType.includes("application/json")) {
    return false;
  }
  if (typeof blob.arrayBuffer !== "function") {
    return true;
  }
  try {
    const headerLen = Math.min(blob.size, 12);
    const bytes = new Uint8Array(await blob.slice(0, headerLen).arrayBuffer());
    const first = bytes[0];
    // Guard against HTML/JSON error pages accidentally served with 200 OK
    if (first === 0x3c || first === 0x7b) {
      return false;
    }
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      if (blob.size <= 44 || bytes.length < 12) return false;
      return bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    }
    return true;
  } catch {
    return true;
  }
}

function isQuotaExceededError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "QuotaExceededError") ||
    (err instanceof Error && /quota/i.test(err.message))
  );
}

export class TtsCacheStore {
  private readonly memoryCache = new Map<string, Blob>();
  private readonly knownPersistentSizes = new Map<string, number>();
  private readonly maxMemoryEntries: number;
  private readonly maxMemoryBytes: number;
  private readonly maxStorageBytes: number;
  private memoryCacheBytes = 0;
  private legacyCacheCleared = false;
  private persistenceRequested = false;

  constructor(options?: TtsCacheStoreOptions) {
    this.maxMemoryEntries = options?.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_CACHE_ENTRIES;
    this.maxMemoryBytes = options?.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_CACHE_BYTES;
    this.maxStorageBytes = options?.maxStorageBytes ?? OFFLINE_AUDIO_STORAGE_BUDGET_BYTES;
  }

  requestPersistentStorage(): void {
    if (this.persistenceRequested || typeof navigator === "undefined") return;
    this.persistenceRequested = true;
    const storage = (navigator as { storage?: { persist?: () => Promise<boolean> } }).storage;
    if (typeof storage?.persist === "function") {
      void storage.persist().catch(() => undefined);
    }
  }

  async isStoragePersisted(): Promise<boolean> {
    if (typeof navigator === "undefined") return false;
    const storage = (navigator as { storage?: { persisted?: () => Promise<boolean> } }).storage;
    if (typeof storage?.persisted !== "function") return false;
    try {
      return await storage.persisted();
    } catch {
      return false;
    }
  }

  getMemoryStats(): OfflineAudioMemoryStats {
    return {
      entries: this.memoryCache.size,
      bytes: this.memoryCacheBytes,
      maxEntries: this.maxMemoryEntries,
      maxBytes: this.maxMemoryBytes,
    };
  }

  private async readStorageQuotaEstimate(): Promise<{
    quotaBytes: number | null;
    usageBytes: number | null;
  }> {
    if (typeof navigator === "undefined") {
      return { quotaBytes: null, usageBytes: null };
    }
    const storage = (
      navigator as {
        storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
      }
    ).storage;
    if (typeof storage?.estimate !== "function") {
      return { quotaBytes: null, usageBytes: null };
    }
    try {
      const est = await storage.estimate();
      const quotaBytes =
        typeof est.quota === "number" && Number.isFinite(est.quota) ? est.quota : null;
      const usageBytes =
        typeof est.usage === "number" && Number.isFinite(est.usage) ? est.usage : null;
      return { quotaBytes, usageBytes };
    } catch {
      return { quotaBytes: null, usageBytes: null };
    }
  }

  private async resolveCacheEntryBytes(cache: Cache, req: Request): Promise<number> {
    const memBlob = this.memoryCache.get(req.url);
    if (memBlob) {
      this.knownPersistentSizes.set(req.url, memBlob.size);
      return memBlob.size;
    }
    const knownSize = this.knownPersistentSizes.get(req.url);
    if (knownSize !== undefined) {
      return knownSize;
    }
    const res = await cache.match(req).catch(() => undefined);
    if (!res) return 0;
    const headerBytes = Number(
      res.headers.get("X-Audio-Bytes") ?? res.headers.get("Content-Length") ?? "0",
    );
    if (Number.isFinite(headerBytes) && headerBytes > 0) {
      this.knownPersistentSizes.set(req.url, headerBytes);
      return headerBytes;
    }
    const blob = await res.blob().catch(() => null);
    if (!blob) return 0;
    this.knownPersistentSizes.set(req.url, blob.size);
    return blob.size;
  }

  async getStorageStats(): Promise<OfflineAudioStorageStats> {
    const [persisted, { quotaBytes, usageBytes }, cache] = await Promise.all([
      this.isStoragePersisted(),
      this.readStorageQuotaEstimate(),
      this.openCache(),
    ]);

    const fallbackStats: OfflineAudioStorageStats = {
      cachedClips: this.memoryCache.size,
      cachedBytes: this.memoryCacheBytes,
      storageBudgetBytes: this.maxStorageBytes,
      quotaBytes,
      usageBytes,
      persisted,
    };

    if (!cache || typeof cache.keys !== "function") {
      return fallbackStats;
    }

    try {
      const requests = await cache.keys();
      let totalBytes = 0;
      for (const req of requests) {
        totalBytes += await this.resolveCacheEntryBytes(cache, req);
      }
      return {
        cachedClips: requests.length,
        cachedBytes: totalBytes,
        storageBudgetBytes: this.maxStorageBytes,
        quotaBytes,
        usageBytes,
        persisted,
      };
    } catch {
      return fallbackStats;
    }
  }

  hasInMemory(cacheUrl: string): boolean {
    return this.memoryCache.has(cacheUrl);
  }

  private evictOldestMemoryEntry(): boolean {
    const oldestKey = this.memoryCache.keys().next().value;
    if (oldestKey === undefined) return false;
    const oldestBlob = this.memoryCache.get(oldestKey);
    this.memoryCache.delete(oldestKey);
    if (oldestBlob) {
      this.memoryCacheBytes = Math.max(0, this.memoryCacheBytes - oldestBlob.size);
    }
    return true;
  }

  rememberBlob(cacheUrl: string, blob: Blob): void {
    const existing = this.memoryCache.get(cacheUrl);
    if (existing) {
      this.memoryCache.delete(cacheUrl);
      this.memoryCacheBytes = Math.max(0, this.memoryCacheBytes - existing.size);
    }
    while (
      this.memoryCache.size >= this.maxMemoryEntries ||
      (this.memoryCache.size > 0 && this.memoryCacheBytes + blob.size > this.maxMemoryBytes)
    ) {
      if (!this.evictOldestMemoryEntry()) break;
    }
    this.memoryCache.set(cacheUrl, blob);
    this.memoryCacheBytes += blob.size;
  }

  async openCache(): Promise<Cache | null> {
    if (typeof caches === "undefined") return null;
    if (!this.legacyCacheCleared) {
      this.legacyCacheCleared = true;
      if (typeof caches.delete === "function") {
        for (const oldCache of LEGACY_TTS_CACHE_NAMES) {
          void caches.delete(oldCache).catch(() => undefined);
        }
      }
    }
    try {
      return await caches.open(TTS_CACHE_NAME);
    } catch {
      return null;
    }
  }

  async read(cacheUrl: string): Promise<Blob | null> {
    const inMemory = this.memoryCache.get(cacheUrl);
    if (inMemory) {
      if (await isLikelyValidAudioBlob(inMemory)) {
        // Refresh LRU recency
        this.rememberBlob(cacheUrl, inMemory);
        return inMemory;
      }
      this.memoryCache.delete(cacheUrl);
      this.memoryCacheBytes = Math.max(0, this.memoryCacheBytes - inMemory.size);
    }

    const cache = await this.openCache();
    if (!cache) return null;
    try {
      const cachedResponse = await cache.match(cacheUrl);
      if (!cachedResponse) return null;
      const blob = await cachedResponse.blob();
      if (await isLikelyValidAudioBlob(blob)) {
        this.knownPersistentSizes.set(cacheUrl, blob.size);
        this.rememberBlob(cacheUrl, blob);
        return blob;
      }
      if (typeof cache.delete === "function") {
        this.knownPersistentSizes.delete(cacheUrl);
        void cache.delete(cacheUrl).catch(() => undefined);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async evictOldestCacheEntries(cache: Cache, count: number): Promise<number> {
    if (typeof cache.keys !== "function" || typeof cache.delete !== "function") {
      return 0;
    }
    try {
      const keys = await cache.keys();
      const toRemove = keys.slice(0, count);
      let removed = 0;
      for (const req of toRemove) {
        const deleted = await cache.delete(req);
        if (deleted) {
          removed++;
          this.knownPersistentSizes.delete(req.url);
          const memBlob = this.memoryCache.get(req.url);
          if (memBlob) {
            this.memoryCache.delete(req.url);
            this.memoryCacheBytes = Math.max(0, this.memoryCacheBytes - memBlob.size);
          }
        }
      }
      return removed;
    } catch {
      return 0;
    }
  }

  private getKnownPersistentBytes(): number {
    let sum = 0;
    for (const size of this.knownPersistentSizes.values()) {
      sum += size;
    }
    return sum;
  }

  async write(
    cacheUrl: string,
    blob: Blob,
    evictOnQuota = false,
  ): Promise<{ persisted: boolean; quotaExceeded: boolean }> {
    this.rememberBlob(cacheUrl, blob);
    if (typeof caches === "undefined") {
      return { persisted: true, quotaExceeded: false };
    }
    this.requestPersistentStorage();
    const cache = await this.openCache();
    if (!cache) {
      return { persisted: false, quotaExceeded: false };
    }

    if (
      evictOnQuota &&
      this.knownPersistentSizes.size > 0 &&
      this.getKnownPersistentBytes() + blob.size > this.maxStorageBytes
    ) {
      await this.evictOldestCacheEntries(cache, 16);
    }

    const putEntry = async () => {
      const response = new Response(blob, {
        headers: {
          "Content-Type": blob.type || "audio/wav",
          "X-Audio-Bytes": String(blob.size),
        },
      });
      await cache.put(cacheUrl, response);
      this.knownPersistentSizes.set(cacheUrl, blob.size);
    };

    try {
      await putEntry();
      return { persisted: true, quotaExceeded: false };
    } catch (err) {
      if (!isQuotaExceededError(err)) {
        return { persisted: false, quotaExceeded: false };
      }
      if (evictOnQuota) {
        const evicted = await this.evictOldestCacheEntries(cache, 16);
        if (evicted > 0) {
          try {
            await putEntry();
            return { persisted: true, quotaExceeded: false };
          } catch (retryErr) {
            return { persisted: false, quotaExceeded: isQuotaExceededError(retryErr) };
          }
        }
      }
      return { persisted: false, quotaExceeded: true };
    }
  }
}
