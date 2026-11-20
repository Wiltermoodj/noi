import {
  ArrowUpDown,
  BookOpen,
  Check,
  Copy,
  Info,
  Languages,
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
import type { ChangeEvent, FC, RefObject } from "react";
import { memo, useCallback, useDeferredValue, useId, useMemo, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useProgressiveRenderCount } from "../hooks/useProgressiveRenderCount";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService, type SpeakingStatus } from "../services/audioService";
import {
  buildPersonalPhrasebook,
  filterPersonalPhrasebook,
  getPhrasebookItemPhonetic,
  getPhrasebookItemText,
  PART_OF_SPEECH_LABELS,
  PHRASEBOOK_CATEGORIES,
  PHRASEBOOK_PARTS_OF_SPEECH,
  type PhrasebookTopicFilter,
  sortPersonalPhrasebook,
} from "../services/phrasebookService";
import { playVietnameseToneContour } from "../services/toneAudioService";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
  type Phrase,
  type PhrasebookItem,
  type PhrasebookKindFilter,
  type PhrasebookSortOption,
  type StarredWordRecord,
} from "../types/vietnamese";
import { AddPhraseModal } from "./AddPhraseModal";
import { AudioErrorBanner } from "./AudioErrorBanner";
import { LazyPracticePanel } from "./LazyPracticePanel";
import { PronunciationTipsCard } from "./PronunciationTipsCard";
import { RegionIcon } from "./RegionIcon";
import { SearchBar } from "./SearchBar";
import type { ShowBigPayload } from "./ShowBigModal";

interface PhrasebookViewProps {
  phrases: Phrase[];
  starredWords: StarredWordRecord[];
  settings: AppSettings;
  onChangeRegion: (region: DialectRegion) => void;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onAddPhrase: (phrase: Omit<Phrase, "id" | "sortOrder">) => void;
  onUpdateCustomPhrase: (id: string, patch: Omit<Phrase, "id" | "sortOrder">) => void;
  onDeleteCustomPhrase: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onRestorePhrasesSnapshot: (snapshot: Phrase[]) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string, onUndo?: () => void) => void;
  onBrowsePhrases: () => void;
  onBrowseTranslate: () => void;
}

const KIND_OPTIONS: { id: PhrasebookKindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "phrase", label: "Phrases" },
  { id: "word", label: "Words" },
];

const SORT_OPTIONS: { id: PhrasebookSortOption; label: string }[] = [
  { id: "starred-newest", label: "Recently Saved" },
  { id: "starred-oldest", label: "Oldest Saved" },
  { id: "vi-asc", label: "Vietnamese (A–Z)" },
  { id: "en-asc", label: "English (A–Z)" },
  { id: "category-asc", label: "Category & Type" },
];

function formatSavedDate(timestamp: number): string {
  if (timestamp <= 0) return "Saved";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function getItemTextByRegion(item: PhrasebookItem, region: DialectRegion): string {
  if (region === "north") return item.north;
  if (region === "central") return item.central;
  return item.south;
}

interface KindTabButtonProps {
  id: PhrasebookKindFilter;
  label: string;
  count: number;
  active: boolean;
  onSelect: (id: PhrasebookKindFilter) => void;
}

const KindTabButton: FC<KindTabButtonProps> = ({ id, label, count, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[34px] whitespace-nowrap rounded-lg px-3 text-xs font-medium tabular-nums transition-colors ${
        active ? "bg-surface text-ink shadow-xs" : "text-ink-secondary hover:text-ink"
      }`}
    >
      {label} ({count})
    </button>
  );
};

interface RegionalVariantDetailButtonProps {
  region: DialectRegion;
  text: string;
  active: boolean;
  onSpeak: (text: string, region: DialectRegion) => void;
}

const RegionalVariantDetailButton: FC<RegionalVariantDetailButtonProps> = ({
  region,
  text,
  active,
  onSpeak,
}) => {
  const meta = DIALECT_META[region];
  const handleClick = useCallback(() => {
    onSpeak(text, region);
  }, [onSpeak, region, text]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex min-h-[44px] items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "border-accent-border bg-surface text-ink"
          : "border-border bg-surface/80 text-ink-secondary hover:bg-surface"
      }`}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
          <RegionIcon region={region} className="h-4 w-4" />
          <span>{meta.label}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-ink">{text}</span>
      </div>
      <Volume2 className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
    </button>
  );
};

interface PhrasebookRowDetailsProps {
  item: PhrasebookItem;
  viText: string;
  settings: AppSettings;
  region: DialectRegion;
  copied: boolean;
  isBusy: boolean;
  onSpeakRegionText: (text: string, targetRegion: DialectRegion) => void;
  onCopy: () => void;
  onSpeakBoth: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenPronunciationGuide: () => void;
}

const PhrasebookRowDetails: FC<PhrasebookRowDetailsProps> = ({
  item,
  viText,
  settings,
  region,
  copied,
  isBusy,
  onSpeakRegionText,
  onCopy,
  onSpeakBoth,
  onEdit,
  onDelete,
  onOpenPronunciationGuide,
}) => (
  <div className="mt-3 space-y-3 rounded-xl bg-surface-subtle p-3.5 text-left">
    {item.hasRegionalDiff ? (
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-muted">Across Vietnam</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {DIALECT_REGIONS.map((r) => (
            <RegionalVariantDetailButton
              key={r}
              region={r}
              text={getItemTextByRegion(item, r)}
              active={region === r}
              onSpeak={onSpeakRegionText}
            />
          ))}
        </div>
      </div>
    ) : null}

    {!item.isCustom && item.textbook && item.textbook.trim().length > 0 ? (
      <div>
        <p className="text-xs font-medium text-ink-muted">Textbook says</p>
        <p className="mt-0.5 text-sm text-ink-secondary line-through decoration-ink-faint">
          {item.textbook}
        </p>
      </div>
    ) : null}

    <div>
      <p className="text-xs font-medium text-accent">
        {item.kind === "phrase" ? "Real spoken Vietnamese" : "Usage note"}
      </p>
      <p className="mt-0.5 text-sm leading-relaxed text-ink">{item.note}</p>
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

      {item.isCustom ? (
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
            aria-label={`Delete custom phrase ${item.english}`}
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

interface PhrasebookRowProps {
  item: PhrasebookItem;
  settings: AppSettings;
  isBusy: boolean;
  onChangeRegion: (region: DialectRegion) => void;
  onSpeakRegionText: (text: string, targetRegion: DialectRegion) => void;
  onUnstarItem: (item: PhrasebookItem) => void;
  onEditCustomItem: (id: string) => void;
  onDeleteCustomPhrase: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string) => void;
}

const PhrasebookRowBase: FC<PhrasebookRowProps> = ({
  item,
  settings,
  isBusy,
  onChangeRegion,
  onSpeakRegionText,
  onUnstarItem,
  onEditCustomItem,
  onDeleteCustomPhrase,
  onRecordPractice,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const { copied, copyText } = useCopyFeedback();

  const region = settings.region;
  const vi = getPhrasebookItemText(item, region);
  const phonetic = getPhrasebookItemPhonetic(item, region);

  const toggleDetails = useCallback(() => {
    setShowDetails((prev) => !prev);
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
    void audioService.speakBothWithSettings(item.english, vi, region, settings);
  }, [item.english, region, settings, vi]);

  const handleToggleStar = useCallback(() => {
    onUnstarItem(item);
  }, [item, onUnstarItem]);

  const handleEdit = useCallback(() => {
    onEditCustomItem(item.id);
  }, [item.id, onEditCustomItem]);

  const handleDelete = useCallback(() => {
    onDeleteCustomPhrase(item.id);
  }, [item.id, onDeleteCustomPhrase]);

  const handleShowBig = useCallback(() => {
    onShowBig({
      english: item.english,
      north: item.north,
      central: item.central,
      south: item.south,
      phoneticNorth: getPhrasebookItemPhonetic(item, "north"),
      phoneticCentral: getPhrasebookItemPhonetic(item, "central"),
      phoneticSouth: getPhrasebookItemPhonetic(item, "south"),
    });
  }, [item, onShowBig]);

  const handleCopy = useCallback(() => {
    copyText(vi, () => {
      onNotify("Copied Vietnamese text");
    });
  }, [copyText, onNotify, vi]);

  const handlePracticeEvaluated = useCallback(
    (accuracy: number) => {
      if (item.kind === "phrase") {
        onRecordPractice(item.id, accuracy);
      }
    },
    [item.id, item.kind, onRecordPractice],
  );

  return (
    <div className="p-4 transition-colors hover:bg-surface-subtle">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={handleSpeakVi} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
            <span className="font-medium text-ink-secondary">
              {item.kind === "phrase" ? "Phrase" : "Word"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{item.topicLabel}</span>
            {item.isCustom ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-accent">Custom</span>
              </>
            ) : null}
            {item.starredAt > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatSavedDate(item.starredAt)}</span>
              </>
            ) : null}
          </div>

          <p className="mt-1 font-display text-base font-semibold text-ink">{vi}</p>
          <p className="mt-0.5 text-xs italic text-accent">{phonetic}</p>
          <p className="mt-0.5 text-sm text-ink-secondary">{item.english}</p>
        </button>

        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            type="button"
            onClick={togglePractice}
            aria-pressed={practiceOpen}
            aria-label={`Practice pronunciation for ${item.english}`}
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
            aria-label={`Show large text for ${item.english}`}
            title="Show to Local"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleToggleStar}
            aria-pressed
            aria-label={`Remove ${item.english} from Saved`}
            title="Remove from Saved"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-star transition-colors hover:bg-star-soft hover:text-star-ink"
          >
            <Star className="h-4 w-4 fill-star-fill" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={toggleDetails}
            aria-expanded={showDetails}
            aria-label={`Notes and options for ${item.english}`}
            title="Notes & options"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              showDetails
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
          key={`${item.uid}-${region}`}
          phraseText={vi}
          region={region}
          playbackSpeed={settings.playbackSpeed}
          onChangeRegion={onChangeRegion}
          onPlayNormal={handleSpeakVi}
          onPlaySlow={handleSpeakViSlow}
          onPracticeEvaluated={handlePracticeEvaluated}
        />
      ) : null}

      {showDetails ? (
        <PhrasebookRowDetails
          item={item}
          viText={vi}
          settings={settings}
          region={region}
          copied={copied}
          isBusy={isBusy}
          onSpeakRegionText={onSpeakRegionText}
          onCopy={handleCopy}
          onSpeakBoth={handleSpeakBoth}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onOpenPronunciationGuide={onOpenPronunciationGuide}
        />
      ) : null}
    </div>
  );
};

const PhrasebookRow = memo(PhrasebookRowBase);

interface SavedItemsListProps {
  visibleItems: PhrasebookItem[];
  renderedItems: PhrasebookItem[];
  renderedItemCount: number;
  hasMoreSavedItems: boolean;
  savedSentinelRef: RefObject<HTMLDivElement | null>;
  settings: AppSettings;
  speakingState: SpeakingStatus;
  onResetFilters: () => void;
  onLoadMore: () => void;
  onChangeRegion: (region: DialectRegion) => void;
  onSpeakRegionText: (text: string, region: DialectRegion) => void;
  onUnstarItem: (item: PhrasebookItem) => void;
  onEditCustomItem: (id: string) => void;
  onDeleteCustomPhrase: (id: string) => void;
  onRecordPractice: (id: string, accuracy: number) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string, onUndo?: () => void) => void;
}

const SavedItemsList: FC<SavedItemsListProps> = ({
  visibleItems,
  renderedItems,
  renderedItemCount,
  hasMoreSavedItems,
  savedSentinelRef,
  settings,
  speakingState,
  onResetFilters,
  onLoadMore,
  onChangeRegion,
  onSpeakRegionText,
  onUnstarItem,
  onEditCustomItem,
  onDeleteCustomPhrase,
  onRecordPractice,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  if (visibleItems.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-ink">No saved items match your current filters.</p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-border px-4 text-xs font-medium text-ink-secondary hover:bg-surface-subtle"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Reset Filters</span>
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {renderedItems.map((item) => {
        const text = getPhrasebookItemText(item, settings.region);
        const isBusy =
          speakingState.activeText === text &&
          speakingState.activeRegion === settings.region &&
          (speakingState.isSpeaking || speakingState.isLoading);

        return (
          <PhrasebookRow
            key={item.uid}
            item={item}
            settings={settings}
            isBusy={isBusy}
            onChangeRegion={onChangeRegion}
            onSpeakRegionText={onSpeakRegionText}
            onUnstarItem={onUnstarItem}
            onEditCustomItem={onEditCustomItem}
            onDeleteCustomPhrase={onDeleteCustomPhrase}
            onRecordPractice={onRecordPractice}
            onShowBig={onShowBig}
            onOpenPronunciationGuide={onOpenPronunciationGuide}
            onNotify={onNotify}
          />
        );
      })}
      {hasMoreSavedItems ? (
        <div ref={savedSentinelRef} className="p-3 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border bg-surface-subtle px-4 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            Show more saved items ({String(visibleItems.length - renderedItemCount)} remaining)
          </button>
        </div>
      ) : null}
    </div>
  );
};

interface PhrasebookEmptyStateProps {
  onBrowsePhrases: () => void;
  onBrowseTranslate: () => void;
}

const PhrasebookEmptyState: FC<PhrasebookEmptyStateProps> = ({
  onBrowsePhrases,
  onBrowseTranslate,
}) => (
  <section className="rounded-2xl border border-border bg-surface p-8 text-center">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-star-soft text-star">
      <Star className="h-6 w-6 fill-star-fill" aria-hidden="true" />
    </div>
    <h2 className="mt-4 font-display text-lg font-semibold text-ink">
      No saved phrases or words yet
    </h2>
    <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-secondary">
      Tap the star on any study card, library phrase, or dictionary word to keep your go-to
      expressions together for quick offline reference.
    </p>

    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onClick={onBrowsePhrases}
        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
      >
        <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
        <span>Browse Library</span>
      </button>
      <button
        type="button"
        onClick={onBrowseTranslate}
        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl bg-surface-inverse px-4 text-sm font-medium text-ink-inverse transition-colors hover:opacity-90"
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span>Explore Vocabulary</span>
      </button>
    </div>
  </section>
);

export const PhrasebookView: FC<PhrasebookViewProps> = ({
  phrases,
  starredWords,
  settings,
  onChangeRegion,
  onTogglePhraseStar,
  onToggleWordStar,
  onAddPhrase,
  onUpdateCustomPhrase,
  onDeleteCustomPhrase,
  onRecordPractice,
  onRestorePhrasesSnapshot,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
  onBrowsePhrases,
  onBrowseTranslate,
}) => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [kindFilter, setKindFilter] = useState<PhrasebookKindFilter>("all");
  const [topicFilter, setTopicFilter] = useState<PhrasebookTopicFilter>("all");
  const [customOnly, setCustomOnly] = useState(false);
  const [regionalDiffOnly, setRegionalDiffOnly] = useState(false);
  const [sortBy, setSortBy] = useState<PhrasebookSortOption>("starred-newest");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState<Phrase | null>(null);
  const speakingState = useSpeakingStatus();

  const sortSelectId = useId();
  const topicSelectId = useId();

  const allStarredItems = useMemo(
    () => buildPersonalPhrasebook(phrases, starredWords),
    [phrases, starredWords],
  );

  const counts = useMemo(() => {
    let phraseCount = 0;
    let wordCount = 0;
    const topicCounts = new Map<string, number>();

    for (const item of allStarredItems) {
      if (item.kind === "phrase") {
        phraseCount++;
      } else {
        wordCount++;
      }
      topicCounts.set(item.topicKey, (topicCounts.get(item.topicKey) ?? 0) + 1);
    }

    return {
      total: allStarredItems.length,
      phraseCount,
      wordCount,
      topicCounts,
    };
  }, [allStarredItems]);

  const visibleItems = useMemo(() => {
    const filtered = filterPersonalPhrasebook(allStarredItems, {
      search: deferredSearch,
      kind: kindFilter,
      topic: topicFilter,
      priority: customOnly ? "custom" : "all",
      regionalDiffOnly,
    });
    return sortPersonalPhrasebook(filtered, sortBy, settings.region);
  }, [
    allStarredItems,
    customOnly,
    deferredSearch,
    kindFilter,
    regionalDiffOnly,
    settings.region,
    sortBy,
    topicFilter,
  ]);

  const {
    visibleCount: renderedItemCount,
    hasMore: hasMoreSavedItems,
    loadMore: loadMoreSavedItems,
    sentinelRef: savedSentinelRef,
  } = useProgressiveRenderCount({
    totalCount: visibleItems.length,
    initialCount: 48,
    batchSize: 48,
    resetKey: `${kindFilter}:${topicFilter}:${String(customOnly)}:${String(regionalDiffOnly)}:${sortBy}:${deferredSearch}`,
  });

  const renderedItems = useMemo(
    () => visibleItems.slice(0, renderedItemCount),
    [renderedItemCount, visibleItems],
  );

  const hasActiveFilters =
    search.trim() !== "" ||
    kindFilter !== "all" ||
    topicFilter !== "all" ||
    customOnly ||
    regionalDiffOnly;

  const handleSortChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setSortBy(e.target.value as PhrasebookSortOption);
  }, []);

  const handleTopicChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setTopicFilter(e.target.value as PhrasebookTopicFilter);
  }, []);

  const handleSelectKind = useCallback((nextKind: PhrasebookKindFilter) => {
    setKindFilter(nextKind);
    if (nextKind === "word") {
      setCustomOnly(false);
    }
  }, []);

  const toggleCustomOnly = useCallback(() => {
    setCustomOnly((prev) => !prev);
  }, []);

  const toggleRegionalDiffOnly = useCallback(() => {
    setRegionalDiffOnly((prev) => !prev);
  }, []);

  const resetFilters = useCallback(() => {
    setSearch("");
    setKindFilter("all");
    setTopicFilter("all");
    setCustomOnly(false);
    setRegionalDiffOnly(false);
  }, []);

  const openModal = useCallback(() => {
    setEditingPhrase(null);
    setShowAddModal(true);
  }, []);

  const handleEditCustomItem = useCallback(
    (id: string) => {
      const target = phrases.find((p) => p.id === id) ?? null;
      if (!target) return;
      setEditingPhrase(target);
      setShowAddModal(true);
    },
    [phrases],
  );

  const closeModal = useCallback(() => {
    setShowAddModal(false);
    setEditingPhrase(null);
  }, []);

  const handleUnstarItem = useCallback(
    (item: PhrasebookItem) => {
      if (item.kind === "phrase") {
        const snapshot = phrases;
        onTogglePhraseStar(item.id);
        onNotify("Removed from Saved", () => {
          onRestorePhrasesSnapshot(snapshot);
        });
      } else {
        onToggleWordStar(item.id);
        onNotify("Removed from Saved", () => {
          onToggleWordStar(item.id);
        });
      }
    },
    [onNotify, onRestorePhrasesSnapshot, onTogglePhraseStar, onToggleWordStar, phrases],
  );

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

  const speakRegionText = useCallback(
    (text: string, targetRegion: DialectRegion) => {
      void audioService.speakWithSettings(text, targetRegion, settings);
    },
    [settings],
  );

  const handlePlayToneFallback = useCallback(() => {
    const text = speakingState.activeText ?? "";
    if (!text) return;
    void playVietnameseToneContour(text, settings.region, settings.playbackSpeed);
  }, [settings.playbackSpeed, settings.region, speakingState.activeText]);

  const handleDismissAudioError = useCallback(() => {
    audioService.stop();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Saved Phrases &amp; Words
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
            {counts.total} saved · {counts.phraseCount} phrases · {counts.wordCount} words
          </p>
        </div>

        <button
          type="button"
          onClick={openModal}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add Custom Phrase</span>
        </button>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        disabled={allStarredItems.length === 0}
        ariaLabel="Search saved phrases and words by English, Vietnamese, phonetics, or notes"
        placeholder={
          allStarredItems.length === 0
            ? "Star phrases or words to search your saved collection..."
            : "Search saved phrases, words, phonetics, or notes..."
        }
      />

      {allStarredItems.length === 0 ? (
        <PhrasebookEmptyState
          onBrowsePhrases={onBrowsePhrases}
          onBrowseTranslate={onBrowseTranslate}
        />
      ) : (
        <>
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
                {KIND_OPTIONS.map((opt) => (
                  <KindTabButton
                    key={opt.id}
                    id={opt.id}
                    label={opt.label}
                    count={
                      opt.id === "all"
                        ? counts.total
                        : opt.id === "phrase"
                          ? counts.phraseCount
                          : counts.wordCount
                    }
                    active={kindFilter === opt.id}
                    onSelect={handleSelectKind}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 sm:shrink-0">
                <label
                  htmlFor={sortSelectId}
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sort</span>
                </label>
                <select
                  id={sortSelectId}
                  value={sortBy}
                  onChange={handleSortChange}
                  className="min-h-[40px] flex-1 rounded-xl border border-border bg-surface px-3 text-xs font-medium text-ink focus:border-accent focus:outline-none sm:w-48 sm:flex-initial"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex min-w-[180px] flex-1 items-center gap-2 sm:max-w-[230px]">
                <label htmlFor={topicSelectId} className="sr-only">
                  Filter by category or word type
                </label>
                <select
                  id={topicSelectId}
                  value={topicFilter}
                  onChange={handleTopicChange}
                  className="min-h-[40px] w-full rounded-xl border border-border bg-surface px-3 text-xs font-medium text-ink-secondary focus:border-accent focus:outline-none"
                >
                  <option value="all">All Categories &amp; Word Types</option>
                  {kindFilter !== "word" ? (
                    <optgroup label="Phrase Categories">
                      {PHRASEBOOK_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat} ({counts.topicCounts.get(cat) ?? 0})
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {kindFilter !== "phrase" ? (
                    <optgroup label="Word Types">
                      {PHRASEBOOK_PARTS_OF_SPEECH.map((pos) => (
                        <option key={pos} value={pos}>
                          {PART_OF_SPEECH_LABELS[pos]} ({counts.topicCounts.get(pos) ?? 0})
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>

              {kindFilter !== "word" ? (
                <button
                  type="button"
                  onClick={toggleCustomOnly}
                  aria-pressed={customOnly}
                  className={`min-h-[40px] whitespace-nowrap rounded-xl border px-3 text-xs font-medium transition-colors ${
                    customOnly
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                  }`}
                >
                  Custom only
                </button>
              ) : null}

              <button
                type="button"
                onClick={toggleRegionalDiffOnly}
                aria-pressed={regionalDiffOnly}
                className={`min-h-[40px] whitespace-nowrap rounded-xl border px-3 text-xs font-medium transition-colors ${
                  regionalDiffOnly
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                }`}
              >
                Varies by region
              </button>

              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-muted">
            <span className="tabular-nums">
              Showing {visibleItems.length} of {counts.total} saved · Tap to hear{" "}
              {DIALECT_META[settings.region].label} Vietnamese
            </span>
          </div>

          {speakingState.audioError ? (
            <AudioErrorBanner
              message={speakingState.audioError}
              showToneFallback={Boolean(speakingState.activeText)}
              onPlayToneFallback={handlePlayToneFallback}
              onDismiss={handleDismissAudioError}
            />
          ) : null}

          <SavedItemsList
            visibleItems={visibleItems}
            renderedItems={renderedItems}
            renderedItemCount={renderedItemCount}
            hasMoreSavedItems={hasMoreSavedItems}
            savedSentinelRef={savedSentinelRef}
            settings={settings}
            speakingState={speakingState}
            onResetFilters={resetFilters}
            onLoadMore={loadMoreSavedItems}
            onChangeRegion={onChangeRegion}
            onSpeakRegionText={speakRegionText}
            onUnstarItem={handleUnstarItem}
            onEditCustomItem={handleEditCustomItem}
            onDeleteCustomPhrase={handleDeleteWithUndo}
            onRecordPractice={onRecordPractice}
            onShowBig={onShowBig}
            onOpenPronunciationGuide={onOpenPronunciationGuide}
            onNotify={onNotify}
          />
        </>
      )}

      <AddPhraseModal
        open={showAddModal}
        defaultStarred
        initialPhrase={editingPhrase}
        settings={settings}
        onClose={closeModal}
        onAddPhrase={onAddPhrase}
        onUpdatePhrase={onUpdateCustomPhrase}
      />
    </div>
  );
};
