import { registerSW } from "virtual:pwa-register";
import { isNativePlatform, isPackagedAndroidApp } from "./nativePlatform";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface PWAInstallSnapshot {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
}

export interface PWAUpdateSnapshot {
  offlineReady: boolean;
  needRefresh: boolean;
}

type Listener = () => void;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installListenerInitialized = false;
let swInitialized = false;
let swUpdateIntervalId: number | null = null;
let swOnlineHandler: (() => void) | null = null;
let applyUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

const installListeners = new Set<Listener>();
const updateListeners = new Set<Listener>();

function detectStandalone(): boolean {
  if (isPackagedAndroidApp()) return true;
  if (typeof window === "undefined") return false;
  const standaloneMedia =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return standaloneMedia || iosStandalone;
}

export function detectIOSDevice(): boolean {
  if (typeof window === "undefined") return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isClassicIOS = /iphone|ipad|ipod/.test(userAgent);
  const isIPadOS =
    userAgent.includes("macintosh") &&
    typeof window.navigator.maxTouchPoints === "number" &&
    window.navigator.maxTouchPoints > 1;
  return isClassicIOS || isIPadOS;
}

let installSnapshot: PWAInstallSnapshot = {
  isInstallable: false,
  isInstalled: detectStandalone(),
  isIOS: detectIOSDevice(),
};

let updateSnapshot: PWAUpdateSnapshot = {
  offlineReady: false,
  needRefresh: false,
};

function emitInstallChange(): void {
  const next: PWAInstallSnapshot = {
    isInstallable: deferredPrompt !== null && !installSnapshot.isInstalled,
    isInstalled: installSnapshot.isInstalled,
    isIOS: installSnapshot.isIOS,
  };
  if (
    next.isInstallable === installSnapshot.isInstallable &&
    next.isInstalled === installSnapshot.isInstalled &&
    next.isIOS === installSnapshot.isIOS
  ) {
    return;
  }
  installSnapshot = next;
  for (const listener of installListeners) {
    listener();
  }
}

function setInstalledState(installed: boolean): void {
  if (installed) {
    deferredPrompt = null;
  }
  if (installSnapshot.isInstalled === installed && !installed) {
    emitInstallChange();
    return;
  }
  installSnapshot = {
    ...installSnapshot,
    isInstalled: installed,
    isInstallable: installed ? false : deferredPrompt !== null,
  };
  for (const listener of installListeners) {
    listener();
  }
}

function setUpdateSnapshot(patch: Partial<PWAUpdateSnapshot>): void {
  const next: PWAUpdateSnapshot = {
    ...updateSnapshot,
    ...patch,
  };
  if (
    next.offlineReady === updateSnapshot.offlineReady &&
    next.needRefresh === updateSnapshot.needRefresh
  ) {
    return;
  }
  updateSnapshot = next;
  for (const listener of updateListeners) {
    listener();
  }
}

export function initPWAInstallListener(): void {
  if (installListenerInitialized || typeof window === "undefined") return;
  installListenerInitialized = true;

  const syncStandalone = () => {
    setInstalledState(detectStandalone());
  };

  syncStandalone();

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitInstallChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setInstalledState(true);
  });

  if (typeof window.matchMedia === "function") {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setInstalledState(true);
      } else {
        syncStandalone();
      }
    };
    mediaQuery.addEventListener("change", handleDisplayModeChange);
  }
}

export function subscribePWAInstall(listener: Listener): () => void {
  initPWAInstallListener();
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export function getPWAInstallSnapshot(): PWAInstallSnapshot {
  initPWAInstallListener();
  return installSnapshot;
}

export async function promptPWAInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const activePrompt = deferredPrompt;
  try {
    await activePrompt.prompt();
    const { outcome } = await activePrompt.userChoice;
    if (outcome === "accepted") {
      deferredPrompt = null;
      setInstalledState(true);
      return true;
    }
    return false;
  } catch {
    deferredPrompt = null;
    emitInstallChange();
    return false;
  }
}

export function initPWAServiceWorker(): void {
  if (swInitialized || typeof window === "undefined" || isNativePlatform()) {
    return;
  }
  swInitialized = true;

  applyUpdateFn = registerSW({
    immediate: true,
    onOfflineReady() {
      setUpdateSnapshot({ offlineReady: true });
    },
    onNeedRefresh() {
      setUpdateSnapshot({ needRefresh: true });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      if (swUpdateIntervalId !== null) {
        window.clearInterval(swUpdateIntervalId);
        swUpdateIntervalId = null;
      }
      if (swOnlineHandler) {
        window.removeEventListener("online", swOnlineHandler);
        swOnlineHandler = null;
      }
      const checkForUpdate = () => {
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        void registration.update().catch(() => undefined);
      };
      swUpdateIntervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      swOnlineHandler = checkForUpdate;
      window.addEventListener("online", checkForUpdate);
    },
    onRegisterError(error) {
      console.warn("PWA service worker registration failed:", error);
    },
  });
}

export function subscribePWAUpdate(listener: Listener): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

export function getPWAUpdateSnapshot(): PWAUpdateSnapshot {
  return updateSnapshot;
}

export async function applyPWAUpdate(): Promise<void> {
  if (applyUpdateFn) {
    await applyUpdateFn(true);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export function dismissPWAUpdateNotice(): void {
  setUpdateSnapshot({ offlineReady: false, needRefresh: false });
}
