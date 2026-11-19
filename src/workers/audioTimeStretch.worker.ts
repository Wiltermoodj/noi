import type { StretchTimelineMap } from "../services/audio/speechSegmentation";
import { type AudioStretchMode, stretchAudioChannelsWithMap } from "../services/audioTimeStretch";

interface StretchWorkerRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  speedFactor: number;
  mode?: AudioStretchMode | undefined;
  expectedSyllableCount?: number | undefined;
  baseClipIsSlow?: boolean | undefined;
}

interface StretchWorkerResponse {
  id: number;
  channels?: Float32Array[];
  timeline?: StretchTimelineMap;
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<StretchWorkerRequest>) => void) | null;
  postMessage: (message: StretchWorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event: MessageEvent<StretchWorkerRequest>) => {
  const { id, channels, sampleRate, speedFactor, mode, expectedSyllableCount, baseClipIsSlow } =
    event.data;
  try {
    const result = stretchAudioChannelsWithMap(channels, sampleRate, speedFactor, {
      ...(mode ? { mode } : {}),
      ...(expectedSyllableCount !== undefined ? { expectedSyllableCount } : {}),
      ...(baseClipIsSlow !== undefined ? { baseClipIsSlow } : {}),
    });
    const transfers: Transferable[] = [
      ...result.channels.map((ch) => ch.buffer),
      result.timeline.inSamples.buffer,
      result.timeline.outSamples.buffer,
    ];
    workerScope.postMessage(
      { id, channels: result.channels, timeline: result.timeline },
      transfers,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Audio time-stretch failed.";
    workerScope.postMessage({ id, error: message });
  }
};
