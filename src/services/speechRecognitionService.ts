import { isNativeAndroid } from "./nativePlatform";
import {
  isAndroidSpeechRecognitionAvailable,
  startAndroidSpeechRecognition,
} from "./noiAndroidBridge";

export type SpeechRecognitionFailureReason =
  | "unsupported"
  | "permission-denied"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "unknown";

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstanceLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstanceLike;

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor | undefined;
  webkitSpeechRecognition?: SpeechRecognitionConstructor | undefined;
}

export interface RecognitionCallbacks {
  onInterim: (transcript: string) => void;
  onResult: (candidates: string[]) => void;
  onError: (reason: SpeechRecognitionFailureReason, message: string) => void;
  onEnd: () => void;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as SpeechWindow;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export async function checkSpeechRecognitionAvailability(): Promise<boolean> {
  if (getSpeechRecognitionConstructor() !== null) {
    return true;
  }
  if (isNativeAndroid()) {
    return isAndroidSpeechRecognitionAvailable();
  }
  return false;
}

function normalizeFailureReason(raw: string): SpeechRecognitionFailureReason {
  switch (raw) {
    case "unsupported":
    case "permission-denied":
    case "no-speech":
    case "audio-capture":
    case "network":
    case "aborted":
      return raw;
    default:
      return "unknown";
  }
}

function mapErrorReason(errorCode: string): {
  reason: SpeechRecognitionFailureReason;
  message: string;
} {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        reason: "permission-denied",
        message: "Microphone access was blocked. Allow microphone permission to practice speaking.",
      };
    case "no-speech":
      return {
        reason: "no-speech",
        message: "No speech detected — tap the mic and speak clearly.",
      };
    case "audio-capture":
      return {
        reason: "audio-capture",
        message: "No microphone was found on this device.",
      };
    case "network":
      return {
        reason: "network",
        message: "Speech recognition needs a network connection in this browser.",
      };
    case "aborted":
      return {
        reason: "aborted",
        message: "",
      };
    default:
      return {
        reason: "unknown",
        message: "Could not process speech. Please try again.",
      };
  }
}

function extractCandidates(result: SpeechRecognitionResultLike): string[] {
  const candidates: string[] = [];
  for (const alt of Array.from({ length: result.length }, (_, idx) => result[idx])) {
    if (alt?.transcript.trim()) {
      candidates.push(alt.transcript.trim());
    }
  }
  return candidates;
}

function extractResultTranscripts(results: SpeechRecognitionResultListLike): {
  finalCandidates: string[];
  interimText: string;
  isFinal: boolean;
} {
  const len = results.length;
  if (len === 0) {
    return { finalCandidates: [], interimText: "", isFinal: false };
  }

  const prefixFinals: string[] = [];
  for (let i = 0; i < len - 1; i++) {
    const item = results[i];
    if (item?.isFinal) {
      const top = item[0]?.transcript.trim();
      if (top) prefixFinals.push(top);
    }
  }

  const latest = results[len - 1];
  if (!latest) {
    return { finalCandidates: [], interimText: "", isFinal: false };
  }

  const latestAlternatives = extractCandidates(latest);
  const prefix = prefixFinals.join(" ").trim();

  if (latest.isFinal) {
    const finalCandidates =
      latestAlternatives.length > 0
        ? latestAlternatives.map((alt) => (prefix ? `${prefix} ${alt}` : alt))
        : prefix
          ? [prefix]
          : [];
    return { finalCandidates, interimText: "", isFinal: true };
  }

  const interimLatest = latestAlternatives[0] ?? "";
  const interimText =
    prefix && interimLatest ? `${prefix} ${interimLatest}` : interimLatest || prefix;
  return { finalCandidates: [], interimText, isFinal: false };
}

export function startVietnameseRecognition(callbacks: RecognitionCallbacks): () => void {
  const RecognitionCtor = getSpeechRecognitionConstructor();
  if (!RecognitionCtor) {
    if (isNativeAndroid()) {
      return startAndroidSpeechRecognition({
        onInterim: callbacks.onInterim,
        onResult: callbacks.onResult,
        onError: (reason, message) => {
          callbacks.onError(normalizeFailureReason(reason), message);
        },
        onEnd: callbacks.onEnd,
      });
    }
    callbacks.onError(
      "unsupported",
      "Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.",
    );
    callbacks.onEnd();
    return () => undefined;
  }

  const recognition = new RecognitionCtor();
  recognition.lang = "vi-VN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;
  recognition.continuous = false;

  let finished = false;
  let deliveredResult = false;
  let hadError = false;

  const finalize = () => {
    if (finished) return;
    finished = true;
    callbacks.onEnd();
  };

  recognition.onresult = (event) => {
    const parsed = extractResultTranscripts(event.results);
    if (parsed.isFinal) {
      if (parsed.finalCandidates.length > 0) {
        deliveredResult = true;
        callbacks.onResult(parsed.finalCandidates);
      } else {
        hadError = true;
        callbacks.onError("no-speech", "No speech detected — tap the mic and speak clearly.");
      }
      finalize();
    } else if (parsed.interimText) {
      callbacks.onInterim(parsed.interimText);
    }
  };

  recognition.onerror = (event) => {
    hadError = true;
    const mapped = mapErrorReason(event.error);
    if (mapped.reason !== "aborted" && mapped.message) {
      callbacks.onError(mapped.reason, mapped.message);
    }
    finalize();
  };

  recognition.onend = () => {
    if (!deliveredResult && !hadError && !finished) {
      callbacks.onError("no-speech", "No speech detected — tap the mic and speak clearly.");
    }
    if (!finished) {
      finalize();
    }
  };

  try {
    recognition.start();
  } catch {
    hadError = true;
    callbacks.onError("unknown", "Unable to start microphone recognition.");
    finalize();
  }

  return () => {
    if (!finished) {
      finished = true;
      try {
        recognition.abort();
      } catch {
        // Ignore abort errors on already-ended sessions
      }
      callbacks.onEnd();
    }
  };
}
