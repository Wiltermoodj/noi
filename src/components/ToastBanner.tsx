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
      className="bottom-safe-toast fixed left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-border-strong bg-surface-inverse px-4 py-2.5 text-xs font-medium text-ink-inverse shadow-lg md:bottom-5 md:left-auto md:right-5"
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>

      <div className="flex shrink-0 items-center gap-1.5">
        {toast.onUndo ? (
          <button
            type="button"
            onClick={handleUndo}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-surface/15 px-2.5 text-xs font-semibold text-ink-inverse transition-colors hover:bg-surface/25"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Undo</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-ink-inverse/70 transition-colors hover:bg-surface/15 hover:text-ink-inverse"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
