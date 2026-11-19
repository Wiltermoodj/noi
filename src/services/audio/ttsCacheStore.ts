import type { DialectRegion, TtsVoiceProfile } from "../../types/vietnamese";

export const TTS_CACHE_NAME = "noi-vi-tts-v5";
const LEGACY_TTS_CACHE_NAMES = ["noi-vi-tts-v1", "noi-vi-tts-v2", "noi-vi-tts-v3", "noi-vi-tts-v4"];
const MAX_MEMORY_CACHE_ENTRIES = 40;
const MAX_MEMORY_CACHE_BYTES = 24 * 1024 * 1024;

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
  private memoryCacheBytes = 0;
  private legacyCacheCleared = false;
  private persistenceRequested = false;

  requestPersistentStorage(): void {
    if (this.persistenceRequested || typeof navigator === "undefined") return;
    this.persistenceRequested = true;
    const storage = (navigator as { storage?: { persist?: () => Promise<boolean> } }).storage;
    if (typeof storage?.persist === "function") {
      void storage.persist().catch(() => undefined);
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
      this.memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES ||
      (this.memoryCache.size > 0 && this.memoryCacheBytes + blob.size > MAX_MEMORY_CACHE_BYTES)
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
        this.rememberBlob(cacheUrl, blob);
        return blob;
      }
      if (typeof cache.delete === "function") {
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

    const putEntry = async () => {
      const response = new Response(blob, {
        headers: { "Content-Type": blob.type || "audio/wav" },
      });
      await cache.put(cacheUrl, response);
    };

    try {
      await putEntry();
      return { persisted: true, quotaExceeded: false };
    } catch (err) {
      if (!isQuotaExceededError(err)) {
        return { persisted: false, quotaExceeded: false };
      }
      if (evictOnQuota) {
        const evicted = await this.evictOldestCacheEntries(cache, 8);
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
