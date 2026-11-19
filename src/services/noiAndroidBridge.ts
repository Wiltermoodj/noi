import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./nativePlatform";

export interface AndroidTtsVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

export interface AndroidPermissionResult {
  granted: boolean;
  state: string;
}

export interface AndroidSpeechRecognitionCallbacks {
  onInterim: (transcript: string) => void;
  onResult: (candidates: string[]) => void;
  onError: (reason: string, message: string) => void;
  onEnd: () => void;
}

interface NoiAndroidPluginInterface {
  ensureMicrophonePermission: () => Promise<AndroidPermissionResult>;
  openAppSettings: () => Promise<void>;
  openTtsSettings: () => Promise<void>;
  requestAudioFocus: () => Promise<{ granted: boolean }>;
  abandonAudioFocus: () => Promise<void>;
  getTtsVoices: () => Promise<{ ready: boolean; voices: AndroidTtsVoiceInfo[] }>;
  speakTts: (options: {
    text: string;
    lang: string;
    rate: number;
    pitch: number;
    voiceURI?: string;
  }) => Promise<{ completed: boolean; interrupted: boolean }>;
  stopTts: () => Promise<void>;
  isSpeechRecognitionAvailable: () => Promise<{ available: boolean }>;
  startSpeechRecognition: (options: { lang: string }) => Promise<void>;
  stopSpeechRecognition: () => Promise<void>;
  addListener: (
    eventName:
      | "ttsState"
      | "ttsVoicesReady"
      | "speechPartial"
      | "speechResults"
      | "speechError"
      | "speechEnd",
    listenerFunc: (data: Record<string, unknown>) => void,
  ) => Promise<PluginListenerHandle>;
}

const NoiAndroid = registerPlugin<NoiAndroidPluginInterface>("NoiAndroid");

export async function ensureAndroidMicrophonePermission(): Promise<AndroidPermissionResult> {
  if (!isNativeAndroid()) {
    return { granted: true, state: "granted" };
  }
  try {
    return await NoiAndroid.ensureMicrophonePermission();
  } catch {
    return { granted: false, state: "denied" };
  }
}

export async function openAndroidAppSettings(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await NoiAndroid.openAppSettings();
  } catch {
    // Ignore settings launch failures
  }
}

export async function openAndroidTtsSettings(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await NoiAndroid.openTtsSettings();
  } catch {
    // Ignore settings launch failures
  }
}

export async function requestAndroidAudioFocus(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await NoiAndroid.requestAudioFocus();
  } catch {
    // Non-fatal
  }
}

export async function abandonAndroidAudioFocus(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await NoiAndroid.abandonAudioFocus();
  } catch {
    // Non-fatal
  }
}

export async function getAndroidTtsVoices(): Promise<{
  ready: boolean;
  voices: AndroidTtsVoiceInfo[];
}> {
  if (!isNativeAndroid()) {
    return { ready: false, voices: [] };
  }
  try {
    return await NoiAndroid.getTtsVoices();
  } catch {
    return { ready: false, voices: [] };
  }
}

export async function subscribeAndroidTtsVoicesReady(onReady: () => void): Promise<() => void> {
  if (!isNativeAndroid()) {
    return () => undefined;
  }
  try {
    const handle = await NoiAndroid.addListener("ttsVoicesReady", () => {
      onReady();
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => undefined;
  }
}

export async function speakWithAndroidTts(options: {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voiceURI?: string | undefined;
  onStart?: () => void;
  timeoutMs?: number;
}): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  let stateHandle: PluginListenerHandle | null = null;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const playbackBudgetMs =
      options.timeoutMs ??
      Math.max(8000, Math.ceil((options.text.length * 180) / Math.max(0.25, options.rate)));
    const startupBudgetMs = options.timeoutMs ?? 8000;

    let triggerTimeout: (() => void) | null = null;
    const armTimer = (delayMs: number) => {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      timeoutId = globalThis.setTimeout(() => {
        triggerTimeout?.();
      }, delayMs);
    };

    const onStart = options.onStart;
    stateHandle = await NoiAndroid.addListener("ttsState", (data) => {
      if (data["state"] === "started") {
        if (options.timeoutMs === undefined) {
          armTimer(playbackBudgetMs);
        }
        onStart?.();
      }
    });

    const payload =
      options.voiceURI !== undefined
        ? {
            text: options.text,
            lang: options.lang,
            rate: options.rate,
            pitch: options.pitch,
            voiceURI: options.voiceURI,
          }
        : {
            text: options.text,
            lang: options.lang,
            rate: options.rate,
            pitch: options.pitch,
          };

    const timeoutPromise = new Promise<{
      completed: boolean;
      interrupted: boolean;
      timedOut: true;
    }>((resolve) => {
      triggerTimeout = () => {
        void NoiAndroid.stopTts().catch(() => undefined);
        resolve({ completed: false, interrupted: false, timedOut: true });
      };
      armTimer(startupBudgetMs);
    });
    const speakPromise = NoiAndroid.speakTts(payload).then((res) => ({
      ...res,
      timedOut: false as const,
    }));
    const result = await Promise.race([speakPromise, timeoutPromise]);
    if (result.timedOut) {
      return false;
    }
    return result.completed || result.interrupted;
  } catch {
    return false;
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
    if (stateHandle) {
      void stateHandle.remove();
    }
  }
}

export async function stopAndroidTts(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await NoiAndroid.stopTts();
  } catch {
    // Ignore stop errors
  }
}

export async function isAndroidSpeechRecognitionAvailable(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const result = await NoiAndroid.isSpeechRecognitionAvailable();
    return result.available;
  } catch {
    return false;
  }
}

export function startAndroidSpeechRecognition(
  callbacks: AndroidSpeechRecognitionCallbacks,
): () => void {
  if (!isNativeAndroid()) {
    callbacks.onError("unsupported", "Native Android speech recognition is unavailable.");
    callbacks.onEnd();
    return () => undefined;
  }

  const state = { finished: false };
  const isFinished = (): boolean => state.finished;
  const handles: PluginListenerHandle[] = [];

  const cleanup = () => {
    for (const handle of handles) {
      void handle.remove();
    }
    handles.length = 0;
  };

  const finish = () => {
    if (state.finished) return;
    state.finished = true;
    cleanup();
    callbacks.onEnd();
  };

  void (async () => {
    try {
      const partialHandle = await NoiAndroid.addListener("speechPartial", (data) => {
        if (state.finished) return;
        const transcript = data["transcript"];
        if (typeof transcript === "string" && transcript.trim()) {
          callbacks.onInterim(transcript.trim());
        }
      });
      const resultsHandle = await NoiAndroid.addListener("speechResults", (data) => {
        if (state.finished) return;
        const raw = data["candidates"];
        const candidates = Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
        callbacks.onResult(candidates);
      });
      const errorHandle = await NoiAndroid.addListener("speechError", (data) => {
        if (state.finished) return;
        const reason = typeof data["reason"] === "string" ? data["reason"] : "unknown";
        const message =
          typeof data["message"] === "string"
            ? data["message"]
            : "Could not process speech. Please try again.";
        callbacks.onError(reason, message);
      });
      const endHandle = await NoiAndroid.addListener("speechEnd", () => {
        finish();
      });

      if (state.finished) {
        void partialHandle.remove();
        void resultsHandle.remove();
        void errorHandle.remove();
        void endHandle.remove();
        return;
      }

      handles.push(partialHandle, resultsHandle, errorHandle, endHandle);
      await NoiAndroid.startSpeechRecognition({ lang: "vi-VN" });
      if (isFinished()) {
        void NoiAndroid.stopSpeechRecognition().catch(() => undefined);
      }
    } catch {
      callbacks.onError("unknown", "Unable to start Android speech recognition.");
      finish();
    }
  })();

  return () => {
    if (!state.finished) {
      void NoiAndroid.stopSpeechRecognition().catch(() => undefined);
      finish();
    }
  };
}
