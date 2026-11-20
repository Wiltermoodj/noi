import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Mic,
  Play,
  Square,
  Star,
  Volume2,
} from "lucide-react";
import type { FC, TouchEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService, type SpeakingStatus } from "../services/audioService";
import { shouldUseNativeSlowClip } from "../services/playbackPacing";
import { getPhrasePhonetic, getPhraseText } from "../services/storageService";
import { playVietnameseToneContour } from "../services/toneAudioService";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
  PHRASE_CATEGORIES,
  type Phrase,
  type PhraseCategory,
} from "../types/vietnamese";
import { AudioErrorBanner } from "./AudioErrorBanner";
import { LazyPracticePanel } from "./LazyPracticePanel";
import { PlaybackSpeedSlider } from "./PlaybackSpeedSlider";
import { PronunciationTipsCard } from "./PronunciationTipsCard";
import { RegionIcon } from "./RegionIcon";

interface LearnViewProps {
  phrases: Phrase[];
  settings: AppSettings;
  onChangeRegion: (region: DialectRegion) => void;
  onChangePlaybackSpeed: (speedPercent: number) => void;
  onTogglePhraseStar: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string, onUndo?: () => void) => void;
}

const TOPIC_OPTIONS: { id: "All" | PhraseCategory; label: string }[] = [
  { id: "All", label: "All Situations" },
  ...PHRASE_CATEGORIES.map((id) => ({ id, label: id })),
];

function handleStudyShortcut(
  event: KeyboardEvent,
  ctx: {
    phrase: Phrase | undefined;
    settings: AppSettings;
    navigate: (delta: number) => void;
  },
): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
    return;
  }
  if (
    target?.closest('[role="search"], [role="dialog"]') !== null ||
    (typeof document !== "undefined" &&
      document.querySelector('[role="dialog"][aria-modal="true"]') !== null)
  ) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    ctx.navigate(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    ctx.navigate(1);
    return;
  }
  if (!ctx.phrase) return;

  if (event.key === " " && tag !== "BUTTON") {
    event.preventDefault();
    void audioService.speakWithSettings(
      getPhraseText(ctx.phrase, ctx.settings.region),
      ctx.settings.region,
      ctx.settings,
    );
    return;
  }

  if (event.key.toLowerCase() === "l") {
    event.preventDefault();
    void audioService.speakWithSettings(
      getPhraseText(ctx.phrase, ctx.settings.region),
      ctx.settings.region,
      ctx.settings,
    );
  }
}

interface RegionCompareRowProps {
  region: DialectRegion;
  active: boolean;
  isPlayingRegion: boolean;
  isLoadingRegion: boolean;
  text: string;
  phonetic: string;
  onSwitchAndSpeak: (region: DialectRegion, text: string) => void;
  onSpeakOnly: (region: DialectRegion, text: string) => void;
}

const RegionCompareRowBase: FC<RegionCompareRowProps> = ({
  region,
  active,
  isPlayingRegion,
  isLoadingRegion,
  text,
  phonetic,
  onSwitchAndSpeak,
  onSpeakOnly,
}) => {
  const meta = DIALECT_META[region];

  const handleRowClick = useCallback(() => {
    onSwitchAndSpeak(region, text);
  }, [onSwitchAndSpeak, region, text]);

  const handleSpeakerClick = useCallback(() => {
    onSpeakOnly(region, text);
  }, [onSpeakOnly, region, text]);

  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
      <button type="button" onClick={handleRowClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 text-xs">
          <RegionIcon region={region} className="h-5 w-5" />
          <span className={`font-semibold ${active ? "text-accent" : "text-ink-secondary"}`}>
            {meta.label}
          </span>
          <span aria-hidden="true" className="text-border-strong">
            ·
          </span>
          <span className="text-ink-muted">{meta.cities}</span>
        </div>
        <p className={`mt-1 text-sm font-medium ${active ? "text-ink" : "text-ink-secondary"}`}>
          {text}
        </p>
        <p className="mt-0.5 text-xs italic text-accent">{phonetic}</p>
      </button>

      <button
        type="button"
        aria-label={`Listen to ${meta.label} pronunciation`}
        onClick={handleSpeakerClick}
        className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl transition-colors ${
          isPlayingRegion || isLoadingRegion
            ? "bg-accent text-accent-fg"
            : active
              ? "bg-accent-soft text-accent hover:bg-accent-muted"
              : "text-ink-muted hover:bg-surface-muted hover:text-ink"
        }`}
      >
        {isLoadingRegion ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
};

const RegionCompareRow = memo(RegionCompareRowBase);

interface StudyQueueRowProps {
  phrase: Phrase;
  index: number;
  region: DialectRegion;
  isCurrent: boolean;
  onJump: (index: number) => void;
}

const StudyQueueRowBase: FC<StudyQueueRowProps> = ({
  phrase,
  index,
  region,
  isCurrent,
  onJump,
}) => {
  const handleClick = useCallback(() => {
    onJump(index);
  }, [index, onJump]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex min-h-[52px] w-full items-center justify-between gap-3 py-2.5 text-left transition-colors ${
        isCurrent ? "text-accent" : "text-ink-secondary hover:text-ink"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{getPhraseText(phrase, region)}</p>
        <p className="truncate text-xs text-ink-muted">{phrase.english}</p>
      </div>
      {phrase.isStarred ? (
        <Star className="h-3.5 w-3.5 shrink-0 fill-star-fill text-star" aria-hidden="true" />
      ) : null}
    </button>
  );
};

const StudyQueueRow = memo(StudyQueueRowBase);

interface RegionMenuOptionProps {
  region: DialectRegion;
  selected: boolean;
  onSelect: (region: DialectRegion) => void;
}

const RegionMenuOption: FC<RegionMenuOptionProps> = ({ region, selected, onSelect }) => {
  const meta = DIALECT_META[region];
  const handleClick = useCallback(() => {
    onSelect(region);
  }, [onSelect, region]);

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={handleClick}
      className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
        selected
          ? "bg-accent-soft font-semibold text-accent"
          : "text-ink-secondary hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <RegionIcon region={region} className="h-7 w-7" />
        <span className="min-w-0">
          <span className="block">{meta.regionName}</span>
          <span className="block text-[11px] font-normal text-ink-muted">{meta.cities}</span>
        </span>
      </span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" /> : null}
    </button>
  );
};

interface TopicMenuOptionProps {
  id: "All" | PhraseCategory;
  label: string;
  selected: boolean;
  onSelect: (topic: "All" | PhraseCategory) => void;
}

const TopicMenuOption: FC<TopicMenuOptionProps> = ({ id, label, selected, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={handleClick}
      className={`flex min-h-[38px] w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
        selected
          ? "bg-accent-soft font-semibold text-accent"
          : "text-ink-secondary hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      <span className="truncate">{label}</span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" /> : null}
    </button>
  );
};

interface StudyCardHeaderProps {
  region: DialectRegion;
  category: Phrase["category"];
  topicFilter: "All" | PhraseCategory;
  bestAccuracy?: number | undefined;
  isStarred: boolean;
  onChangeRegion: (region: DialectRegion) => void;
  onSelectTopic: (topic: "All" | PhraseCategory) => void;
  onToggleStar: () => void;
}

const StudyCardHeader: FC<StudyCardHeaderProps> = ({
  region,
  category,
  topicFilter,
  bestAccuracy,
  isStarred,
  onChangeRegion,
  onSelectTopic,
  onToggleStar,
}) => {
  const [openMenu, setOpenMenu] = useState<"region" | "topic" | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const toggleRegionMenu = useCallback(() => {
    setOpenMenu((prev) => (prev === "region" ? null : "region"));
  }, []);

  const toggleTopicMenu = useCallback(() => {
    setOpenMenu((prev) => (prev === "topic" ? null : "topic"));
  }, []);

  const handleSelectRegion = useCallback(
    (nextRegion: DialectRegion) => {
      onChangeRegion(nextRegion);
      setOpenMenu(null);
    },
    [onChangeRegion],
  );

  const handleSelectTopic = useCallback(
    (nextTopic: "All" | PhraseCategory) => {
      onSelectTopic(nextTopic);
      setOpenMenu(null);
    },
    [onSelectTopic],
  );

  const regionMeta = DIALECT_META[region];
  const regionName = regionMeta.regionName;
  const isTopicFiltered = topicFilter !== "All";

  return (
    <div className="flex items-start justify-between gap-2">
      <div
        ref={menuContainerRef}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-xs font-medium text-ink-muted"
      >
        <div className="relative">
          <button
            type="button"
            onClick={toggleRegionMenu}
            aria-haspopup="menu"
            aria-expanded={openMenu === "region"}
            aria-label={`Dialect region: ${regionName}. Click to change region.`}
            title={`${regionName} · ${regionMeta.cities}`}
            className={`-ml-1 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full p-1 transition-colors ${
              openMenu === "region"
                ? "bg-surface-muted ring-2 ring-accent-border"
                : "hover:bg-surface-muted"
            }`}
          >
            <RegionIcon region={region} className="h-7 w-7" />
          </button>

          {openMenu === "region" ? (
            <div
              role="menu"
              aria-label="Select dialect region"
              className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            >
              {DIALECT_REGIONS.map((item) => (
                <RegionMenuOption
                  key={item}
                  region={item}
                  selected={region === item}
                  onSelect={handleSelectRegion}
                />
              ))}
            </div>
          ) : null}
        </div>

        <span aria-hidden="true" className="px-0.5 text-border-strong">
          ·
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={toggleTopicMenu}
            aria-haspopup="menu"
            aria-expanded={openMenu === "topic"}
            aria-label={`Situation: ${category}. Click to filter situations.`}
            className={`inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-lg px-1.5 transition-colors ${
              openMenu === "topic"
                ? "bg-surface-muted text-ink"
                : isTopicFiltered
                  ? "text-accent hover:bg-accent-soft"
                  : "text-ink-secondary hover:bg-surface-muted hover:text-ink"
            }`}
          >
            <span>{category}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 ${isTopicFiltered ? "text-accent" : "text-ink-faint"}`}
              aria-hidden="true"
            />
          </button>

          {openMenu === "topic" ? (
            <div
              role="menu"
              aria-label="Filter by situation"
              className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            >
              {TOPIC_OPTIONS.map((topic) => (
                <TopicMenuOption
                  key={topic.id}
                  id={topic.id}
                  label={topic.label}
                  selected={topicFilter === topic.id}
                  onSelect={handleSelectTopic}
                />
              ))}
            </div>
          ) : null}
        </div>

        {bestAccuracy !== undefined ? (
          <>
            <span aria-hidden="true" className="px-0.5 text-border-strong">
              ·
            </span>
            <span className="pl-1 text-accent tabular-nums">Best {bestAccuracy}%</span>
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggleStar}
        aria-pressed={isStarred}
        aria-label={isStarred ? "Remove from Saved" : "Save phrase"}
        title={isStarred ? "Saved" : "Save"}
        className={`-mr-2 -mt-0.5 flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg transition-colors ${
          isStarred
            ? "text-star hover:bg-star-soft"
            : "text-ink-faint hover:bg-surface-muted hover:text-ink-secondary"
        }`}
      >
        <Star
          className={`h-4 w-4 ${isStarred ? "fill-star-fill text-star" : ""}`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
};

interface StudyCardProps {
  phrase: Phrase;
  settings: AppSettings;
  topicFilter: "All" | PhraseCategory;
  showNote: boolean;
  practiceMode: boolean;
  copied: boolean;
  speakingState: SpeakingStatus;
  onToggleStar: () => void;
  onCopy: () => void;
  onChangeRegion: (region: DialectRegion) => void;
  onChangePlaybackSpeed: (speedPercent: number) => void;
  onSelectTopic: (topic: "All" | PhraseCategory) => void;
  onSpeakEnglish: () => void;
  onSpeakVietnamese: () => void;
  onSpeakVietnameseSlow: () => void;
  onTogglePractice: () => void;
  onStopAudio: () => void;
  onToggleNote: () => void;
  onPlayToneFallback: () => void;
  onPracticeEvaluated: (accuracy: number) => void;
  onOpenPronunciationGuide: () => void;
  onSwipePrev: () => void;
  onSwipeNext: () => void;
}

const StudyCard: FC<StudyCardProps> = ({
  phrase,
  settings,
  topicFilter,
  showNote,
  practiceMode,
  copied,
  speakingState,
  onToggleStar,
  onCopy,
  onChangeRegion,
  onChangePlaybackSpeed,
  onSelectTopic,
  onSpeakEnglish,
  onSpeakVietnamese,
  onSpeakVietnameseSlow,
  onTogglePractice,
  onStopAudio,
  onToggleNote,
  onPlayToneFallback,
  onPracticeEvaluated,
  onOpenPronunciationGuide,
  onSwipePrev,
  onSwipeNext,
}) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const viText = getPhraseText(phrase, settings.region);

  const handleTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input[type="range"]')) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const touch = e.changedTouches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) {
          onSwipeNext();
        } else {
          onSwipePrev();
        }
      }
    },
    [onSwipeNext, onSwipePrev],
  );

  return (
    <section
      aria-label="Study card"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="rounded-2xl border border-border bg-surface p-5 sm:p-8"
    >
      <StudyCardHeader
        region={settings.region}
        category={phrase.category}
        topicFilter={topicFilter}
        bestAccuracy={phrase.review?.bestPracticeAccuracy}
        isStarred={Boolean(phrase.isStarred)}
        onChangeRegion={onChangeRegion}
        onSelectTopic={onSelectTopic}
        onToggleStar={onToggleStar}
      />

      <div className="mt-2.5 text-center">
        <button
          type="button"
          onClick={onSpeakEnglish}
          className="group inline-flex min-h-[36px] items-center justify-center gap-2 rounded-xl px-3 py-1 text-base text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink sm:text-lg"
        >
          <span>{phrase.english}</span>
          <Volume2
            className={`h-4 w-4 shrink-0 ${
              speakingState.isSpeaking && speakingState.activeLang === "en"
                ? "text-accent"
                : "text-ink-faint group-hover:text-ink-secondary"
            }`}
            aria-hidden="true"
          />
        </button>
      </div>

      <hr className="my-2.5 border-border-subtle" />

      <div className="text-center">
        <h1 className="font-display text-balance text-3xl font-semibold leading-snug tracking-tight sm:text-4xl">
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy Vietnamese phrase: ${viText}`}
            title="Click to copy phrase"
            className={`inline-block max-w-full cursor-pointer rounded-xl px-3 py-0.5 transition-colors ${
              copied
                ? "bg-accent-soft text-accent"
                : "text-ink hover:bg-surface-subtle active:bg-surface-muted"
            }`}
          >
            {viText}
          </button>
        </h1>
        <p className="mt-2 text-sm italic text-accent sm:text-base">
          {getPhrasePhonetic(phrase, settings.region)}
        </p>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        {speakingState.isSpeaking || speakingState.isLoading ? (
          <button
            type="button"
            onClick={onStopAudio}
            className="flex min-h-[48px] items-center gap-2 rounded-xl bg-surface-inverse px-5 py-2.5 text-sm font-medium text-ink-inverse transition-colors hover:opacity-90"
          >
            {speakingState.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Square className="h-4 w-4 fill-current" aria-hidden="true" />
            )}
            <span>{speakingState.isLoading ? "Preparing…" : "Stop Audio"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSpeakVietnamese}
            className="flex min-h-[48px] items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>
              {settings.playbackSpeed < 100
                ? `Listen VI (${String(settings.playbackSpeed)}%)`
                : "Listen VI"}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onTogglePractice}
          aria-pressed={practiceMode}
          className={`flex min-h-[48px] items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
            practiceMode
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface text-ink hover:bg-surface-subtle"
          }`}
        >
          <Mic
            className={`h-4 w-4 ${practiceMode ? "text-accent" : "text-ink-muted"}`}
            aria-hidden="true"
          />
          <span>Practice</span>
        </button>
      </div>

      <div className="mx-auto mt-4 max-w-md">
        <PlaybackSpeedSlider
          variant="compact"
          value={settings.playbackSpeed}
          onChange={onChangePlaybackSpeed}
        />
      </div>

      {speakingState.audioError ? (
        <AudioErrorBanner
          message={speakingState.audioError}
          onPlayToneFallback={onPlayToneFallback}
          onDismiss={onStopAudio}
          className="mt-4"
        />
      ) : null}

      {practiceMode ? (
        <LazyPracticePanel
          key={`${phrase.id}-${settings.region}`}
          phraseText={getPhraseText(phrase, settings.region)}
          region={settings.region}
          playbackSpeed={settings.playbackSpeed}
          bestAccuracy={phrase.review?.bestPracticeAccuracy}
          onChangeRegion={onChangeRegion}
          onPlayNormal={onSpeakVietnamese}
          onPlaySlow={onSpeakVietnameseSlow}
          onPracticeEvaluated={onPracticeEvaluated}
        />
      ) : null}

      <PronunciationTipsCard
        phraseText={viText}
        settings={settings}
        maxTips={3}
        onOpenGuide={onOpenPronunciationGuide}
        className="mt-6 border-t border-border-subtle pt-4"
      />

      <div className="mt-4 border-t border-border-subtle pt-3 text-center">
        <button
          type="button"
          onClick={onToggleNote}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink"
        >
          <Info className="h-4 w-4 text-accent" aria-hidden="true" />
          <span>{showNote ? "Hide Street Note" : "Why locals say this (Street vs. Textbook)"}</span>
        </button>

        {showNote ? (
          <div className="mt-3 space-y-2.5 rounded-xl bg-surface-subtle p-4 text-left">
            <div>
              <p className="text-xs font-medium text-ink-muted">Textbook says</p>
              <p className="mt-0.5 text-sm text-ink-secondary line-through decoration-ink-faint">
                {phrase.textbook}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-accent">Real spoken Vietnamese</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink">{phrase.streetNote}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};

interface EmptyStudyStateProps {
  hasTopicFilter: boolean;
  onClearTopic: () => void;
}

const EmptyStudyState: FC<EmptyStudyStateProps> = ({ hasTopicFilter, onClearTopic }) => (
  <section className="rounded-2xl border border-border bg-surface p-8 text-center">
    <h1 className="font-display text-lg font-semibold text-ink">
      {hasTopicFilter ? "No phrases for this situation" : "No phrases available"}
    </h1>
    <p className="mt-1 text-sm text-ink-muted">
      {hasTopicFilter
        ? "Switch back to All Situations to continue studying."
        : "Add phrases from the Library or Translate tab to begin studying."}
    </p>
    {hasTopicFilter ? (
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onClearTopic}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <span>All Situations</span>
        </button>
      </div>
    ) : null}
  </section>
);

export const LearnView: FC<LearnViewProps> = ({
  phrases,
  settings,
  onChangeRegion,
  onChangePlaybackSpeed,
  onTogglePhraseStar,
  onRecordPractice,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  const [topicFilter, setTopicFilter] = useState<"All" | PhraseCategory>("All");
  const [index, setIndex] = useState(0);
  const [showNote, setShowNote] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const { copied, copyText, resetCopied } = useCopyFeedback();
  const speakingState = useSpeakingStatus();

  const studyList = useMemo(
    () => (topicFilter === "All" ? phrases : phrases.filter((p) => p.category === topicFilter)),
    [phrases, topicFilter],
  );

  const safeIndex = Math.min(index, Math.max(0, studyList.length - 1));
  const phrase = studyList[safeIndex];
  const queueStart = Math.max(0, Math.min(safeIndex - 2, Math.max(0, studyList.length - 6)));
  const visibleQueue = studyList.slice(queueStart, queueStart + 6);

  const speakCurrentBoth = useCallback(
    (targetPhrase: Phrase) => {
      const vi = getPhraseText(targetPhrase, settings.region);
      void audioService.speakBothWithSettings(targetPhrase.english, vi, settings.region, settings);
    },
    [settings],
  );

  const navigate = useCallback(
    (delta: number) => {
      if (studyList.length === 0) return;
      const nextIdx = (safeIndex + delta + studyList.length) % studyList.length;
      setIndex(nextIdx);
      setShowNote(false);
      resetCopied();
      const nextPhrase = studyList[nextIdx];
      if (settings.autoPlayBoth && nextPhrase) {
        speakCurrentBoth(nextPhrase);
      } else {
        audioService.stop();
      }
    },
    [resetCopied, safeIndex, settings.autoPlayBoth, speakCurrentBoth, studyList],
  );

  const jumpTo = useCallback(
    (targetIdx: number) => {
      setIndex(targetIdx);
      setShowNote(false);
      resetCopied();
      const targetPhrase = studyList[targetIdx];
      if (settings.autoPlayBoth && targetPhrase) {
        speakCurrentBoth(targetPhrase);
      } else {
        audioService.stop();
      }
    },
    [resetCopied, settings.autoPlayBoth, speakCurrentBoth, studyList],
  );

  const handleSelectTopic = useCallback((nextTopic: "All" | PhraseCategory) => {
    setTopicFilter(nextTopic);
    setIndex(0);
    setShowNote(false);
  }, []);

  const clearTopicFilter = useCallback(() => {
    handleSelectTopic("All");
  }, [handleSelectTopic]);

  const togglePracticeMode = useCallback(() => {
    setPracticeMode((prev) => !prev);
  }, []);

  const handleToggleCurrentStar = useCallback(() => {
    if (phrase) onTogglePhraseStar(phrase.id);
  }, [onTogglePhraseStar, phrase]);

  const handleCopyPhrase = useCallback(() => {
    if (!phrase) return;
    const text = getPhraseText(phrase, settings.region);
    copyText(text, () => {
      onNotify("Copied Vietnamese phrase");
    });
  }, [copyText, onNotify, phrase, settings.region]);

  const handleSpeakEnglish = useCallback(() => {
    if (phrase) void audioService.speakEnglish(phrase.english, settings.preferredEnVoiceURI);
  }, [phrase, settings.preferredEnVoiceURI]);

  const handleStopAudio = useCallback(() => {
    audioService.stop();
  }, []);

  const handlePlayToneFallback = useCallback(() => {
    if (phrase) {
      void playVietnameseToneContour(
        getPhraseText(phrase, settings.region),
        settings.region,
        settings.playbackSpeed,
      );
    }
  }, [phrase, settings.playbackSpeed, settings.region]);

  const handleSpeakVietnamese = useCallback(() => {
    if (phrase) {
      void audioService.speakWithSettings(
        getPhraseText(phrase, settings.region),
        settings.region,
        settings,
      );
    }
  }, [phrase, settings]);

  const handleSpeakVietnameseSlow = useCallback(() => {
    if (phrase) {
      void audioService.speakSlowWithSettings(
        getPhraseText(phrase, settings.region),
        settings.region,
        settings,
      );
    }
  }, [phrase, settings]);

  const handleToggleNote = useCallback(() => {
    setShowNote((prev) => !prev);
  }, []);

  const handlePrev = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handleNext = useCallback(() => {
    navigate(1);
  }, [navigate]);

  const handlePracticeEvaluated = useCallback(
    (accuracy: number) => {
      if (phrase) {
        onRecordPractice(phrase.id, accuracy);
      }
    },
    [onRecordPractice, phrase],
  );

  const handleSwitchAndSpeak = useCallback(
    (region: DialectRegion, text: string) => {
      onChangeRegion(region);
      void audioService.speakWithSettings(text, region, settings);
    },
    [onChangeRegion, settings],
  );

  const handleSpeakRegionOnly = useCallback(
    (region: DialectRegion, text: string) => {
      void audioService.speakWithSettings(text, region, settings);
    },
    [settings],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleStudyShortcut(event, {
        phrase,
        settings,
        navigate,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigate, phrase, settings]);

  useEffect(() => {
    if (!phrase || settings.ttsSource === "device-only") return undefined;
    const useSlowClip = shouldUseNativeSlowClip(settings.playbackSpeed);
    const activePrefetchOptions = {
      slow: useSlowClip,
      ttsSource: settings.ttsSource,
      ttsVoiceProfile: settings.ttsVoiceProfile,
    };
    const normalPrefetchOptions = {
      slow: false,
      ttsSource: settings.ttsSource,
      ttsVoiceProfile: settings.ttsVoiceProfile,
    };
    const nextPhrase =
      studyList.length > 1 ? studyList[(safeIndex + 1) % studyList.length] : undefined;
    const timerId = window.setTimeout(() => {
      const currentText = getPhraseText(phrase, settings.region);
      void audioService.prefetchVietnamese(currentText, settings.region, activePrefetchOptions);
      if (useSlowClip) {
        void audioService.prefetchVietnamese(currentText, settings.region, normalPrefetchOptions);
      }
      for (const dialect of DIALECT_REGIONS) {
        if (dialect !== settings.region) {
          void audioService.prefetchVietnamese(
            getPhraseText(phrase, dialect),
            dialect,
            activePrefetchOptions,
          );
        }
      }
      if (nextPhrase && nextPhrase.id !== phrase.id) {
        void audioService.prefetchVietnamese(
          getPhraseText(nextPhrase, settings.region),
          settings.region,
          activePrefetchOptions,
        );
      }
    }, 250);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    phrase,
    safeIndex,
    settings.playbackSpeed,
    settings.region,
    settings.ttsSource,
    settings.ttsVoiceProfile,
    studyList,
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
      <div className="space-y-4 lg:col-span-7">
        {!phrase ? (
          <EmptyStudyState hasTopicFilter={topicFilter !== "All"} onClearTopic={clearTopicFilter} />
        ) : (
          <>
            <StudyCard
              phrase={phrase}
              settings={settings}
              topicFilter={topicFilter}
              showNote={showNote}
              practiceMode={practiceMode}
              copied={copied}
              speakingState={speakingState}
              onToggleStar={handleToggleCurrentStar}
              onCopy={handleCopyPhrase}
              onChangeRegion={onChangeRegion}
              onChangePlaybackSpeed={onChangePlaybackSpeed}
              onSelectTopic={handleSelectTopic}
              onSpeakEnglish={handleSpeakEnglish}
              onSpeakVietnamese={handleSpeakVietnamese}
              onSpeakVietnameseSlow={handleSpeakVietnameseSlow}
              onTogglePractice={togglePracticeMode}
              onStopAudio={handleStopAudio}
              onToggleNote={handleToggleNote}
              onPlayToneFallback={handlePlayToneFallback}
              onPracticeEvaluated={handlePracticeEvaluated}
              onOpenPronunciationGuide={onOpenPronunciationGuide}
              onSwipePrev={handlePrev}
              onSwipeNext={handleNext}
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handlePrev}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle active:scale-[0.99]"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-surface-inverse px-4 text-sm font-medium text-ink-inverse transition-colors hover:opacity-90 active:scale-[0.99]"
              >
                <span>Next</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>

      <aside className="space-y-4 lg:col-span-5">
        {phrase ? (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-ink">Across Vietnam</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Tap any region to switch your active dialect and hear the difference.
            </p>

            <div className="mt-4 divide-y divide-border-subtle">
              {DIALECT_REGIONS.map((region) => (
                <RegionCompareRow
                  key={region}
                  region={region}
                  active={settings.region === region}
                  isPlayingRegion={
                    speakingState.isSpeaking ? speakingState.activeRegion === region : false
                  }
                  isLoadingRegion={
                    speakingState.isLoading ? speakingState.activeRegion === region : false
                  }
                  text={getPhraseText(phrase, region)}
                  phonetic={getPhrasePhonetic(phrase, region)}
                  onSwitchAndSpeak={handleSwitchAndSpeak}
                  onSpeakOnly={handleSpeakRegionOnly}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-ink">Up Next</h2>
            {visibleQueue.length > 0 ? (
              <span className="text-xs text-ink-muted tabular-nums">
                {String(queueStart + 1)}–{String(queueStart + visibleQueue.length)} of{" "}
                {String(studyList.length)}
              </span>
            ) : null}
          </div>

          {visibleQueue.length > 0 ? (
            <div className="mt-3 divide-y divide-border-subtle">
              {visibleQueue.map((item, offset) => {
                const actualIndex = queueStart + offset;
                return (
                  <StudyQueueRow
                    key={item.id}
                    phrase={item}
                    index={actualIndex}
                    region={settings.region}
                    isCurrent={actualIndex === safeIndex}
                    onJump={jumpTo}
                  />
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">No phrases in this view.</p>
          )}
        </div>
      </aside>
    </div>
  );
};
