import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Maximize2,
  Mic,
  Search,
  Star,
  Volume2,
  X,
} from "lucide-react";
import type { ChangeEvent, FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DICTIONARY_ENTRIES } from "../data/dictionary";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService, type SpeakingStatus } from "../services/audioService";
import { getPhrasePhonetic, getPhraseText } from "../services/storageService";
import {
  approximateVietnamesePhonetic,
  playVietnameseToneContour,
} from "../services/toneAudioService";
import {
  buildGoogleTranslateUrl,
  buildPhraseFromTranslation,
  detectDirection,
  filterDictionaryEntries,
  getDictionaryEntryText,
  normalizeText,
  translateOffline,
} from "../services/translationService";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
  type DictEntry,
  type Phrase,
  type TranslationBreakdown,
  type TranslationResult,
} from "../types/vietnamese";
import { AudioErrorBanner } from "./AudioErrorBanner";
import { PracticePanel } from "./PracticePanel";
import { PronunciationTipsCard } from "./PronunciationTipsCard";
import type { ShowBigPayload } from "./ShowBigModal";

interface TranslateViewProps {
  phrases: Phrase[];
  starredWordIds: Set<string>;
  settings: AppSettings;
  prefillRequest?: { query: string; nonce: number } | undefined;
  onChangeRegion: (region: DialectRegion) => void;
  onSavePhrase: (phrase: Omit<Phrase, "id" | "sortOrder">) => void;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenPronunciationGuide: () => void;
  onNotify: (message: string, onUndo?: () => void) => void;
}

const QUICK_PROMPTS_EN = ["iced milk coffee", "how much", "50k", "100k", "turn left", "not spicy"];

const QUICK_PROMPTS_VI = ["tính tiền", "mắc quá", "năm chục ngàn", "quẹo trái", "nâu đá", "ở mô"];

type DictPosFilter = "all" | DictEntry["partOfSpeech"];

const DICT_POS_FILTERS: { id: DictPosFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "phrase", label: "Phrases" },
  { id: "noun", label: "Nouns" },
  { id: "verb", label: "Verbs" },
  { id: "adj", label: "Adj" },
  { id: "pronoun", label: "Pronouns" },
  { id: "number", label: "Numbers" },
  { id: "particle", label: "Particles" },
];

interface PosFilterButtonProps {
  option: { id: DictPosFilter; label: string };
  active: boolean;
  onSelect: (id: DictPosFilter) => void;
}

const PosFilterButton: FC<PosFilterButtonProps> = ({ option, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[30px] whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active
          ? "bg-stone-900 text-white"
          : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
      }`}
    >
      {option.label}
    </button>
  );
};

interface SampleChipProps {
  sample: string;
  onSelect: (sample: string) => void;
}

const SampleChip: FC<SampleChipProps> = ({ sample, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(sample);
  }, [onSelect, sample]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="min-h-[32px] rounded-lg bg-stone-100 px-2.5 text-xs text-stone-700 transition-colors hover:bg-stone-200"
    >
      {sample}
    </button>
  );
};

interface RegionalVariantButtonProps {
  region: DialectRegion;
  text: string;
  active: boolean;
  isBusy: boolean;
  onSpeak: (text: string, region: DialectRegion) => void;
}

const RegionalVariantButton: FC<RegionalVariantButtonProps> = ({
  region,
  text,
  active,
  isBusy,
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
      aria-label={`Listen to ${meta.fullRegionLabel} pronunciation: ${text}`}
      className={`flex min-h-[54px] items-start justify-between gap-2 rounded-xl border p-2.5 text-left transition-colors ${
        isBusy
          ? "border-[#0F766E] bg-[#0F766E]/10"
          : active
            ? "border-[#0F766E]/40 bg-[#0F766E]/5"
            : "border-stone-200 hover:bg-stone-50"
      }`}
    >
      <div className="min-w-0">
        <span className="block text-xs font-medium text-stone-500">
          {meta.label} · {meta.cities}
        </span>
        <span className="mt-0.5 block text-sm font-medium text-stone-900">{text}</span>
      </div>
      {isBusy ? (
        <Loader2
          className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#0F766E]"
          aria-hidden="true"
        />
      ) : (
        <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0F766E]" aria-hidden="true" />
      )}
    </button>
  );
};

interface RelatedPhraseRowProps {
  phrase: Phrase;
  region: DialectRegion;
  onSpeak: (text: string, region: DialectRegion) => void;
  onTogglePhraseStar: (id: string) => void;
}

const RelatedPhraseRow: FC<RelatedPhraseRowProps> = ({
  phrase,
  region,
  onSpeak,
  onTogglePhraseStar,
}) => {
  const vi = getPhraseText(phrase, region);
  const handleClick = useCallback(() => {
    onSpeak(vi, region);
  }, [onSpeak, region, vi]);

  const handleStar = useCallback(() => {
    onTogglePhraseStar(phrase.id);
  }, [onTogglePhraseStar, phrase.id]);

  return (
    <div className="flex items-center justify-between gap-2 py-2.5">
      <button
        type="button"
        onClick={handleClick}
        className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-3 text-left hover:text-[#0F766E]"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-900">{vi}</p>
          <p className="text-xs text-stone-500">{phrase.english}</p>
        </div>
        <Volume2 className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={handleStar}
        aria-pressed={Boolean(phrase.isStarred)}
        aria-label={
          phrase.isStarred ? `Remove ${phrase.english} from Saved` : `Save ${phrase.english}`
        }
        className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl transition-colors ${
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
    </div>
  );
};

interface BreakdownRowProps {
  item: TranslationBreakdown;
  starred: boolean;
  onToggleWordStar: (entryId: string) => void;
}

const BreakdownRow: FC<BreakdownRowProps> = ({ item, starred, onToggleWordStar }) => {
  const handleToggle = useCallback(() => {
    onToggleWordStar(item.entry.id);
  }, [item.entry.id, onToggleWordStar]);

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-stone-600">{item.sourceToken}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-stone-900">{item.targetText}</span>
        <button
          type="button"
          onClick={handleToggle}
          aria-pressed={starred}
          aria-label={starred ? `Remove ${item.entry.en} from Saved` : `Save ${item.entry.en}`}
          className={`flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg transition-colors ${
            starred
              ? "text-amber-500 hover:bg-amber-50"
              : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-400" : ""}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

interface DictionaryRowProps {
  entry: DictEntry;
  region: DialectRegion;
  isBusy: boolean;
  starred: boolean;
  onInspect: (entry: DictEntry) => void;
  onSpeak: (entry: DictEntry) => void;
  onToggleStar: (entryId: string) => void;
}

const DictionaryRow: FC<DictionaryRowProps> = ({
  entry,
  region,
  isBusy,
  starred,
  onInspect,
  onSpeak,
  onToggleStar,
}) => {
  const displayVi = getDictionaryEntryText(entry, region);
  const handleInspect = useCallback(() => {
    onInspect(entry);
  }, [entry, onInspect]);

  const handleSpeak = useCallback(() => {
    onSpeak(entry);
  }, [entry, onSpeak]);

  const handleToggleStar = useCallback(() => {
    onToggleStar(entry.id);
  }, [entry.id, onToggleStar]);

  return (
    <div className="flex items-start justify-between gap-2 py-3 first:pt-1">
      <button
        type="button"
        onClick={handleInspect}
        title={`Load "${entry.en}" into translator`}
        className="group min-w-0 flex-1 text-left"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-stone-900 transition-colors group-hover:text-[#0F766E]">
            {displayVi}
          </span>
          <span className="text-xs text-stone-500">· {entry.en}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{entry.note}</p>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleToggleStar}
          aria-pressed={starred}
          aria-label={starred ? `Remove ${entry.en} from Saved` : `Save ${entry.en}`}
          title={starred ? "Saved" : "Save"}
          className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg transition-colors ${
            starred
              ? "text-amber-500 hover:bg-amber-50"
              : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          }`}
        >
          <Star className={`h-4 w-4 ${starred ? "fill-amber-400" : ""}`} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label={`Listen to ${entry.en}`}
          onClick={handleSpeak}
          className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg transition-colors ${
            isBusy
              ? "bg-[#0F766E] text-white"
              : "text-stone-400 hover:bg-stone-100 hover:text-[#0F766E]"
          }`}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};

interface RegionalVariantsSectionProps {
  variants: { north: string; central: string; south: string };
  activeRegion: DialectRegion;
  speakingState: SpeakingStatus;
  onSpeakVietnamese: (text: string, region: DialectRegion) => void;
}

const RegionalVariantsSection: FC<RegionalVariantsSectionProps> = ({
  variants,
  activeRegion,
  speakingState,
  onSpeakVietnamese,
}) => (
  <div className="mt-4 border-t border-stone-100 pt-4">
    <p className="mb-2 text-xs font-medium text-stone-500">
      Tap a region to hear its pronunciation
    </p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {DIALECT_REGIONS.map((region) => (
        <RegionalVariantButton
          key={region}
          region={region}
          text={variants[region]}
          active={activeRegion === region}
          isBusy={
            speakingState.activeRegion === region &&
            (speakingState.isSpeaking || speakingState.isLoading)
          }
          onSpeak={onSpeakVietnamese}
        />
      ))}
    </div>
  </div>
);

interface TranslationCardFooterProps {
  hasPrimaryTranslation: boolean;
  canPractice: boolean;
  practiceOpen: boolean;
  isResultStarred: boolean;
  alreadyInLibrary: boolean;
  isOnline: boolean;
  googleTranslateHref: string;
  onTogglePractice: () => void;
  onSaveAndStarResult: () => void;
}

const TranslationCardFooter: FC<TranslationCardFooterProps> = ({
  hasPrimaryTranslation,
  canPractice,
  practiceOpen,
  isResultStarred,
  alreadyInLibrary,
  isOnline,
  googleTranslateHref,
  onTogglePractice,
  onSaveAndStarResult,
}) => (
  <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-stone-100 pt-4">
    {hasPrimaryTranslation ? (
      <div className="flex flex-wrap items-center gap-2">
        {canPractice ? (
          <button
            type="button"
            onClick={onTogglePractice}
            aria-pressed={practiceOpen}
            className={`inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-xs font-medium transition-colors ${
              practiceOpen
                ? "border-[#0F766E] bg-[#0F766E]/10 text-[#0F766E]"
                : "border-stone-200 text-stone-800 hover:bg-stone-50"
            }`}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Practice</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSaveAndStarResult}
          aria-pressed={isResultStarred}
          className={`inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-xs font-medium transition-colors ${
            isResultStarred
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-stone-200 text-stone-800 hover:bg-stone-50"
          }`}
        >
          <Star
            className={`h-3.5 w-3.5 ${
              isResultStarred ? "fill-amber-400 text-amber-500" : "text-stone-400"
            }`}
            aria-hidden="true"
          />
          <span>{isResultStarred ? "Saved" : alreadyInLibrary ? "Star to Saved" : "Save"}</span>
        </button>
      </div>
    ) : (
      <span className="text-xs text-stone-500">
        Browse the offline vocabulary panel on the right for single words.
      </span>
    )}

    {isOnline ? (
      <a
        href={googleTranslateHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-stone-200 px-3.5 text-xs font-medium text-stone-800 transition-colors hover:bg-stone-50"
      >
        <span>Google Translate</span>
        <ExternalLink className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
      </a>
    ) : (
      <span className="text-xs font-medium text-[#0F766E]">100% Offline Dictionary</span>
    )}
  </div>
);

interface TranslationPrimaryOutputProps {
  result: TranslationResult;
  direction: "en-vi" | "vi-en";
  targetLabel: string;
  settings: AppSettings;
  copied: boolean;
  speakingState: SpeakingStatus;
  starredWordIds: Set<string>;
  onCopyOutput: () => void;
  onShowBigOutput: () => void;
  onSpeakOutput: () => void;
  onSpeakVietnamese: (text: string, region: DialectRegion) => void;
  onPlayToneFallback: () => void;
  onDismissAudioError: () => void;
  onToggleWordStar: (entryId: string) => void;
  onOpenPronunciationGuide: () => void;
}

const TranslationPrimaryOutput: FC<TranslationPrimaryOutputProps> = ({
  result,
  direction,
  targetLabel,
  settings,
  copied,
  speakingState,
  starredWordIds,
  onCopyOutput,
  onShowBigOutput,
  onSpeakOutput,
  onSpeakVietnamese,
  onPlayToneFallback,
  onDismissAudioError,
  onToggleWordStar,
  onOpenPronunciationGuide,
}) => {
  const activeRegion = settings.region;
  const variants = result.regionalVariants;
  const viTextForTips =
    direction === "en-vi"
      ? result.primaryTranslation
      : (variants?.[activeRegion] ?? result.query.trim());
  const isOutputLoading =
    speakingState.isLoading && speakingState.activeText === result.primaryTranslation;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-500">
            Offline Spoken {targetLabel}
            {direction === "en-vi" ? ` · ${DIALECT_META[activeRegion].label}` : ""}
          </p>
          <p className="mt-1.5 font-display text-2xl font-semibold text-stone-900">
            {result.primaryTranslation}
          </p>
          {result.phonetic ? (
            <p className="mt-1 text-sm italic text-[#0F766E]">{result.phonetic}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Copy ${targetLabel} translation`}
            title="Copy translation"
            onClick={onCopyOutput}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
          >
            {copied ? (
              <Check className="h-4 w-4 text-[#0F766E]" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            aria-label="Show large Vietnamese text to local"
            title="Show to Local"
            onClick={onShowBigOutput}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label={`Listen to ${targetLabel} translation`}
            onClick={onSpeakOutput}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#0F766E] text-white transition-colors hover:bg-[#0D655E]"
          >
            {isOutputLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Volume2 className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {result.unmatchedTokens.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            Untranslated offline words: <strong>{result.unmatchedTokens.join(", ")}</strong>. Try
            simpler keywords or browse the offline vocabulary panel.
          </span>
        </div>
      ) : null}

      {variants ? (
        <RegionalVariantsSection
          variants={variants}
          activeRegion={activeRegion}
          speakingState={speakingState}
          onSpeakVietnamese={onSpeakVietnamese}
        />
      ) : null}

      {speakingState.audioError ? (
        <AudioErrorBanner
          message={speakingState.audioError}
          onPlayToneFallback={onPlayToneFallback}
          onDismiss={onDismissAudioError}
          className="mt-3"
        />
      ) : null}

      {result.wordBreakdown.length > 1 ? (
        <div className="mt-4 border-t border-stone-100 pt-4">
          <p className="text-xs font-medium text-stone-500">Word-by-word breakdown</p>
          <div className="mt-2 space-y-1">
            {result.wordBreakdown.map((item) => (
              <BreakdownRow
                key={`${item.entry.id}-${String(item.startIndex)}`}
                item={item}
                starred={starredWordIds.has(item.entry.id)}
                onToggleWordStar={onToggleWordStar}
              />
            ))}
          </div>
        </div>
      ) : null}

      {result.streetNote ? (
        <p className="mt-4 border-t border-stone-100 pt-3 text-xs leading-relaxed text-stone-600">
          {result.streetNote}
        </p>
      ) : null}

      {viTextForTips ? (
        <PronunciationTipsCard
          phraseText={viTextForTips}
          settings={settings}
          maxTips={2}
          compact
          onOpenGuide={onOpenPronunciationGuide}
          className="mt-4 border-t border-stone-100 pt-4"
        />
      ) : null}
    </>
  );
};

interface TranslationResultCardProps {
  result: TranslationResult;
  direction: "en-vi" | "vi-en";
  targetLabel: string;
  settings: AppSettings;
  copied: boolean;
  speakingState: SpeakingStatus;
  isOnline: boolean;
  googleTranslateHref: string;
  alreadyInLibrary: boolean;
  isResultStarred: boolean;
  starredWordIds: Set<string>;
  onChangeRegion: (region: DialectRegion) => void;
  onCopyOutput: () => void;
  onShowBigOutput: () => void;
  onSpeakOutput: () => void;
  onSpeakSlowOutput: () => void;
  onSpeakVietnamese: (text: string, region: DialectRegion) => void;
  onPlayToneFallback: () => void;
  onDismissAudioError: () => void;
  onSaveAndStarResult: () => void;
  onToggleWordStar: (entryId: string) => void;
  onOpenPronunciationGuide: () => void;
}

const TranslationResultCard: FC<TranslationResultCardProps> = ({
  result,
  direction,
  targetLabel,
  settings,
  copied,
  speakingState,
  isOnline,
  googleTranslateHref,
  alreadyInLibrary,
  isResultStarred,
  starredWordIds,
  onChangeRegion,
  onCopyOutput,
  onShowBigOutput,
  onSpeakOutput,
  onSpeakSlowOutput,
  onSpeakVietnamese,
  onPlayToneFallback,
  onDismissAudioError,
  onSaveAndStarResult,
  onToggleWordStar,
  onOpenPronunciationGuide,
}) => {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const canPractice = direction === "en-vi" && Boolean(result.primaryTranslation);
  const activeRegion = settings.region;

  const togglePractice = useCallback(() => {
    setPracticeOpen((prev) => !prev);
  }, []);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      {result.primaryTranslation ? (
        <TranslationPrimaryOutput
          result={result}
          direction={direction}
          targetLabel={targetLabel}
          settings={settings}
          copied={copied}
          speakingState={speakingState}
          starredWordIds={starredWordIds}
          onCopyOutput={onCopyOutput}
          onShowBigOutput={onShowBigOutput}
          onSpeakOutput={onSpeakOutput}
          onSpeakVietnamese={onSpeakVietnamese}
          onPlayToneFallback={onPlayToneFallback}
          onDismissAudioError={onDismissAudioError}
          onToggleWordStar={onToggleWordStar}
          onOpenPronunciationGuide={onOpenPronunciationGuide}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-800">
            No exact match in the built-in offline vocabulary yet.
          </p>
          <p className="text-xs leading-relaxed text-stone-500">
            Try shorter everyday words (e.g. &ldquo;coffee&rdquo;, &ldquo;50k&rdquo;, &ldquo;turn
            left&rdquo;, &ldquo;pharmacy&rdquo;) or filter the offline vocabulary list on the right.
          </p>
        </div>
      )}

      {canPractice && practiceOpen ? (
        <PracticePanel
          key={`${result.primaryTranslation}-${activeRegion}`}
          phraseText={result.primaryTranslation}
          region={activeRegion}
          playbackSpeed={settings.playbackSpeed}
          onChangeRegion={onChangeRegion}
          onPlayNormal={onSpeakOutput}
          onPlaySlow={onSpeakSlowOutput}
        />
      ) : null}

      <TranslationCardFooter
        hasPrimaryTranslation={Boolean(result.primaryTranslation)}
        canPractice={canPractice}
        practiceOpen={practiceOpen}
        isResultStarred={isResultStarred}
        alreadyInLibrary={alreadyInLibrary}
        isOnline={isOnline}
        googleTranslateHref={googleTranslateHref}
        onTogglePractice={togglePractice}
        onSaveAndStarResult={onSaveAndStarResult}
      />
    </section>
  );
};

export const TranslateView: FC<TranslateViewProps> = ({
  phrases,
  starredWordIds,
  settings,
  prefillRequest,
  onChangeRegion,
  onSavePhrase,
  onTogglePhraseStar,
  onToggleWordStar,
  onShowBig,
  onOpenPronunciationGuide,
  onNotify,
}) => {
  const isOnline = useOnlineStatus();
  const [direction, setDirection] = useState<"en-vi" | "vi-en">(() =>
    prefillRequest ? detectDirection(prefillRequest.query) : "en-vi",
  );
  const [query, setQuery] = useState(() => prefillRequest?.query ?? "");
  const [dictFilter, setDictFilter] = useState("");
  const [posFilter, setPosFilter] = useState<DictPosFilter>("all");
  const { copied, copyText, resetCopied } = useCopyFeedback();
  const speakingState = useSpeakingStatus();
  const lastPrefillNonceRef = useRef(prefillRequest?.nonce ?? 0);

  useEffect(() => {
    if (!prefillRequest) return;
    if (prefillRequest.nonce === lastPrefillNonceRef.current) return;
    lastPrefillNonceRef.current = prefillRequest.nonce;
    setQuery(prefillRequest.query);
    setDirection(detectDirection(prefillRequest.query));
    resetCopied();
  }, [prefillRequest, resetCopied]);

  const result = useMemo(
    () => translateOffline(query, direction, settings.region, phrases),
    [query, direction, settings.region, phrases],
  );

  const filteredDictionary = useMemo(
    () => filterDictionaryEntries(dictFilter, DICTIONARY_ENTRIES, posFilter),
    [dictFilter, posFilter],
  );

  const matchingPhrase = useMemo(() => {
    if (!result?.primaryTranslation) return undefined;
    const normEn = normalizeText(direction === "en-vi" ? result.query : result.primaryTranslation);
    const normVi = normalizeText(direction === "en-vi" ? result.primaryTranslation : result.query);
    return phrases.find(
      (p) =>
        normalizeText(p.english) === normEn ||
        normalizeText(getPhraseText(p, settings.region)) === normVi,
    );
  }, [direction, phrases, result, settings.region]);

  const matchingDictEntry = useMemo(() => {
    if (!result?.primaryTranslation || matchingPhrase || result.isCompositional) return undefined;
    if (result.dictionaryMatches.length === 0) return undefined;
    const normQ = normalizeText(result.query);
    return (
      result.dictionaryMatches.find(
        (entry) =>
          normalizeText(entry.en) === normQ ||
          normalizeText(getDictionaryEntryText(entry, settings.region)) === normQ ||
          (entry.aliases?.some((alias) => normalizeText(alias) === normQ) ?? false),
      ) ?? result.dictionaryMatches[0]
    );
  }, [matchingPhrase, result, settings.region]);

  const alreadyInLibrary = Boolean(matchingPhrase);

  const isResultStarred = useMemo(() => {
    if (matchingPhrase) return Boolean(matchingPhrase.isStarred);
    if (matchingDictEntry) return starredWordIds.has(matchingDictEntry.id);
    return false;
  }, [matchingDictEntry, matchingPhrase, starredWordIds]);

  const swapDirection = useCallback(() => {
    const nextDir = direction === "en-vi" ? "vi-en" : "en-vi";
    if (result?.primaryTranslation) {
      setQuery(result.primaryTranslation);
    }
    setDirection(nextDir);
  }, [direction, result]);

  const handleQueryChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setQuery(e.target.value);
      resetCopied();
    },
    [resetCopied],
  );

  const handleClearQuery = useCallback(() => {
    setQuery("");
    resetCopied();
  }, [resetCopied]);

  const handleDictFilterChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setDictFilter(e.target.value);
  }, []);

  const speakVietnameseText = useCallback(
    (text: string, region: DialectRegion) => {
      void audioService.speakWithSettings(text, region, settings);
    },
    [settings],
  );

  const speakEntry = useCallback(
    (entry: DictEntry) => {
      speakVietnameseText(getDictionaryEntryText(entry, settings.region), settings.region);
    },
    [settings.region, speakVietnameseText],
  );

  const inspectEntry = useCallback((entry: DictEntry) => {
    setDirection("en-vi");
    setQuery(entry.en);
  }, []);

  const handleSpeakInput = useCallback(() => {
    if (direction === "en-vi") {
      void audioService.speakEnglish(query, settings.preferredEnVoiceURI);
    } else {
      speakVietnameseText(query, settings.region);
    }
  }, [direction, query, settings.preferredEnVoiceURI, settings.region, speakVietnameseText]);

  const handleSwitchDetectedDirection = useCallback(() => {
    setDirection((prev) => (prev === "en-vi" ? "vi-en" : "en-vi"));
  }, []);

  const handleSpeakOutput = useCallback(() => {
    if (!result?.primaryTranslation) return;
    if (direction === "en-vi") {
      speakVietnameseText(result.primaryTranslation, settings.region);
    } else {
      void audioService.speakEnglish(result.primaryTranslation, settings.preferredEnVoiceURI);
    }
  }, [direction, result, settings.preferredEnVoiceURI, settings.region, speakVietnameseText]);

  const handleSpeakSlowOutput = useCallback(() => {
    if (!result?.primaryTranslation || direction !== "en-vi") return;
    void audioService.speakSlowWithSettings(result.primaryTranslation, settings.region, settings);
  }, [direction, result, settings]);

  const handleCopyOutput = useCallback(() => {
    if (!result?.primaryTranslation) return;
    copyText(result.primaryTranslation, () => {
      onNotify("Copied translation");
    });
  }, [copyText, onNotify, result]);

  const handleShowBigOutput = useCallback(() => {
    if (!result?.primaryTranslation) return;
    const variants = result.regionalVariants;
    const fallbackVi = direction === "en-vi" ? result.primaryTranslation : result.query.trim();
    const north = variants?.north ?? fallbackVi;
    const central = variants?.central ?? fallbackVi;
    const south = variants?.south ?? fallbackVi;

    const resolveRegionPhonetic = (region: DialectRegion, text: string): string => {
      if (matchingPhrase) {
        const phrasePhonetic = getPhrasePhonetic(matchingPhrase, region);
        if (phrasePhonetic) return phrasePhonetic;
      }
      if (region === settings.region && result.phonetic) {
        return result.phonetic;
      }
      return approximateVietnamesePhonetic(text, region);
    };

    onShowBig({
      english: direction === "en-vi" ? result.query : result.primaryTranslation,
      north,
      central,
      south,
      phoneticNorth: resolveRegionPhonetic("north", north),
      phoneticCentral: resolveRegionPhonetic("central", central),
      phoneticSouth: resolveRegionPhonetic("south", south),
    });
  }, [direction, matchingPhrase, onShowBig, result, settings.region]);

  const handlePlayToneFallback = useCallback(() => {
    const viText =
      speakingState.activeText ??
      (direction === "en-vi" ? result?.primaryTranslation : query.trim()) ??
      "";
    if (!viText) return;
    void playVietnameseToneContour(viText, settings.region, settings.playbackSpeed);
  }, [
    direction,
    query,
    result?.primaryTranslation,
    settings.playbackSpeed,
    settings.region,
    speakingState.activeText,
  ]);

  const handleDismissAudioError = useCallback(() => {
    audioService.stop();
  }, []);

  const handleSaveAndStarResult = useCallback(() => {
    if (!result?.primaryTranslation) return;
    if (matchingPhrase) {
      const willStar = !matchingPhrase.isStarred;
      onTogglePhraseStar(matchingPhrase.id);
      onNotify(willStar ? "Added to Saved" : "Removed from Saved");
      return;
    }
    if (matchingDictEntry) {
      const willStar = !starredWordIds.has(matchingDictEntry.id);
      onToggleWordStar(matchingDictEntry.id);
      onNotify(willStar ? "Added to Saved" : "Removed from Saved");
      return;
    }
    onSavePhrase(buildPhraseFromTranslation(result, direction, true));
    onNotify("Saved to Library & Saved");
  }, [
    direction,
    matchingDictEntry,
    matchingPhrase,
    onNotify,
    onSavePhrase,
    onTogglePhraseStar,
    onToggleWordStar,
    result,
    starredWordIds,
  ]);

  const sourceLabel = direction === "en-vi" ? "English" : "Vietnamese";
  const targetLabel = direction === "en-vi" ? "Vietnamese" : "English";
  const googleTranslateHref = query.trim()
    ? buildGoogleTranslateUrl(query, direction)
    : "https://translate.google.com/?sl=en&tl=vi&op=translate";

  const detectedOpposite = query.trim().length > 2 && detectDirection(query) !== direction;
  const prompts = direction === "en-vi" ? QUICK_PROMPTS_EN : QUICK_PROMPTS_VI;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
      <div className="space-y-4 lg:col-span-7">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-2">
          <span className="flex-1 text-center text-sm font-semibold text-stone-900">
            {sourceLabel}
          </span>
          <button
            type="button"
            onClick={swapDirection}
            aria-label="Swap translation direction"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-stone-100 text-stone-700 transition-colors hover:bg-stone-200 hover:text-stone-900"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="flex-1 text-center text-sm font-semibold text-stone-900">
            {targetLabel}
          </span>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <textarea
            rows={3}
            value={query}
            onChange={handleQueryChange}
            aria-label={`Enter ${sourceLabel} text to translate`}
            placeholder={
              direction === "en-vi"
                ? "Type an English word, phrase, or VND price (e.g. iced milk coffee, 50k)..."
                : "Type Vietnamese with or without accents (e.g. tính tiền, năm chục ngàn)..."
            }
            className="w-full resize-none bg-transparent text-base text-stone-900 placeholder:text-stone-400 focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {prompts.map((sample) => (
                <SampleChip key={sample} sample={sample} onSelect={setQuery} />
              ))}
            </div>

            {query.trim() ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Speak ${sourceLabel} input`}
                  onClick={handleSpeakInput}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Clear input"
                  onClick={handleClearQuery}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>

          {detectedOpposite ? (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
              <span>Looks like {direction === "en-vi" ? "Vietnamese" : "English"} text.</span>
              <button
                type="button"
                onClick={handleSwitchDetectedDirection}
                className="font-semibold text-[#0F766E] hover:underline"
              >
                Switch to {direction === "en-vi" ? "VI → EN" : "EN → VI"}
              </button>
            </div>
          ) : null}
        </div>

        {result ? (
          <TranslationResultCard
            result={result}
            direction={direction}
            targetLabel={targetLabel}
            settings={settings}
            copied={copied}
            speakingState={speakingState}
            isOnline={isOnline}
            googleTranslateHref={googleTranslateHref}
            alreadyInLibrary={alreadyInLibrary}
            isResultStarred={isResultStarred}
            starredWordIds={starredWordIds}
            onChangeRegion={onChangeRegion}
            onCopyOutput={handleCopyOutput}
            onShowBigOutput={handleShowBigOutput}
            onSpeakOutput={handleSpeakOutput}
            onSpeakSlowOutput={handleSpeakSlowOutput}
            onSpeakVietnamese={speakVietnameseText}
            onPlayToneFallback={handlePlayToneFallback}
            onDismissAudioError={handleDismissAudioError}
            onSaveAndStarResult={handleSaveAndStarResult}
            onToggleWordStar={onToggleWordStar}
            onOpenPronunciationGuide={onOpenPronunciationGuide}
          />
        ) : null}

        {result && result.matchedPhrases.length > 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h3 className="font-display text-sm font-semibold text-stone-900">
              Related Real-Spoken Phrases
            </h3>
            <div className="mt-3 divide-y divide-stone-100">
              {result.matchedPhrases.map((phrase) => (
                <RelatedPhraseRow
                  key={phrase.id}
                  phrase={phrase}
                  region={settings.region}
                  onSpeak={speakVietnameseText}
                  onTogglePhraseStar={onTogglePhraseStar}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <aside className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-stone-900">
            Offline Vocabulary (
            {filteredDictionary.length === DICTIONARY_ENTRIES.length
              ? DICTIONARY_ENTRIES.length
              : `${String(filteredDictionary.length)}/${String(DICTIONARY_ENTRIES.length)}`}
            )
          </h2>
          <span className="text-xs text-stone-500">EN ⇄ VI</span>
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={dictFilter}
            onChange={handleDictFilterChange}
            aria-label="Filter offline vocabulary"
            placeholder="Filter words (coffee, mắc, left...)"
            className="min-h-[42px] w-full rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#0F766E] focus:bg-white focus:outline-none"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {DICT_POS_FILTERS.map((option) => (
            <PosFilterButton
              key={option.id}
              option={option}
              active={posFilter === option.id}
              onSelect={setPosFilter}
            />
          ))}
        </div>

        <div className="mt-3 max-h-[440px] divide-y divide-stone-100 overflow-y-auto pr-1">
          {filteredDictionary.map((entry) => {
            const text = getDictionaryEntryText(entry, settings.region);
            const isBusy =
              speakingState.activeText === text &&
              speakingState.activeRegion === settings.region &&
              (speakingState.isSpeaking || speakingState.isLoading);
            return (
              <DictionaryRow
                key={entry.id}
                entry={entry}
                region={settings.region}
                isBusy={isBusy}
                starred={starredWordIds.has(entry.id)}
                onInspect={inspectEntry}
                onSpeak={speakEntry}
                onToggleStar={onToggleWordStar}
              />
            );
          })}
        </div>
      </aside>
    </div>
  );
};
