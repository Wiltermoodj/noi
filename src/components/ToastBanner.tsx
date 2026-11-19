import { RotateCcw, X } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";

export interface ToastItem {
  id: number;
  message: string;
  onUndo?: (() => void) | undefined;
}

interface ToastBannerProps {
  toast: ToastItem | null;
  onDismiss: () => void;
}

export const ToastBanner: FC<ToastBannerProps> = ({ toast, onDismiss }) => {
  const handleUndo = useCallback(() => {
    if (!toast?.onUndo) return;
    toast.onUndo();
    onDismiss();
  }, [onDismiss, toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bottom-safe-toast fixed left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-stone-800 bg-stone-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg md:bottom-5 md:left-auto md:right-5"
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>

      <div className="flex shrink-0 items-center gap-1.5">
        {toast.onUndo ? (
          <button
            type="button"
            onClick={handleUndo}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/25"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Undo</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-stone-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
