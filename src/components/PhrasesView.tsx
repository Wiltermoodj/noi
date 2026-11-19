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
import { useCallback, useMemo, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
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
import { PracticePanel } from "./PracticePanel";
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

const CategoryFilterButton: FC<CategoryFilterButtonProps> = ({ cat, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(cat);
  }, [cat, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${
        active
          ? "bg-stone-900 text-white"
          : "border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900"
      }`}
    >
      {cat}
    </button>
  );
};

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
  <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3.5 text-left">
    {!phrase.isCustom && phrase.textbook.trim().length > 0 ? (
      <div>
        <p className="text-xs font-medium text-stone-500">Textbook says</p>
        <p className="mt-0.5 text-sm text-stone-700 line-through decoration-stone-400">
          {phrase.textbook}
        </p>
      </div>
    ) : null}

    <div>
      <p className="text-xs font-medium text-[#0F766E]">Real spoken Vietnamese</p>
      <p className="mt-0.5 text-sm leading-relaxed text-stone-800">{phrase.streetNote}</p>
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

      {!isFiltered ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isFirst}
            onClick={onMoveUp}
            aria-label="Move phrase up"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={onMoveDown}
            aria-label="Move phrase down"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-30"
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
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete custom phrase"
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

const PhraseListRow: FC<PhraseListRowProps> = ({
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
    <div className="p-4 transition-colors hover:bg-stone-50/70">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={handleSpeakVi} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-stone-500">
            <span>{phrase.category}</span>
            {phrase.isCustom ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#0F766E]">Custom</span>
              </>
            ) : null}
            {phrase.review?.bestPracticeAccuracy !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-[#0F766E]">
                  Best {phrase.review.bestPracticeAccuracy}%
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-1 font-display text-base font-semibold text-stone-900">{vi}</p>
          <p className="mt-0.5 text-sm text-stone-600">{phrase.english}</p>
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
                ? "bg-[#0F766E]/10 text-[#0F766E]"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleShowBig}
            aria-label={`Show large text for ${phrase.english}`}
            title="Show to Local"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900"
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
                ? "text-amber-500 hover:bg-amber-50"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            }`}
          >
            <Star
              className={`h-4 w-4 ${phrase.isStarred ? "fill-amber-400" : ""}`}
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
  const [category, setCategory] = useState<"All" | PhraseCategory>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState<Phrase | null>(null);
  const speakingState = useSpeakingStatus();

  const filteredPhrases = useMemo(
    () =>
      filterPhrases(phrases, {
        search,
        category,
        priority: "all",
        starredOnly,
      }),
    [phrases, category, search, starredOnly],
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
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0F766E] px-4 text-sm font-medium text-white transition-colors hover:bg-[#0D655E]"
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
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900"
            }`}
          >
            <Star
              className={`h-3.5 w-3.5 ${starredOnly ? "fill-amber-400 text-amber-500" : "text-stone-400"}`}
              aria-hidden="true"
            />
            <span>Saved</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-stone-500">
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
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[#0F766E] transition-colors hover:bg-[#0F766E]/10"
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
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-800">
            No phrases match your current filter.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-200 px-4 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {filteredPhrases.map((phrase, idx) => {
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
