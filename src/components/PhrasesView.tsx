import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Info,
  Loader2,
  Maximize2,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Volume2,
} from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useProgressiveRenderCount } from "../hooks/useProgressiveRenderCount";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService } from "../services/audioService";
import { filterPhrases } from "../services/phrasebookService";
import { getPhraseText } from "../services/storageService";
import { playVietnameseToneContour } from "../services/toneAudioService";
import {
  type AppSettings,
  DIALECT_META,
  type DialectRegion,
  PHRASE_CATEGORIES,
  type Phrase,
  type PhraseCategory,
} from "../types/vietnamese";
import { AddPhraseModal } from "./AddPhraseModal";
import { AudioErrorBanner } from "./AudioErrorBanner";
import { LazyPracticePanel } from "./LazyPracticePanel";
import { PronunciationTipsCard } from "./PronunciationTipsCard";
import { SearchBar } from "./SearchBar";
import type { ShowBigPayload } from "./ShowBigModal";

interface PhrasesViewProps {
  phrases: Phrase[];
  settings: AppSettings;
  onChangeRegion: (region: DialectRegion) => void;
  onTogglePhraseStar: (id: string) => void;
  onMovePhrase: (id: string, direction: "up" | "down") => void;
  onAddPhrase: (phrase: Omit<Phrase, "id" | "sortOrder">) => void;
  onUpdateCustomPhrase: (id: string, patch: Omit<Phrase, "id" | "sortOrder">) => void;
  onDeleteCustomPhrase: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onRestorePhrasesSnapshot: (snapshot: Phrase[]) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string, onUndo?: () => void) => void;
}

const CATEGORIES: readonly ("All" | PhraseCategory)[] = ["All", ...PHRASE_CATEGORIES];

interface CategoryFilterButtonProps {
  cat: "All" | PhraseCategory;
  active: boolean;
  onSelect: (cat: "All" | PhraseCategory) => void;
}

const CategoryFilterButtonBase: FC<CategoryFilterButtonProps> = ({ cat, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(cat);
  }, [cat, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${
        active
          ? "bg-surface-inverse text-ink-inverse"
          : "border border-border bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {cat}
    </button>
  );
};

const CategoryFilterButton = memo(CategoryFilterButtonBase);

interface PhraseRowDetailsProps {
  phrase: Phrase;
  viText: string;
  settings: AppSettings;
  copied: boolean;
  isBusy: boolean;
  isFirst: boolean;
  isLast: boolean;
  isFiltered: boolean;
  onCopy: () => void;
  onSpeakBoth: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenPronunciationGuide: () => void;
}

const PhraseRowDetails: FC<PhraseRowDetailsProps> = ({
  phrase,
  viText,
  settings,
  copied,
  isBusy,
  isFirst,
  isLast,
  isFiltered,
  onCopy,
  onSpeakBoth,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  onOpenPronunciationGuide,
}) => (
  <div className="mt-3 space-y-3 rounded-xl bg-surface-subtle p-3.5 text-left">
    {!phrase.isCustom && phrase.textbook.trim().length > 0 ? (
      <div>
        <p className="text-xs font-medium text-ink-muted">Textbook says</p>
        <p className="mt-0.5 text-sm text-ink-secondary line-through decoration-ink-faint">
          {phrase.textbook}
        </p>
      </div>
    ) : null}

    <div>
      <p className="text-xs font-medium text-accent">Real spoken Vietnamese</p>
      <p className="mt-0.5 text-sm leading-relaxed text-ink">{phrase.streetNote}</p>
    </div>

    <PronunciationTipsCard
      phraseText={viText}
      settings={settings}
      maxTips={2}
      compact
      onOpenGuide={onOpenPronunciationGuide}
      className="border-t border-border pt-3"
    />

    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>

      <button
        type="button"
        onClick={onSpeakBoth}
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          isBusy
            ? "border-accent bg-accent text-accent-fg"
            : "border-border bg-surface text-ink-secondary hover:bg-surface-muted"
        }`}
      >
        {isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>EN → VI</span>
      </button>

      {!isFiltered ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isFirst}
            onClick={onMoveUp}
            aria-label="Move phrase up"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-border bg-surface text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={onMoveDown}
            aria-label="Move phrase down"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-border bg-surface text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {phrase.isCustom ? (
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete custom phrase"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-danger-border bg-surface px-2.5 text-xs font-medium text-danger-ink transition-colors hover:bg-danger-soft"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </div>
  </div>
);

interface PhraseListRowProps {
  phrase: Phrase;
  settings: AppSettings;
  isBusy: boolean;
  isFirst: boolean;
  isLast: boolean;
  isFiltered: boolean;
  onChangeRegion: (region: DialectRegion) => void;
  onTogglePhraseStar: (id: string) => void;
  onMovePhrase: (id: string, direction: "up" | "down") => void;
  onEditCustomPhrase: (phrase: Phrase) => void;
  onDeleteCustomPhrase: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string) => void;
}

const PhraseListRowBase: FC<PhraseListRowProps> = ({
  phrase,
  settings,
  isBusy,
  isFirst,
  isLast,
  isFiltered,
  onChangeRegion,
  onTogglePhraseStar,
  onMovePhrase,
  onEditCustomPhrase,
  onDeleteCustomPhrase,
  onRecordPractice,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  const [showStreetNote, setShowStreetNote] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const { copied, copyText } = useCopyFeedback();

  const region = settings.region;
  const vi = getPhraseText(phrase, region);

  const toggleStreetNote = useCallback(() => {
    setShowStreetNote((prev) => !prev);
  }, []);

  const togglePractice = useCallback(() => {
    setPracticeOpen((prev) => !prev);
  }, []);

  const handleSpeakVi = useCallback(() => {
    void audioService.speakWithSettings(vi, region, settings);
  }, [region, settings, vi]);

  const handleSpeakViSlow = useCallback(() => {
    void audioService.speakSlowWithSettings(vi, region, settings);
  }, [region, settings, vi]);

  const handleSpeakBoth = useCallback(() => {
    void audioService.speakBothWithSettings(phrase.english, vi, region, settings);
  }, [phrase.english, region, settings, vi]);

  const handleToggleStar = useCallback(() => {
    onTogglePhraseStar(phrase.id);
  }, [onTogglePhraseStar, phrase.id]);

  const handleMoveUp = useCallback(() => {
    onMovePhrase(phrase.id, "up");
  }, [onMovePhrase, phrase.id]);

  const handleMoveDown = useCallback(() => {
    onMovePhrase(phrase.id, "down");
  }, [onMovePhrase, phrase.id]);

  const handleEdit = useCallback(() => {
    onEditCustomPhrase(phrase);
  }, [onEditCustomPhrase, phrase]);

  const handleDelete = useCallback(() => {
    onDeleteCustomPhrase(phrase.id);
  }, [onDeleteCustomPhrase, phrase.id]);

  const handleShowBig = useCallback(() => {
    onShowBig({
      english: phrase.english,
      north: phrase.north,
      central: phrase.central,
      south: phrase.south,
      phoneticNorth: phrase.phoneticNorth,
      phoneticCentral: phrase.phoneticCentral,
      phoneticSouth: phrase.phoneticSouth,
    });
  }, [onShowBig, phrase]);

  const handleCopy = useCallback(() => {
    copyText(vi, () => {
      onNotify("Copied Vietnamese phrase");
    });
  }, [copyText, onNotify, vi]);

  const handlePracticeEvaluated = useCallback(
    (accuracy: number) => {
      onRecordPractice(phrase.id, accuracy);
    },
    [onRecordPractice, phrase.id],
  );

  return (
    <div className="p-4 transition-colors hover:bg-surface-subtle">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={handleSpeakVi} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
            <span>{phrase.category}</span>
            {phrase.isCustom ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-accent">Custom</span>
              </>
            ) : null}
            {phrase.review?.bestPracticeAccuracy !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-accent">
                  Best {phrase.review.bestPracticeAccuracy}%
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-1 font-display text-base font-semibold text-ink">{vi}</p>
          <p className="mt-0.5 text-sm text-ink-secondary">{phrase.english}</p>
        </button>

        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            type="button"
            onClick={togglePractice}
            aria-pressed={practiceOpen}
            aria-label={`Practice pronunciation for ${phrase.english}`}
            title="Practice"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              practiceOpen
                ? "bg-accent-soft text-accent"
                : "text-ink-faint hover:bg-surface-muted hover:text-ink"
            }`}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleShowBig}
            aria-label={`Show large text for ${phrase.english}`}
            title="Show to Local"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleToggleStar}
            aria-pressed={Boolean(phrase.isStarred)}
            aria-label={
              phrase.isStarred ? `Remove ${phrase.english} from Saved` : `Save ${phrase.english}`
            }
            title={phrase.isStarred ? "Saved" : "Save"}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              phrase.isStarred
                ? "text-star hover:bg-star-soft"
                : "text-ink-faint hover:bg-surface-muted hover:text-ink-secondary"
            }`}
          >
            <Star
              className={`h-4 w-4 ${phrase.isStarred ? "fill-star-fill" : ""}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={toggleStreetNote}
            aria-expanded={showStreetNote}
            aria-label={`Details and options for ${phrase.english}`}
            title="Notes & options"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              showStreetNote
                ? "bg-accent-soft text-accent"
                : "text-ink-faint hover:bg-surface-muted hover:text-ink"
            }`}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {practiceOpen ? (
        <LazyPracticePanel
          key={`${phrase.id}-${region}`}
          phraseText={vi}
          region={region}
          playbackSpeed={settings.playbackSpeed}
          bestAccuracy={phrase.review?.bestPracticeAccuracy}
          onChangeRegion={onChangeRegion}
          onPlayNormal={handleSpeakVi}
          onPlaySlow={handleSpeakViSlow}
          onPracticeEvaluated={handlePracticeEvaluated}
        />
      ) : null}

      {showStreetNote ? (
        <PhraseRowDetails
          phrase={phrase}
          viText={vi}
          settings={settings}
          copied={copied}
          isBusy={isBusy}
          isFirst={isFirst}
          isLast={isLast}
          isFiltered={isFiltered}
          onCopy={handleCopy}
          onSpeakBoth={handleSpeakBoth}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onOpenPronunciationGuide={onOpenPronunciationGuide}
        />
      ) : null}
    </div>
  );
};

const PhraseListRow = memo(PhraseListRowBase);

export const PhrasesView: FC<PhrasesViewProps> = ({
  phrases,
  settings,
  onChangeRegion,
  onTogglePhraseStar,
  onMovePhrase,
  onAddPhrase,
  onUpdateCustomPhrase,
  onDeleteCustomPhrase,
  onRecordPractice,
  onRestorePhrasesSnapshot,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState<"All" | PhraseCategory>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState<Phrase | null>(null);
  const speakingState = useSpeakingStatus();

  const filteredPhrases = useMemo(
    () =>
      filterPhrases(phrases, {
        search: deferredSearch,
        category,
        priority: "all",
        starredOnly,
      }),
    [phrases, category, deferredSearch, starredOnly],
  );

  const {
    visibleCount: visiblePhraseCount,
    hasMore: hasMorePhrases,
    loadMore: loadMorePhrases,
    sentinelRef: phrasesSentinelRef,
  } = useProgressiveRenderCount({
    totalCount: filteredPhrases.length,
    initialCount: 48,
    batchSize: 48,
    resetKey: `${category}:${String(starredOnly)}:${deferredSearch}`,
  });

  const renderedPhrases = useMemo(
    () => filteredPhrases.slice(0, visiblePhraseCount),
    [filteredPhrases, visiblePhraseCount],
  );

  const toggleStarredOnly = useCallback(() => {
    setStarredOnly((prev) => !prev);
  }, []);

  const resetFilters = useCallback(() => {
    setSearch("");
    setCategory("All");
    setStarredOnly(false);
  }, []);

  const openModal = useCallback(() => {
    setEditingPhrase(null);
    setShowAddModal(true);
  }, []);

  const handleEditCustomPhrase = useCallback((phrase: Phrase) => {
    setEditingPhrase(phrase);
    setShowAddModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowAddModal(false);
    setEditingPhrase(null);
  }, []);

  const handleDeleteWithUndo = useCallback(
    (id: string) => {
      const snapshot = phrases;
      onDeleteCustomPhrase(id);
      onNotify("Custom phrase removed", () => {
        onRestorePhrasesSnapshot(snapshot);
      });
    },
    [onDeleteCustomPhrase, onNotify, onRestorePhrasesSnapshot, phrases],
  );

  const handlePlayToneFallback = useCallback(() => {
    const text = speakingState.activeText ?? "";
    if (!text) return;
    void playVietnameseToneContour(text, settings.region, settings.playbackSpeed);
  }, [settings.playbackSpeed, settings.region, speakingState.activeText]);

  const handleDismissAudioError = useCallback(() => {
    audioService.stop();
  }, []);

  const isFiltered = search.trim() !== "" || category !== "All" || starredOnly;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          ariaLabel="Search phrases by English, Vietnamese, phonetics, or notes"
          placeholder="Search English, Vietnamese, phonetics, or notes..."
          className="flex-1"
        />

        <button
          type="button"
          onClick={openModal}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add Phrase</span>
        </button>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => (
            <CategoryFilterButton
              key={cat}
              cat={cat}
              active={category === cat}
              onSelect={setCategory}
            />
          ))}
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={toggleStarredOnly}
            aria-pressed={starredOnly}
            className={`inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
              starredOnly
                ? "border-star-border bg-star-soft text-star-ink"
                : "border-border bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
            }`}
          >
            <Star
              className={`h-3.5 w-3.5 ${starredOnly ? "fill-star-fill text-star" : "text-ink-faint"}`}
              aria-hidden="true"
            />
            <span>Saved</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-muted">
        <span className="tabular-nums">
          {isFiltered ? (
            <>
              Showing {filteredPhrases.length} of {phrases.length} phrases
            </>
          ) : (
            <>{phrases.length} phrases</>
          )}
          {" · "}Tap a phrase for {DIALECT_META[settings.region].label} audio
        </span>
        {isFiltered ? (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Reset filters</span>
          </button>
        ) : null}
      </div>

      {speakingState.audioError ? (
        <AudioErrorBanner
          message={speakingState.audioError}
          showToneFallback={Boolean(speakingState.activeText)}
          onPlayToneFallback={handlePlayToneFallback}
          onDismiss={handleDismissAudioError}
        />
      ) : null}

      {filteredPhrases.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">No phrases match your current filter.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-border px-4 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-subtle"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {renderedPhrases.map((phrase, idx) => {
            const phraseText = getPhraseText(phrase, settings.region);
            const isBusy =
              speakingState.activeText === phraseText &&
              speakingState.activeRegion === settings.region &&
              (speakingState.isSpeaking || speakingState.isLoading);

            return (
              <PhraseListRow
                key={phrase.id}
                phrase={phrase}
                settings={settings}
                isBusy={isBusy}
                isFirst={idx === 0}
                isLast={idx === filteredPhrases.length - 1}
                isFiltered={isFiltered}
                onChangeRegion={onChangeRegion}
                onTogglePhraseStar={onTogglePhraseStar}
                onMovePhrase={onMovePhrase}
                onEditCustomPhrase={handleEditCustomPhrase}
                onDeleteCustomPhrase={handleDeleteWithUndo}
                onRecordPractice={onRecordPractice}
                onShowBig={onShowBig}
                onOpenPronunciationGuide={onOpenPronunciationGuide}
                onNotify={onNotify}
              />
            );
          })}
          {hasMorePhrases ? (
            <div ref={phrasesSentinelRef} className="p-3 text-center">
              <button
                type="button"
                onClick={loadMorePhrases}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border bg-surface-subtle px-4 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
              >
                Show more phrases ({String(filteredPhrases.length - visiblePhraseCount)} remaining)
              </button>
            </div>
          ) : null}
        </div>
      )}

      <AddPhraseModal
        open={showAddModal}
        initialPhrase={editingPhrase}
        settings={settings}
        onClose={closeModal}
        onAddPhrase={onAddPhrase}
        onUpdatePhrase={onUpdateCustomPhrase}
      />
    </div>
  );
};
