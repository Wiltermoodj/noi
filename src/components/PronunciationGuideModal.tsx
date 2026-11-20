import { Loader2, Play, Volume2, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService } from "../services/audioService";
import { registerBackHandler } from "../services/nativePlatform";
import {
  getConsonantReferenceItems,
  getToneReferenceItems,
  getVowelReferenceItems,
  type SoundReferenceItem,
  type ToneReferenceItem,
} from "../services/pronunciationTipsService";
import {
  isToneAudioSupported,
  playVietnameseToneContour,
  stopToneContour,
} from "../services/toneAudioService";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
} from "../types/vietnamese";
import { RegionIcon } from "./RegionIcon";

interface PronunciationGuideModalProps {
  open: boolean;
  settings: AppSettings;
  onChangeRegion: (region: DialectRegion) => void;
  onClose: () => void;
}

type GuideTab = "tones" | "consonants" | "vowels";

const GUIDE_TABS: { id: GuideTab; label: string }[] = [
  { id: "tones", label: "6 Tones" },
  { id: "consonants", label: "Consonants" },
  { id: "vowels", label: "Vowels" },
];

function buildContourPolyline(points: number[]): string {
  if (points.length === 0) return "0,12 44,12";
  const maxIdx = Math.max(1, points.length - 1);
  return points
    .map((p, idx) => {
      const x = Math.round((idx / maxIdx) * 44);
      const y = Math.round(22 - p * 18);
      return `${String(x)},${String(y)}`;
    })
    .join(" ");
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
      className={`flex min-h-[38px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-xs" : "text-ink-secondary hover:text-ink"
      }`}
    >
      <RegionIcon region={region} className="h-4 w-4" />
      <span>{DIALECT_META[region].label}</span>
    </button>
  );
};

interface GuideTabButtonProps {
  id: GuideTab;
  label: string;
  active: boolean;
  onSelect: (tab: GuideTab) => void;
}

const GuideTabButton: FC<GuideTabButtonProps> = ({ id, label, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[38px] flex-1 whitespace-nowrap border-b-2 px-3 text-xs font-semibold transition-colors ${
        active ? "border-accent text-accent" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
};

interface ToneCardProps {
  item: ToneReferenceItem;
  isBusy: boolean;
  toneAudioSupported: boolean;
  onSpeakWord: (word: string) => void;
  onPlayPitch: (word: string) => void;
}

const ToneCard: FC<ToneCardProps> = ({
  item,
  isBusy,
  toneAudioSupported,
  onSpeakWord,
  onPlayPitch,
}) => {
  const handleSpeak = useCallback(() => {
    onSpeakWord(item.exampleWord);
  }, [item.exampleWord, onSpeakWord]);

  const handlePitch = useCallback(() => {
    onPlayPitch(item.exampleWord);
  }, [item.exampleWord, onPlayPitch]);

  return (
    <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-3.5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft font-display text-sm font-bold text-accent">
                {item.mark}
              </span>
              <div>
                <p className="font-display text-sm font-semibold text-ink">{item.name}</p>
                <p className="text-[11px] font-medium text-accent">{item.summary}</p>
              </div>
            </div>
          </div>

          <svg
            width="48"
            height="26"
            viewBox="0 0 44 24"
            className="shrink-0 overflow-visible text-accent"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1="12"
              x2="44"
              y2="12"
              stroke="currentColor"
              strokeOpacity="0.16"
              strokeDasharray="2 2"
            />
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={buildContourPolyline(item.contour)}
            />
          </svg>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-ink-secondary">{item.tip}</p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
        <div className="min-w-0 text-xs">
          <span className="font-semibold text-ink">{item.exampleWord}</span>
          <span className="text-ink-muted"> · {item.exampleMeaning}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {toneAudioSupported ? (
            <button
              type="button"
              onClick={handlePitch}
              aria-label={`Play pitch melody for ${item.name} tone`}
              title="Hear pitch contour"
              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-border bg-surface-subtle px-2 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
            >
              <Play className="h-3 w-3 text-accent" aria-hidden="true" />
              <span>Pitch</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleSpeak}
            aria-label={`Hear example word ${item.exampleWord}`}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
              isBusy
                ? "bg-accent text-accent-fg"
                : "bg-accent-soft text-accent hover:bg-accent-muted"
            }`}
          >
            {isBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <Volume2 className="h-3 w-3" aria-hidden="true" />
            )}
            <span>Hear</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface SoundRowProps {
  item: SoundReferenceItem;
  isBusy: boolean;
  onSpeakWord: (word: string) => void;
}

const SoundRow: FC<SoundRowProps> = ({ item, isBusy, onSpeakWord }) => {
  const handleSpeak = useCallback(() => {
    onSpeakWord(item.exampleWord);
  }, [item.exampleWord, onSpeakWord]);

  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-1 last:pb-1">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-w-[44px] items-center justify-center rounded-lg bg-surface-muted px-2 py-0.5 font-display text-sm font-bold text-ink">
            {item.symbol}
          </span>
          <span className="text-xs font-semibold text-accent">{item.soundAs}</span>
          {item.regionalHighlight ? (
            <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning-ink">
              Varies by region
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{item.tip}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Example: <span className="font-semibold text-ink">{item.exampleWord}</span> (
          {item.exampleMeaning})
        </p>
      </div>

      <button
        type="button"
        onClick={handleSpeak}
        aria-label={`Hear example word ${item.exampleWord}`}
        className={`flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-xl transition-colors ${
          isBusy ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent hover:bg-accent-muted"
        }`}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
};

export const PronunciationGuideModal: FC<PronunciationGuideModalProps> = ({
  open,
  settings,
  onChangeRegion,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<GuideTab>("tones");
  const speakingState = useSpeakingStatus();
  const titleId = useId();
  const toneAudioSupported = isToneAudioSupported();

  const toneItems = useMemo(() => getToneReferenceItems(settings.region), [settings.region]);
  const consonantItems = useMemo(
    () => getConsonantReferenceItems(settings.region),
    [settings.region],
  );
  const vowelItems = useMemo(() => getVowelReferenceItems(), []);

  useEffect(() => {
    if (!open) return undefined;
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
      stopToneContour();
    };
  }, [onClose, open]);

  const handleSpeakWord = useCallback(
    (word: string) => {
      stopToneContour();
      void audioService.speakWithSettings(word, settings.region, settings);
    },
    [settings],
  );

  const handlePlayPitch = useCallback(
    (word: string) => {
      audioService.stop();
      void playVietnameseToneContour(word, settings.region, settings.playbackSpeed);
    },
    [settings.playbackSpeed, settings.region],
  );

  if (!open) return null;

  const regionMeta = DIALECT_META[settings.region];

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
        aria-label="Close pronunciation guide"
        onClick={onClose}
        className="fixed inset-0"
      />

      <div className="pb-safe-modal relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-canvas shadow-2xl sm:rounded-3xl">
        <div className="border-b border-border bg-surface px-5 pt-5 pb-3 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
                Vietnamese Pronunciation Guide
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {regionMeta.fullRegionLabel} · {regionMeta.accentHint}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close pronunciation guide"
              className="-mr-2 -mt-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-xl bg-surface-muted p-1">
            {DIALECT_REGIONS.map((r) => (
              <RegionTabButton
                key={r}
                region={r}
                active={settings.region === r}
                onSelect={onChangeRegion}
              />
            ))}
          </div>

          <div className="-mb-3 mt-3 flex items-center gap-1">
            {GUIDE_TABS.map((t) => (
              <GuideTabButton
                key={t.id}
                id={t.id}
                label={t.label}
                active={activeTab === t.id}
                onSelect={setActiveTab}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {activeTab === "tones" ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-ink-secondary">
                {settings.region === "north"
                  ? "Northern Vietnamese keeps all 6 tones sharply distinct — especially the dipping hỏi (ả) vs. creaky-rising ngã (ã)."
                  : `${regionMeta.regionName} speech uses 5 distinct spoken tones in everyday conversation because hỏi (ả) and ngã (ã) merge into one smooth dip-and-rise.`}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {toneItems.map((item) => {
                  const isBusy =
                    speakingState.activeText === item.exampleWord &&
                    speakingState.activeRegion === settings.region &&
                    (speakingState.isSpeaking || speakingState.isLoading);
                  return (
                    <ToneCard
                      key={item.tone}
                      item={item}
                      isBusy={isBusy}
                      toneAudioSupported={toneAudioSupported}
                      onSpeakWord={handleSpeakWord}
                      onPlayPitch={handlePlayPitch}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeTab === "consonants" ? (
            <div className="divide-y divide-border-subtle rounded-2xl border border-border bg-surface px-4 py-2">
              {consonantItems.map((item) => {
                const isBusy =
                  speakingState.activeText === item.exampleWord &&
                  speakingState.activeRegion === settings.region &&
                  (speakingState.isSpeaking || speakingState.isLoading);
                return (
                  <SoundRow
                    key={item.id}
                    item={item}
                    isBusy={isBusy}
                    onSpeakWord={handleSpeakWord}
                  />
                );
              })}
            </div>
          ) : null}

          {activeTab === "vowels" ? (
            <div className="divide-y divide-border-subtle rounded-2xl border border-border bg-surface px-4 py-2">
              {vowelItems.map((item) => {
                const isBusy =
                  speakingState.activeText === item.exampleWord &&
                  speakingState.activeRegion === settings.region &&
                  (speakingState.isSpeaking || speakingState.isLoading);
                return (
                  <SoundRow
                    key={item.id}
                    item={item}
                    isBusy={isBusy}
                    onSpeakWord={handleSpeakWord}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
