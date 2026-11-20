import { createIdentityTimelineMap, type StretchTimelineMap } from "./audio/speechSegmentation";
import type { StretchAudioOptions, StretchedAudioResult } from "./audioTimeStretch";

interface WorkerResultMessage {
  id: number;
  channels?: Float32Array[];
  timeline?: StretchTimelineMap;
  error?: string;
}

interface PendingJob {
  resolve: (result: StretchedAudioResult) => void;
  reject: (reason?: unknown) => void;
}

const WORKER_JOB_TIMEOUT_MS = 4000;
const MAX_CONSECUTIVE_WORKER_ERRORS = 3;
const WORKER_COOLDOWN_MS = 60_000;

let sharedWorker: Worker | null = null;
let consecutiveWorkerErrors = 0;
let workerDisabledUntil = 0;
let nextJobId = 1;
const pendingJobs = new Map<number, PendingJob>();

interface FallbackStretchModule {
  stretchAudioChannelsWithMap: (
    channels: Float32Array[],
    sampleRate: number,
    speedFactor: number,
    options?: StretchAudioOptions,
  ) => StretchedAudioResult;
}

let fallbackModulePromise: Promise<FallbackStretchModule> | null = null;

async function runMainThreadFallback(
  channels: Float32Array[],
  sampleRate: number,
  speedFactor: number,
  options?: StretchAudioOptions,
): Promise<StretchedAudioResult> {
  fallbackModulePromise ??= import("./audioTimeStretch");
  const mod = await fallbackModulePromise;
  return mod.stretchAudioChannelsWithMap(channels, sampleRate, speedFactor, options);
}

function isWorkerTemporarilyDisabled(): boolean {
  if (workerDisabledUntil <= 0) return false;
  if (Date.now() >= workerDisabledUntil) {
    workerDisabledUntil = 0;
    consecutiveWorkerErrors = 0;
    return false;
  }
  return true;
}

function recordWorkerFailure(): void {
  consecutiveWorkerErrors += 1;
  if (consecutiveWorkerErrors >= MAX_CONSECUTIVE_WORKER_ERRORS) {
    workerDisabledUntil = Date.now() + WORKER_COOLDOWN_MS;
  }
}

function rejectAllPending(reason: Error): void {
  const jobs = [...pendingJobs.values()];
  pendingJobs.clear();
  for (const job of jobs) {
    job.reject(reason);
  }
}

function resetSharedWorker(): void {
  if (sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch {
      // Ignore worker termination errors
    }
    sharedWorker = null;
  }
}

export function resetAudioTimeStretchWorkerForTests(): void {
  resetSharedWorker();
  rejectAllPending(new Error("Audio time-stretch worker reset."));
  consecutiveWorkerErrors = 0;
  workerDisabledUntil = 0;
}

function getOrCreateWorker(): Worker | null {
  if (isWorkerTemporarilyDisabled() || typeof Worker === "undefined") {
    return null;
  }
  if (sharedWorker) {
    return sharedWorker;
  }
  try {
    const worker = new Worker(new URL("../workers/audioTimeStretch.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResultMessage>) => {
      const { id, channels, timeline, error } = event.data;
      const pending = pendingJobs.get(id);
      if (!pending) return;
      pendingJobs.delete(id);
      if (channels) {
        consecutiveWorkerErrors = 0;
        workerDisabledUntil = 0;
        const resolvedTimeline = timeline ?? createIdentityTimelineMap(channels[0]?.length ?? 0);
        pending.resolve({ channels, timeline: resolvedTimeline });
      } else {
        recordWorkerFailure();
        pending.reject(new Error(error ?? "Audio worker failed."));
      }
    };
    worker.onerror = () => {
      recordWorkerFailure();
      resetSharedWorker();
      rejectAllPending(new Error("Audio time-stretch worker encountered an error."));
    };
    sharedWorker = worker;
    return worker;
  } catch {
    workerDisabledUntil = Date.now() + WORKER_COOLDOWN_MS;
    return null;
  }
}

export async function stretchAudioChannelsWithMapAsync(
  channels: Float32Array[],
  sampleRate: number,
  speedFactor: number,
  timeoutMs = WORKER_JOB_TIMEOUT_MS,
  options?: StretchAudioOptions,
): Promise<StretchedAudioResult> {
  if (channels.length === 0) {
    return { channels: [], timeline: createIdentityTimelineMap(0) };
  }
  const first = channels[0];
  if (!first || first.length === 0 || speedFactor >= 0.99 || first.length < 32) {
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      timeline: createIdentityTimelineMap(first?.length ?? 0),
    };
  }
  if (options?.baseClipIsSlow === true && speedFactor >= 0.68) {
    return runMainThreadFallback(channels, sampleRate, speedFactor, options);
  }

  const worker = getOrCreateWorker();
  if (!worker) {
    return runMainThreadFallback(channels, sampleRate, speedFactor, options);
  }

  const clonedChannels = channels.map((ch) => new Float32Array(ch));
  const id = nextJobId++;

  try {
    return await new Promise<StretchedAudioResult>((resolve, reject) => {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timerId !== undefined) {
          clearTimeout(timerId);
          timerId = undefined;
        }
      };

      pendingJobs.set(id, {
        resolve: (result) => {
          cleanup();
          resolve(result);
        },
        reject: (reason) => {
          cleanup();
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        },
      });

      timerId = setTimeout(() => {
        if (!pendingJobs.has(id)) return;
        const timeoutErr = new Error("Audio time-stretch worker timed out.");
        recordWorkerFailure();
        resetSharedWorker();
        rejectAllPending(timeoutErr);
      }, timeoutMs);

      const transfers: Transferable[] = clonedChannels.map((ch) => ch.buffer);
      try {
        worker.postMessage(
          {
            id,
            channels: clonedChannels,
            sampleRate,
            speedFactor,
            ...(options?.mode ? { mode: options.mode } : {}),
            ...(options?.expectedSyllableCount !== undefined
              ? { expectedSyllableCount: options.expectedSyllableCount }
              : {}),
            ...(options?.baseClipIsSlow !== undefined
              ? { baseClipIsSlow: options.baseClipIsSlow }
              : {}),
          },
          transfers,
        );
      } catch (postErr) {
        const failed = pendingJobs.get(id);
        if (failed) {
          pendingJobs.delete(id);
          recordWorkerFailure();
          failed.reject(postErr);
        }
      }
    });
  } catch {
    return runMainThreadFallback(channels, sampleRate, speedFactor, options);
  }
}

export async function stretchAudioChannelsAsync(
  channels: Float32Array[],
  sampleRate: number,
  speedFactor: number,
  timeoutMs = WORKER_JOB_TIMEOUT_MS,
  options?: StretchAudioOptions,
): Promise<Float32Array[]> {
  const result = await stretchAudioChannelsWithMapAsync(
    channels,
    sampleRate,
    speedFactor,
    timeoutMs,
    options,
  );
  return result.channels;
}
