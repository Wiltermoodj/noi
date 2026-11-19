import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerPluginSpy = vi.fn();
const isNativePlatformMock = vi.fn(() => false);
const getPlatformMock = vi.fn(() => "web");

const pluginMocks = {
  ensureMicrophonePermission: vi.fn(async () => {
    await Promise.resolve();
    return { granted: true, state: "granted" };
  }),
  openAppSettings: vi.fn(async () => {
    await Promise.resolve();
  }),
  openTtsSettings: vi.fn(async () => {
    await Promise.resolve();
  }),
  requestAudioFocus: vi.fn(async () => {
    await Promise.resolve();
    return { granted: true };
  }),
  abandonAudioFocus: vi.fn(async () => {
    await Promise.resolve();
  }),
  getTtsVoices: vi.fn(async () => {
    await Promise.resolve();
    return {
      ready: true,
      voices: [
        {
          voiceURI: "vi-vn-x-gft-local",
          name: "vi-vn-x-gft-local",
          lang: "vi-VN",
          localService: true,
        },
        {
          voiceURI: "en-us-x-sfg-local",
          name: "en-us-x-sfg-local",
          lang: "en-US",
          localService: true,
        },
      ],
    };
  }),
  speakTts: vi.fn(async () => {
    await Promise.resolve();
    return { completed: true, interrupted: false };
  }),
  stopTts: vi.fn(async () => {
    await Promise.resolve();
  }),
  isSpeechRecognitionAvailable: vi.fn(async () => {
    await Promise.resolve();
    return { available: true };
  }),
  startSpeechRecognition: vi.fn(async () => {
    await Promise.resolve();
  }),
  stopSpeechRecognition: vi.fn(async () => {
    await Promise.resolve();
  }),
  addListener: vi.fn(async () => {
    await Promise.resolve();
    return {
      remove: vi.fn(async () => {
        await Promise.resolve();
      }),
    };
  }),
};

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
    getPlatform: () => getPlatformMock(),
  },
  registerPlugin: (name: string) => {
    registerPluginSpy(name);
    return pluginMocks;
  },
}));

const appAddListenerMock = vi.fn<
  (
    eventName: string,
    callback: (ev: { canGoBack: boolean }) => void,
  ) => Promise<{
    remove: () => Promise<void>;
  }>
>(async () => {
  await Promise.resolve();
  return {
    remove: vi.fn(async () => {
      await Promise.resolve();
    }),
  };
});

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appAddListenerMock,
    exitApp: vi.fn(async () => {
      await Promise.resolve();
    }),
  },
}));

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: {
    hide: vi.fn(async () => {
      await Promise.resolve();
    }),
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: vi.fn(async () => {
      await Promise.resolve();
    }),
  },
  Style: { Light: "LIGHT", Dark: "DARK", Default: "DEFAULT" },
}));

describe("Android hardware bridge & platform behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(false);
    getPlatformMock.mockReturnValue("web");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles missing navigator.mediaDevices safely without crashing", async () => {
    const AudioCtxStub = vi.fn();
    vi.stubGlobal("window", { AudioContext: AudioCtxStub });
    vi.stubGlobal("navigator", {});

    const { isOfflineAcousticPracticeSupported, startOfflineAcousticSession } = await import(
      "./offlineAcousticPractice"
    );

    expect(isOfflineAcousticPracticeSupported()).toBe(false);

    const onError = vi.fn();
    const stop = startOfflineAcousticSession("Xin chào", "south", {
      onLiveLevel: vi.fn(),
      onComplete: vi.fn(),
      onError,
    });
    stop();
    expect(onError).toHaveBeenCalledWith(
      "Local microphone recording is unavailable in this browser.",
    );
  });

  it("routes TTS, voice inventory, and speech recognition via NoiAndroid on native Android", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");

    const { audioService } = await import("./audioService");
    const { checkSpeechRecognitionAvailability } = await import("./speechRecognitionService");
    const { ensureAndroidMicrophonePermission } = await import("./noiAndroidBridge");

    const micPerm = await ensureAndroidMicrophonePermission();
    expect(micPerm).toEqual({ granted: true, state: "granted" });
    expect(pluginMocks.ensureMicrophonePermission).toHaveBeenCalledTimes(1);

    const speechAvail = await checkSpeechRecognitionAvailability();
    expect(speechAvail).toBe(true);
    expect(pluginMocks.isSpeechRecognitionAvailable).toHaveBeenCalledTimes(1);

    const unsubVoices = audioService.subscribeVoices(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    unsubVoices();

    expect(pluginMocks.getTtsVoices).toHaveBeenCalled();

    await audioService.speakVietnamese("Cà phê sữa đá", "south", {
      ttsSource: "device-only",
      playbackSpeed: 80,
    });

    const { computePlaybackPacing } = await import("./playbackPacing");
    expect(pluginMocks.speakTts).toHaveBeenCalledWith({
      text: "Cà phê sữa đá",
      lang: "vi-VN",
      rate: computePlaybackPacing(80).deviceTtsRate,
      pitch: 1,
      voiceURI: "vi-vn-x-gft-local",
    });
  });

  it("prioritizes registered modal back handlers in LIFO order", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");

    const { initializeNativeShell, registerBackHandler } = await import("./nativePlatform");

    const cleanupShell = await initializeNativeShell(() => false);

    const captured = appAddListenerMock.mock.calls.at(-1)?.[1] as unknown as
      | ((ev: { canGoBack: boolean }) => void)
      | undefined;
    expect(typeof captured).toBe("function");

    const outerHandler = vi.fn(() => true);
    const innerHandler = vi.fn(() => true);

    const unsubOuter = registerBackHandler(outerHandler);
    const unsubInner = registerBackHandler(innerHandler);

    captured?.({ canGoBack: false });
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(outerHandler).not.toHaveBeenCalled();

    unsubInner();
    captured?.({ canGoBack: false });
    expect(outerHandler).toHaveBeenCalledTimes(1);

    unsubOuter();
    cleanupShell();
  });

  it("cancels cleanly if stopped before async speech recognition start completes", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");

    const { startAndroidSpeechRecognition } = await import("./noiAndroidBridge");

    const onEnd = vi.fn();
    const stop = startAndroidSpeechRecognition({
      onInterim: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      onEnd,
    });

    stop();
    await new Promise((r) => setTimeout(r, 20));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(pluginMocks.stopSpeechRecognition).toHaveBeenCalledTimes(1);
    expect(pluginMocks.startSpeechRecognition).not.toHaveBeenCalled();
  });

  it("times out hung native speakTts calls and invokes stopTts cleanly", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");
    pluginMocks.speakTts.mockImplementationOnce(async () => new Promise(() => undefined));

    const { speakWithAndroidTts } = await import("./noiAndroidBridge");
    const completed = await speakWithAndroidTts({
      text: "Xin chào",
      lang: "vi-VN",
      rate: 1,
      pitch: 1,
      timeoutMs: 25,
    });

    expect(completed).toBe(false);
    expect(pluginMocks.stopTts).toHaveBeenCalledTimes(1);
  });

  it("skips relative /api/tts requests on native Android when VITE_API_BASE_URL is unset", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getPlatformMock.mockReturnValue("android");
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { isCloudApiConfigured } = await import("./nativePlatform");
    const { audioService } = await import("./audioService");

    expect(isCloudApiConfigured()).toBe(false);
    const status = await audioService.checkCloudTtsStatus();
    expect(status).toEqual({ available: false, cachedClips: 0 });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
