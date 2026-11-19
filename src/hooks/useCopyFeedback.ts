import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyFeedback(durationMs = 1600): {
  copied: boolean;
  copyText: (text: string, onCopied?: () => void) => void;
  resetCopied: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetCopied = useCallback(() => {
    clearPendingTimer();
    setCopied(false);
  }, [clearPendingTimer]);

  useEffect(() => {
    return () => {
      clearPendingTimer();
    };
  }, [clearPendingTimer]);

  const copyText = useCallback(
    (text: string, onCopied?: () => void) => {
      if (typeof navigator === "undefined" || !("clipboard" in navigator)) {
        return;
      }
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          clearPendingTimer();
          setCopied(true);
          onCopied?.();
          if (typeof window !== "undefined") {
            timerRef.current = window.setTimeout(() => {
              timerRef.current = null;
              setCopied(false);
            }, durationMs);
          }
        })
        .catch(() => {
          // Ignore clipboard permission errors cleanly
        });
    },
    [clearPendingTimer, durationMs],
  );

  return { copied, copyText, resetCopied };
}
