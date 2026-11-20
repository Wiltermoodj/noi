import { Check, Copy, Loader2, Volume2, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useId } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService } from "../services/audioService";
import { registerBackHandler } from "../services/nativePlatform";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
} from "../types/vietnamese";

export interface ShowBigPayload {
  english: string;
  north: string;
  central: string;
  south: string;
  phoneticNorth?: string | undefined;
  phoneticCentral?: string | undefined;
  phoneticSouth?: string | undefined;
}

interface ShowBigModalProps {
  payload: ShowBigPayload | null;
  settings: AppSettings;
  onChangeRegion: (region: DialectRegion) => void;
  onClose: () => void;
  onNotify?: ((message: string) => void) | undefined;
}

function getRegionalText(payload: ShowBigPayload, region: DialectRegion): string {
  if (region === "north") return payload.north;
  if (region === "central") return payload.central;
  return payload.south;
}

function getRegionalPhonetic(payload: ShowBigPayload, region: DialectRegion): string | undefined {
  if (region === "north") return payload.phoneticNorth;
  if (region === "central") return payload.phoneticCentral;
  return payload.phoneticSouth;
}

interface RegionTabButtonProps {
  region: DialectRegion;
  active: boolean;
  onSelect: (region: DialectRegion) => void;
}

const RegionTabButton: FC<RegionTabButtonProps> = ({ region, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(region);
  }, [onSelect, region]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[36px] flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-xs" : "text-ink-secondary hover:text-ink"
      }`}
    >
      {DIALECT_META[region].label}
    </button>
  );
};

export const ShowBigModal: FC<ShowBigModalProps> = ({
  payload,
  settings,
  onChangeRegion,
  onClose,
  onNotify,
}) => {
  const { copied, copyText } = useCopyFeedback();
  const speakingState = useSpeakingStatus();
  const titleId = useId();

  useEffect(() => {
    if (!payload) return undefined;
    const unsubBack = registerBackHandler(() => {
      onClose();
      return true;
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubBack();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, payload]);

  const vietnamese = payload ? getRegionalText(payload, settings.region) : "";
  const phonetic = payload ? getRegionalPhonetic(payload, settings.region) : undefined;

  const handleSpeak = useCallback(() => {
    if (!vietnamese) return;
    void audioService.speakWithSettings(vietnamese, settings.region, settings);
  }, [settings, vietnamese]);

  const handleCopy = useCallback(() => {
    if (!vietnamese) return;
    copyText(vietnamese, () => {
      onNotify?.("Copied Vietnamese text");
    });
  }, [copyText, onNotify, vietnamese]);

  if (!payload) return null;

  const isBusy =
    speakingState.activeText === vietnamese &&
    speakingState.activeRegion === settings.region &&
    (speakingState.isSpeaking || speakingState.isLoading);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close display view"
        onClick={onClose}
        className="fixed inset-0"
      />

      <div className="relative z-10 flex w-full max-w-2xl flex-col justify-between rounded-3xl bg-surface p-6 shadow-2xl sm:p-10">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-ink-muted">
            Show to Local · {DIALECT_META[settings.region].fullRegionLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close large display"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="my-8 text-center sm:my-12">
          <h2
            id={titleId}
            className="font-display text-balance text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl md:text-6xl"
          >
            {vietnamese}
          </h2>
          {phonetic ? (
            <p className="mt-4 text-base italic text-accent sm:text-lg">{phonetic}</p>
          ) : null}
          <p className="mt-3 text-base text-ink-secondary sm:text-lg">{payload.english}</p>
        </div>

        <div className="space-y-3 border-t border-border-subtle pt-5">
          <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
            {DIALECT_REGIONS.map((r) => (
              <RegionTabButton
                key={r}
                region={r}
                active={settings.region === r}
                onSelect={onChangeRegion}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleSpeak}
              className="col-span-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover sm:col-span-1"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isBusy ? "Playing…" : "Listen"}</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
            >
              {copied ? (
                <Check className="h-4 w-4 text-accent" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              )}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[48px] items-center justify-center rounded-xl bg-surface-inverse px-4 text-sm font-medium text-ink-inverse transition-colors hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
