import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const CUSTOM_API_BASE_KEY = "noi_api_base_url_v1";
const backHandlers: (() => boolean)[] = [];

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function isTwaApp(): boolean {
  if (typeof document === "undefined") return false;
  return document.referrer.startsWith("android-app://");
}

export function isPackagedAndroidApp(): boolean {
  return isNativeAndroid() || isTwaApp();
}

export function getApiBaseUrl(): string {
  const envUrl: unknown = import.meta.env["VITE_API_BASE_URL"];
  if (typeof envUrl === "string" && envUrl.trim().length > 0) {
    return trimTrailingSlash(envUrl.trim());
  }

  if (isNativePlatform() && typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(CUSTOM_API_BASE_KEY);
      if (stored?.trim()) {
        return trimTrailingSlash(stored.trim());
      }
    } catch {
      // Ignore storage access errors
    }
  }

  return "";
}

export function isCloudApiConfigured(): boolean {
  if (!isNativePlatform()) {
    return true;
  }
  return getApiBaseUrl().length > 0;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export function registerBackHandler(handler: () => boolean): () => void {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.lastIndexOf(handler);
    if (idx !== -1) {
      backHandlers.splice(idx, 1);
    }
  };
}

export async function initializeNativeShell(onBackPressed?: () => boolean): Promise<() => void> {
  if (!isNativePlatform()) {
    return () => undefined;
  }

  if (isNativeAndroid()) {
    void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  }

  void SplashScreen.hide().catch(() => undefined);

  const listener = await App.addListener("backButton", ({ canGoBack }) => {
    for (let i = backHandlers.length - 1; i >= 0; i--) {
      const handler = backHandlers[i];
      if (handler?.()) {
        return;
      }
    }
    if (onBackPressed?.()) {
      return;
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void App.exitApp();
  });

  return () => {
    void listener.remove();
  };
}
