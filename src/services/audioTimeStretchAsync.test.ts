import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetAudioTimeStretchWorkerForTests,
  stretchAudioChannelsWithMapAsync,
} from "./audioTimeStretchAsync";
import { getOrCreateSharedAudioContext, resumeSharedAudioContext } from "./sharedAudioContext";

function makeSineChannel(length = 4800, sampleRate = 24000, freq = 190): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return data;
}

describe("audioTimeStretchAsync and sharedAudioContext reliability", () => {
  afterEach(() => {
    resetAudioTimeStretchWorkerForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("immediately fails over all concurrent pending jobs when a shared worker times out", async () => {
    let terminatedCount = 0;
    class HangingWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: ErrorEvent) => void) | null = null;
      postMessage(): void {
        // Intentionally never responds to simulate a stalled worker thread
      }
      terminate(): void {
        terminatedCount += 1;
      }
    }

    vi.stubGlobal("Worker", HangingWorker);

    const chA = makeSineChannel(4096);
    const chB = makeSineChannel(4096);
    const start = Date.now();

    // Job A has a short timeout (40ms); Job B has a long timeout (5000ms).
    // When Job A times out and terminates the worker, Job B must also fail over immediately.
    const [resA, resB] = await Promise.all([
      stretchAudioChannelsWithMapAsync([chA], 24000, 0.75, 40),
      stretchAudioChannelsWithMapAsync([chB], 24000, 0.75, 5000),
    ]);

    const elapsedMs = Date.now() - start;
    expect(terminatedCount).toBe(1);
    expect(elapsedMs).toBeLessThan(2000);
    expect(resA.channels[0]?.length).toBeGreaterThan(chA.length);
    expect(resB.channels[0]?.length).toBeGreaterThan(chB.length);
  });

  it("fast-paths normal speed clips without spawning a worker", async () => {
    const workerCtor = vi.fn();
    vi.stubGlobal("Worker", workerCtor);

    const ch = makeSineChannel(1024);
    const res = await stretchAudioChannelsWithMapAsync([ch], 24000, 1.0);
    expect(workerCtor).not.toHaveBeenCalled();
    expect(res.channels[0]?.length).toBe(ch.length);
  });

  it("handles AudioContext constructor failures and interrupted states safely", async () => {
    const FailingAudioContext = vi.fn(function failingAudioContextCtor() {
      throw new Error("Audio hardware unavailable");
    });
    vi.stubGlobal("window", { AudioContext: FailingAudioContext });
    vi.stubGlobal("AudioContext", FailingAudioContext);
    expect(getOrCreateSharedAudioContext()).toBeNull();

    const resumeMock = vi.fn(async () => Promise.resolve());
    const interruptedCtx = {
      state: "interrupted",
      resume: resumeMock,
    } as unknown as AudioContext;
    await resumeSharedAudioContext(interruptedCtx);
    expect(resumeMock).toHaveBeenCalledTimes(1);
  });
});
