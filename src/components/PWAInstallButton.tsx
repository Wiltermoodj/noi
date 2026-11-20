import { Download, Share, Smartphone, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { registerBackHandler } from "../services/nativePlatform";

interface PWAInstallButtonProps {
  variant?: "compact" | "full";
}

interface InstallGuideModalProps {
  mode: "ios" | "browser";
  titleId: string;
  onClose: () => void;
}

const InstallGuideModal: FC<InstallGuideModalProps> = ({ mode, titleId, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-backdrop p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close install guide backdrop"
        onClick={onClose}
        className="fixed inset-0"
      />
      <div className="pb-safe-modal relative z-10 w-full max-w-sm rounded-t-3xl bg-surface p-6 shadow-xl sm:rounded-2xl sm:pb-6">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <h3 id={titleId} className="font-display text-lg font-semibold text-ink">
            {mode === "ios" ? "Install on iPhone / iPad" : "Install Nói for offline use"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instructions"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {mode === "ios" ? (
          <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-secondary">
            <li>
              1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
            </li>
            <li>
              2. Scroll down and select <strong>Add to Home Screen</strong>.
            </li>
            <li>
              3. Open <strong>Nói</strong> from your home screen anytime, even in airplane mode.
            </li>
          </ol>
        ) : (
          <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-secondary">
            <li>
              1. Open your browser&apos;s menu or look for the <strong>Install</strong> icon in the
              address bar.
            </li>
            <li>
              2. Choose <strong>Install Nói</strong> or <strong>Add to Home Screen</strong>.
            </li>
            <li>
              3. Launch <strong>Nói</strong> in its own window with offline phrasebook, translator,
              and cached audio ready.
            </li>
          </ol>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-surface-inverse py-3 text-sm font-medium text-ink-inverse transition-colors hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  );
};

export const PWAInstallButton: FC<PWAInstallButtonProps> = ({ variant = "compact" }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guideMode, setGuideMode] = useState<"ios" | "browser" | null>(null);
  const titleId = useId();

  const handleInstall = useCallback(() => {
    void install();
  }, [install]);

  const openIOSGuide = useCallback(() => {
    setGuideMode("ios");
  }, []);

  const openBrowserGuide = useCallback(() => {
    setGuideMode("browser");
  }, []);

  const closeGuide = useCallback(() => {
    setGuideMode(null);
  }, []);

  useEffect(() => {
    if (guideMode === null) return undefined;
    const unsubBack = registerBackHandler(() => {
      setGuideMode(null);
      return true;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setGuideMode(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubBack();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [guideMode]);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        className={
          variant === "full"
            ? "flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            : "flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        }
      >
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="sm:hidden">Install</span>
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={openIOSGuide}
          className={
            variant === "full"
              ? "flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
              : "flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
          }
        >
          <Share className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sm:hidden">Install</span>
          <span className="hidden sm:inline">Install on iOS</span>
        </button>

        {guideMode ? (
          <InstallGuideModal mode={guideMode} titleId={titleId} onClose={closeGuide} />
        ) : null}
      </>
    );
  }

  if (variant === "full") {
    return (
      <>
        <button
          type="button"
          onClick={openBrowserGuide}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
        >
          <Smartphone className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>Install App for Offline Use</span>
        </button>

        {guideMode ? (
          <InstallGuideModal mode={guideMode} titleId={titleId} onClose={closeGuide} />
        ) : null}
      </>
    );
  }

  return null;
};
