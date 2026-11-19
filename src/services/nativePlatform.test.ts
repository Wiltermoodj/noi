import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildApiUrl,
  getApiBaseUrl,
  isCloudApiConfigured,
  isNativePlatform,
  isTwaApp,
} from "./nativePlatform";

describe("nativePlatform", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses relative paths on web when VITE_API_BASE_URL is not configured", () => {
    expect(getApiBaseUrl()).toBe("");
    expect(buildApiUrl("/api/tts")).toBe("/api/tts");
    expect(buildApiUrl("api/tts/status")).toBe("/api/tts/status");
    expect(isCloudApiConfigured()).toBe(true);
  });

  it("resolves absolute API URLs when VITE_API_BASE_URL is set", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://noi-api.example.com/");
    expect(getApiBaseUrl()).toBe("https://noi-api.example.com");
    expect(buildApiUrl("/api/tts")).toBe("https://noi-api.example.com/api/tts");
    expect(buildApiUrl("api/tts/status")).toBe("https://noi-api.example.com/api/tts/status");
    expect(isCloudApiConfigured()).toBe(true);
  });

  it("detects web vs TWA android-app referrer", () => {
    expect(isNativePlatform()).toBe(false);
    expect(isTwaApp()).toBe(false);

    vi.stubGlobal("document", { referrer: "android-app://app.noi.vietnamese" });
    expect(isTwaApp()).toBe(true);
  });
});
