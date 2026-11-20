import { createHash } from "node:crypto";
import {
  access,
  constants,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const ORPHAN_TMP_MAX_AGE_MS = 300_000;
const FS_STAT_CONCURRENCY = 32;
const TOUCH_THROTTLE_MS = 60_000;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      const item = items[idx];
      if (item !== undefined) {
        results[idx] = await mapper(item);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, async () => runWorker()));
  return results;
}

export type CachedAudioContentType = "audio/wav" | "audio/mpeg";

export function isValidWavBuffer(data: Buffer): boolean {
  if (data.length <= 44) return false;
  return (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

export function isValidMp3Buffer(data: Buffer): boolean {
  if (data.length <= 128) return false;
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const b2 = data[2] ?? 0;
  // ID3v2 tag header
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) {
    return true;
  }
  // MPEG audio frame sync (11 set bits: 0xFF followed by 0xE0..0xFF)
  return b0 === 0xff && (b1 & 0xe0) === 0xe0;
}

export function detectAudioContentType(data: Buffer): CachedAudioContentType | null {
  if (isValidWavBuffer(data)) return "audio/wav";
  if (isValidMp3Buffer(data)) return "audio/mpeg";
  return null;
}

function isAudioCacheFileName(name: string): boolean {
  return name.endsWith(".wav") || name.endsWith(".mp3");
}

function minValidSizeForFile(name: string): number {
  return name.endsWith(".mp3") ? 129 : 45;
}

interface DiskCacheItemMeta {
  fullPath: string;
  size: number;
  mtimeMs: number;
}

export interface TtsDiskCacheOptions {
  cacheDir: string;
  maxEntries: number;
  maxBytes: number;
  now?: () => number;
}

export class TtsDiskCache {
  private readonly cacheDir: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  private dirReady = false;
  private statsInitialized = false;
  private estimatedEntries = 0;
  private estimatedBytes = 0;
  private activePrunePromise: Promise<void> | null = null;
  private pruneDirty = false;
  private tempWriteCounter = 0;
  private readonly lastTouchByPath = new Map<string, number>();

  constructor(options: TtsDiskCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
    this.now = options.now ?? Date.now;
  }

  private getFilePath(cacheKey: string, contentType: CachedAudioContentType = "audio/wav"): string {
    const hash = createHash("sha256").update(cacheKey).digest("hex");
    const ext = contentType === "audio/mpeg" ? "mp3" : "wav";
    return path.join(this.cacheDir, `${hash}.${ext}`);
  }

  async ensureWritable(): Promise<boolean> {
    try {
      await this.ensureDir();
      await access(this.cacheDir, constants.W_OK);
      return true;
    } catch {
      this.dirReady = false;
      try {
        await this.ensureDir();
        await access(this.cacheDir, constants.W_OK);
        return true;
      } catch {
        this.dirReady = false;
        return false;
      }
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.cacheDir, { recursive: true });
    this.dirReady = true;
  }

  private async readAudioCacheMetadata(fileNames: string[]): Promise<DiskCacheItemMeta[]> {
    const entries = await mapWithConcurrency(fileNames, FS_STAT_CONCURRENCY, async (name) => {
      const fullPath = path.join(this.cacheDir, name);
      try {
        const info = await stat(fullPath);
        if (info.size < minValidSizeForFile(name)) {
          void unlink(fullPath).catch(() => undefined);
          return null;
        }
        return { fullPath, size: info.size, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    });
    return entries.filter((item): item is DiskCacheItemMeta => item !== null);
  }

  private async evictExcessEntries(
    items: DiskCacheItemMeta[],
  ): Promise<{ count: number; bytes: number }> {
    let totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    let remainingCount = items.length;
    if (remainingCount <= this.maxEntries && totalBytes <= this.maxBytes) {
      return { count: remainingCount, bytes: totalBytes };
    }

    const oldestFirst = [...items].sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of oldestFirst) {
      if (remainingCount <= this.maxEntries && totalBytes <= this.maxBytes) {
        break;
      }
      try {
        await unlink(item.fullPath);
        this.lastTouchByPath.delete(item.fullPath);
        remainingCount--;
        totalBytes -= item.size;
      } catch {
        // Ignore unlink failure if already removed
      }
    }
    return { count: remainingCount, bytes: totalBytes };
  }

  private async cleanupOrphanTmpFiles(tmpFiles: string[]): Promise<void> {
    const cutoffMs = this.now() - ORPHAN_TMP_MAX_AGE_MS;
    await mapWithConcurrency(tmpFiles, FS_STAT_CONCURRENCY, async (name) => {
      const fullPath = path.join(this.cacheDir, name);
      try {
        const info = await stat(fullPath);
        if (info.mtimeMs <= cutoffMs) {
          await unlink(fullPath);
        }
      } catch {
        // Ignore already-renamed or removed temp files
      }
    });
  }

  private async runPruneLoop(): Promise<void> {
    const hasPendingPrune = (): boolean => this.pruneDirty;
    try {
      do {
        this.pruneDirty = false;
        const entries = await readdir(this.cacheDir);
        const tmpFiles = entries.filter((name) => name.endsWith(".tmp"));
        if (tmpFiles.length > 0) {
          await this.cleanupOrphanTmpFiles(tmpFiles);
        }
        const audioFiles = entries.filter(isAudioCacheFileName);
        if (audioFiles.length === 0) {
          this.estimatedEntries = 0;
          this.estimatedBytes = 0;
          this.statsInitialized = true;
          continue;
        }
        const valid = await this.readAudioCacheMetadata(audioFiles);
        const remaining = await this.evictExcessEntries(valid);
        this.estimatedEntries = remaining.count;
        this.estimatedBytes = remaining.bytes;
        this.statsInitialized = true;
      } while (hasPendingPrune());
    } catch {
      // Non-fatal prune failure
    } finally {
      this.activePrunePromise = null;
    }
  }

  async prune(): Promise<void> {
    if (this.activePrunePromise) {
      this.pruneDirty = true;
      return this.activePrunePromise;
    }
    this.activePrunePromise = this.runPruneLoop();
    return this.activePrunePromise;
  }

  async read(
    cacheKey: string,
    contentType: CachedAudioContentType = "audio/wav",
  ): Promise<Buffer | null> {
    const filePath = this.getFilePath(cacheKey, contentType);
    try {
      const data = await readFile(filePath);
      const valid = contentType === "audio/mpeg" ? isValidMp3Buffer(data) : isValidWavBuffer(data);
      if (!valid) {
        void unlink(filePath).catch(() => undefined);
        if (this.statsInitialized) {
          this.estimatedEntries = Math.max(0, this.estimatedEntries - 1);
          this.estimatedBytes = Math.max(0, this.estimatedBytes - data.length);
        }
        return null;
      }
      const nowMs = this.now();
      const lastTouchMs = this.lastTouchByPath.get(filePath);
      if (lastTouchMs === undefined || nowMs - lastTouchMs >= TOUCH_THROTTLE_MS) {
        if (this.lastTouchByPath.size >= Math.max(64, this.maxEntries * 2)) {
          const oldest = this.lastTouchByPath.keys().next().value;
          if (oldest !== undefined) {
            this.lastTouchByPath.delete(oldest);
          }
        }
        this.lastTouchByPath.set(filePath, nowMs);
        const touchTime = new Date(nowMs);
        void utimes(filePath, touchTime, touchTime).catch(() => undefined);
      }
      return data;
    } catch {
      return null;
    }
  }

  async write(
    cacheKey: string,
    audioBuffer: Buffer,
    contentType: CachedAudioContentType = "audio/wav",
  ): Promise<void> {
    const valid =
      contentType === "audio/mpeg" ? isValidMp3Buffer(audioBuffer) : isValidWavBuffer(audioBuffer);
    if (!valid) return;
    const targetPath = this.getFilePath(cacheKey, contentType);
    const tmpPath = `${targetPath}.${String(process.pid)}.${String(++this.tempWriteCounter)}.tmp`;
    try {
      await this.ensureDir();
      let previousSize: number | null = null;
      try {
        const existingInfo = await stat(targetPath);
        previousSize = existingInfo.size;
      } catch {
        previousSize = null;
      }

      await writeFile(tmpPath, audioBuffer);
      await rename(tmpPath, targetPath);

      if (previousSize === null) {
        this.estimatedEntries += 1;
        this.estimatedBytes += audioBuffer.length;
      } else {
        this.estimatedBytes = Math.max(0, this.estimatedBytes - previousSize + audioBuffer.length);
      }

      if (
        !this.statsInitialized ||
        this.estimatedEntries > this.maxEntries ||
        this.estimatedBytes > this.maxBytes
      ) {
        await this.prune();
      }
    } catch {
      this.dirReady = false;
      void unlink(tmpPath).catch(() => undefined);
    }
  }

  async countClips(): Promise<number> {
    if (!this.statsInitialized) {
      await this.prune();
    }
    return this.estimatedEntries;
  }
}
