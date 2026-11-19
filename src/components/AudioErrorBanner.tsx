import { AlertCircle, Play } from "lucide-react";
import type { FC } from "react";
import { isToneAudioSupported } from "../services/toneAudioService";

interface AudioErrorBannerProps {
  message: string;
  showToneFallback?: boolean | undefined;
  onPlayToneFallback: () => void;
  onDismiss?: (() => void) | undefined;
  className?: string | undefined;
}

export const AudioErrorBanner: FC<AudioErrorBannerProps> = ({
  message,
  showToneFallback = true,
  onPlayToneFallback,
  onDismiss,
  className = "",
}) => {
  const canPlayTone = showToneFallback && isToneAudioSupported();

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canPlayTone ? (
          <button
            type="button"
            onClick={onPlayToneFallback}
            className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            <Play className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>Tone Melody</span>
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 font-medium underline hover:text-amber-700"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
};
