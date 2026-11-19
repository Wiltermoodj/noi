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
import type { ChangeEvent, FC } from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService } from "../services/audioService";
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
import { PracticePanel } from "./PracticePanel";
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
        active ? "bg-white text-stone-900 shadow-xs" : "text-stone-600 hover:text-stone-900"
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
          ? "border-[#0F766E]/40 bg-white text-stone-900"
          : "border-stone-200 bg-white/80 text-stone-700 hover:bg-white"
      }`}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
          <RegionIcon region={region} className="h-4 w-4" />
          <span>{meta.label}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-stone-900">{text}</span>
      </div>
      <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#0F766E]" aria-hidden="true" />
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
  <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3.5 text-left">
    {item.hasRegionalDiff ? (
      <div>
        <p className="mb-1.5 text-xs font-medium text-stone-500">Across Vietnam</p>
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
        <p className="text-xs font-medium text-stone-500">Textbook says</p>
        <p className="mt-0.5 text-sm text-stone-700 line-through decoration-stone-400">
          {item.textbook}
        </p>
      </div>
    ) : null}

    <div>
      <p className="text-xs font-medium text-[#0F766E]">
        {item.kind === "phrase" ? "Real spoken Vietnamese" : "Usage note"}
      </p>
      <p className="mt-0.5 text-sm leading-relaxed text-stone-800">{item.note}</p>
    </div>

    <PronunciationTipsCard
      phraseText={viText}
      settings={settings}
      maxTips={2}
      compact
      onOpenGuide={onOpenPronunciationGuide}
      className="border-t border-stone-200/80 pt-3"
    />

    <div className="flex flex-wrap items-center gap-2 border-t border-stone-200/80 pt-2.5">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-[#0F766E]" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>

      <button
        type="button"
        onClick={onSpeakBoth}
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          isBusy
            ? "border-[#0F766E] bg-[#0F766E] text-white"
            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
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
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete custom phrase ${item.english}`}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
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

const PhrasebookRow: FC<PhrasebookRowProps> = ({
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
    <div className="p-4 transition-colors hover:bg-stone-50/70">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={handleSpeakVi} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-stone-500">
            <span className="font-medium text-stone-700">
              {item.kind === "phrase" ? "Phrase" : "Word"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{item.topicLabel}</span>
            {item.isCustom ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#0F766E]">Custom</span>
              </>
            ) : null}
            {item.starredAt > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatSavedDate(item.starredAt)}</span>
              </>
            ) : null}
          </div>

          <p className="mt-1 font-display text-base font-semibold text-stone-900">{vi}</p>
          <p className="mt-0.5 text-xs italic text-[#0F766E]/90">{phonetic}</p>
          <p className="mt-0.5 text-sm text-stone-600">{item.english}</p>
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
                ? "bg-[#0F766E]/10 text-[#0F766E]"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleShowBig}
            aria-label={`Show large text for ${item.english}`}
            title="Show to Local"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleToggleStar}
            aria-pressed
            aria-label={`Remove ${item.english} from Saved`}
            title="Remove from Saved"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-amber-500 transition-colors hover:bg-amber-50 hover:text-amber-600"
          >
            <Star className="h-4 w-4 fill-amber-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={toggleDetails}
            aria-expanded={showDetails}
            aria-label={`Notes and options for ${item.english}`}
            title="Notes & options"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors ${
              showDetails
                ? "bg-[#0F766E]/10 text-[#0F766E]"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {practiceOpen ? (
        <PracticePanel
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

interface PhrasebookEmptyStateProps {
  onBrowsePhrases: () => void;
  onBrowseTranslate: () => void;
}

const PhrasebookEmptyState: FC<PhrasebookEmptyStateProps> = ({
  onBrowsePhrases,
  onBrowseTranslate,
}) => (
  <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
      <Star className="h-6 w-6 fill-amber-400" aria-hidden="true" />
    </div>
    <h2 className="mt-4 font-display text-lg font-semibold text-stone-900">
      No saved phrases or words yet
    </h2>
    <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-stone-600">
      Tap the star on any study card, library phrase, or dictionary word to keep your go-to
      expressions together for quick offline reference.
    </p>

    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onClick={onBrowsePhrases}
        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-50"
      >
        <BookOpen className="h-4 w-4 text-[#0F766E]" aria-hidden="true" />
        <span>Browse Library</span>
      </button>
      <button
        type="button"
        onClick={onBrowseTranslate}
        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl bg-stone-900 px-4 text-sm font-medium text-white transition-colors hover:bg-stone-800"
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
      search,
      kind: kindFilter,
      topic: topicFilter,
      priority: customOnly ? "custom" : "all",
      regionalDiffOnly,
    });
    return sortPersonalPhrasebook(filtered, sortBy, settings.region);
  }, [
    allStarredItems,
    customOnly,
    kindFilter,
    regionalDiffOnly,
    search,
    settings.region,
    sortBy,
    topicFilter,
  ]);

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
          <h1 className="font-display text-xl font-semibold tracking-tight text-stone-900">
            Saved Phrases &amp; Words
          </h1>
          <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
            {counts.total} saved · {counts.phraseCount} phrases · {counts.wordCount} words
          </p>
        </div>

        <button
          type="button"
          onClick={openModal}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0F766E] px-4 text-sm font-medium text-white transition-colors hover:bg-[#0D655E]"
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
          <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1 rounded-xl bg-stone-100 p-1">
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
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-stone-500"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sort</span>
                </label>
                <select
                  id={sortSelectId}
                  value={sortBy}
                  onChange={handleSortChange}
                  className="min-h-[40px] flex-1 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-stone-800 focus:border-[#0F766E] focus:outline-none sm:w-48 sm:flex-initial"
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
                  className="min-h-[40px] w-full rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 focus:border-[#0F766E] focus:outline-none"
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
                      ? "border-[#0F766E] bg-[#0F766E]/10 text-[#0F766E]"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900"
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
                    ? "border-[#0F766E] bg-[#0F766E]/10 text-[#0F766E]"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                Varies by region
              </button>

              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-stone-500">
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

          {visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
              <p className="text-sm font-medium text-stone-800">
                No saved items match your current filters.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-200 px-4 text-xs font-medium text-stone-700 hover:bg-stone-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reset Filters</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {visibleItems.map((item) => {
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
                    onSpeakRegionText={speakRegionText}
                    onUnstarItem={handleUnstarItem}
                    onEditCustomItem={handleEditCustomItem}
                    onDeleteCustomPhrase={handleDeleteWithUndo}
                    onRecordPractice={onRecordPractice}
                    onShowBig={onShowBig}
                    onOpenPronunciationGuide={onOpenPronunciationGuide}
                    onNotify={onNotify}
                  />
                );
              })}
            </div>
          )}
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
