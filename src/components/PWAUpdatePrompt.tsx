import { CheckCircle2, RefreshCw, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  applyPWAUpdate,
  dismissPWAUpdateNotice,
  getPWAUpdateSnapshot,
  subscribePWAUpdate,
} from "../services/pwaService";

export const PWAUpdatePrompt: FC = () => {
  const { offlineReady, needRefresh } = useSyncExternalStore(
    subscribePWAUpdate,
    getPWAUpdateSnapshot,
    getPWAUpdateSnapshot,
  );

  useEffect(() => {
    if (!offlineReady || needRefresh) return undefined;
    const timer = window.setTimeout(() => {
      dismissPWAUpdateNotice();
    }, 4500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [offlineReady, needRefresh]);

  const handleReload = useCallback(() => {
    void applyPWAUpdate();
  }, []);

  if (!offlineReady && !needRefresh) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bottom-safe-toast fixed left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-xs font-medium text-stone-800 shadow-lg md:bottom-5 md:left-auto md:right-5"
    >
      <div className="flex min-w-0 items-center gap-2">
        {needRefresh ? (
          <RefreshCw className="h-4 w-4 shrink-0 text-[#0F766E]" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0F766E]" aria-hidden="true" />
        )}
        <span>
          {needRefresh
            ? "A new version of Nói is ready."
            : "Nói is cached and ready for offline use."}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {needRefresh ? (
          <button
            type="button"
            onClick={handleReload}
            className="min-h-[32px] rounded-lg bg-[#0F766E] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#0D655E]"
          >
            Update
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismissPWAUpdateNotice}
          aria-label="Dismiss notification"
          className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
