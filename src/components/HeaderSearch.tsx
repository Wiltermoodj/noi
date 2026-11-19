import { ArrowRight, Loader2, Maximize2, Search, Star, Volume2, X } from "lucide-react";
import type { ChangeEvent, FC, KeyboardEvent, RefObject, TransitionEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService, type SpeakingStatus } from "../services/audioService";
import {
  type GlobalSearchNumericMatch,
  type GlobalSearchResults,
  searchGlobalEntries,
} from "../services/globalSearchService";
import { getPhrasePhonetic, getPhraseText } from "../services/storageService";
import { approximateVietnamesePhonetic } from "../services/toneAudioService";
import { getDictionaryEntryText } from "../services/translationService";
import type { AppSettings, DialectRegion, DictEntry, Phrase } from "../types/vietnamese";
import type { ShowBigPayload } from "./ShowBigModal";

interface HeaderSearchProps {
  headerContainerRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  isElevated: boolean;
  onOpen: () => void;
  onClose: () => void;
  onElevationEnd: () => void;
  phrases: Phrase[];
  starredWordIds: Set<string>;
  settings: AppSettings;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenInTranslate: (query: string) => void;
}

const QUICK_SEARCH_CHIPS = [
  "iced milk coffee",
  "how much",
  "50k",
  "thank you",
  "not spicy",
  "turn left",
];

interface QuickChipButtonProps {
  label: string;
  onSelect: (value: string) => void;
}

const QuickChipButton: FC<QuickChipButtonProps> = ({ label, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(label);
  }, [label, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="min-h-[32px] rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:border-[#0F766E]/40 hover:bg-[#0F766E]/5 hover:text-[#0F766E]"
    >
      {label}
    </button>
  );
};

interface NumericMatchCardProps {
  match: GlobalSearchNumericMatch;
  region: DialectRegion;
  isBusy: boolean;
  onSpeak: (text: string) => void;
  onShowBig: (match: GlobalSearchNumericMatch) => void;
}

const NumericMatchCard: FC<NumericMatchCardProps> = ({
  match,
  region,
  isBusy,
  onSpeak,
  onShowBig,
}) => {
  const activeText =
    region === "north" ? match.north : region === "central" ? match.central : match.south;

  const handleSpeak = useCallback(() => {
    onSpeak(activeText);
  }, [activeText, onSpeak]);

  const handleShowBig = useCallback(() => {
    onShowBig(match);
  }, [match, onShowBig]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#0F766E]/25 bg-[#0F766E]/5 px-3.5 py-2.5">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#0F766E]">
          <span>Number &amp; Price</span>
          <span aria-hidden="true">·</span>
          <span>{match.label}</span>
        </div>
        <p className="mt-0.5 truncate font-display text-sm font-semibold text-stone-900">
          {activeText}
        </p>
        <p className="truncate text-xs italic text-[#0F766E]/90">{match.phonetic}</p>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${match.label}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-white hover:text-stone-900"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleSpeak}
          aria-label={`Listen to ${match.label}`}
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
            isBusy ? "bg-[#0F766E] text-white" : "bg-white text-[#0F766E] hover:bg-[#0F766E]/10"
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

interface SearchPhraseRowProps {
  phrase: Phrase;
  region: DialectRegion;
  isBusy: boolean;
  onSpeak: (text: string) => void;
  onToggleStar: (id: string) => void;
  onShowBig: (phrase: Phrase) => void;
}

const SearchPhraseRow: FC<SearchPhraseRowProps> = ({
  phrase,
  region,
  isBusy,
  onSpeak,
  onToggleStar,
  onShowBig,
}) => {
  const vi = getPhraseText(phrase, region);
  const phonetic = getPhrasePhonetic(phrase, region);

  const handleSpeak = useCallback(() => {
    onSpeak(vi);
  }, [onSpeak, vi]);

  const handleStar = useCallback(() => {
    onToggleStar(phrase.id);
  }, [onToggleStar, phrase.id]);

  const handleShowBig = useCallback(() => {
    onShowBig(phrase);
  }, [onShowBig, phrase]);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-stone-50">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-stone-500">
          <span className="font-medium text-stone-600">{phrase.category}</span>
          {phrase.isCustom ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#0F766E]">Custom</span>
            </>
          ) : null}
        </div>
        <p className="mt-0.5 truncate font-display text-sm font-semibold text-stone-900">{vi}</p>
        <p className="truncate text-xs text-stone-600">{phrase.english}</p>
        <p className="truncate text-[11px] italic text-[#0F766E]/90">{phonetic}</p>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${phrase.english}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleStar}
          aria-pressed={Boolean(phrase.isStarred)}
          aria-label={
            phrase.isStarred ? `Remove ${phrase.english} from Saved` : `Save ${phrase.english}`
          }
          title={phrase.isStarred ? "Saved" : "Save"}
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
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
          onClick={handleSpeak}
          aria-label={`Listen to ${phrase.english}`}
          title="Listen"
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
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

interface SearchWordRowProps {
  entry: DictEntry;
  region: DialectRegion;
  starred: boolean;
  isBusy: boolean;
  onSpeak: (text: string) => void;
  onToggleStar: (id: string) => void;
  onShowBig: (entry: DictEntry) => void;
}

const SearchWordRow: FC<SearchWordRowProps> = ({
  entry,
  region,
  starred,
  isBusy,
  onSpeak,
  onToggleStar,
  onShowBig,
}) => {
  const vi = getDictionaryEntryText(entry, region);

  const handleSpeak = useCallback(() => {
    onSpeak(vi);
  }, [onSpeak, vi]);

  const handleStar = useCallback(() => {
    onToggleStar(entry.id);
  }, [entry.id, onToggleStar]);

  const handleShowBig = useCallback(() => {
    onShowBig(entry);
  }, [entry, onShowBig]);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-stone-50">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-display text-sm font-semibold text-stone-900">{vi}</span>
          <span className="truncate text-xs text-stone-600">· {entry.en}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-stone-500">{entry.note}</p>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${entry.en}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleStar}
          aria-pressed={starred}
          aria-label={starred ? `Remove ${entry.en} from Saved` : `Save ${entry.en}`}
          title={starred ? "Saved" : "Save"}
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
            starred
              ? "text-amber-500 hover:bg-amber-50"
              : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          }`}
        >
          <Star className={`h-4 w-4 ${starred ? "fill-amber-400" : ""}`} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleSpeak}
          aria-label={`Listen to ${entry.en}`}
          title="Listen"
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
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

interface SearchResultsDropdownProps {
  expandedWidth: number;
  trimmedQuery: string;
  results: GlobalSearchResults;
  region: DialectRegion;
  starredWordIds: Set<string>;
  speakingState: SpeakingStatus;
  onSelectChip: (value: string) => void;
  onOpenTranslator: () => void;
  onSpeakText: (text: string) => void;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onShowBigPhrase: (phrase: Phrase) => void;
  onShowBigWord: (entry: DictEntry) => void;
  onShowBigNumeric: (match: GlobalSearchNumericMatch) => void;
}

function getNumericActiveText(match: GlobalSearchNumericMatch, region: DialectRegion): string {
  if (region === "north") return match.north;
  if (region === "central") return match.central;
  return match.south;
}

function isSpeakingText(
  speakingState: SpeakingStatus,
  text: string,
  region: DialectRegion,
): boolean {
  return (
    speakingState.activeText === text &&
    speakingState.activeRegion === region &&
    (speakingState.isSpeaking || speakingState.isLoading)
  );
}

const SearchResultsDropdown: FC<SearchResultsDropdownProps> = ({
  expandedWidth,
  trimmedQuery,
  results,
  region,
  starredWordIds,
  speakingState,
  onSelectChip,
  onOpenTranslator,
  onSpeakText,
  onTogglePhraseStar,
  onToggleWordStar,
  onShowBigPhrase,
  onShowBigWord,
  onShowBigNumeric,
}) => {
  const hasQuery = trimmedQuery.length > 0;
  const hasAnyResults =
    results.phrases.length > 0 || results.words.length > 0 || results.numericMatch !== null;
  const totalMatches =
    results.totalPhraseMatches + results.totalWordMatches + (results.numericMatch ? 1 : 0);

  return (
    <div
      style={{ width: `${String(expandedWidth)}px` }}
      className="absolute left-0 top-full z-[9999] mt-2 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
    >
      {!hasQuery ? (
        <div className="space-y-3 p-4">
          <p className="text-xs font-medium text-stone-600">
            Search all phrases, offline dictionary &amp; VND prices
          </p>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_SEARCH_CHIPS.map((chip) => (
              <QuickChipButton key={chip} label={chip} onSelect={onSelectChip} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50/70 px-3.5 py-2 text-xs">
            <span className="text-stone-500 tabular-nums">
              {totalMatches} {totalMatches === 1 ? "match" : "matches"}
            </span>
            <button
              type="button"
              onClick={onOpenTranslator}
              className="inline-flex items-center gap-1 font-medium text-[#0F766E] hover:underline"
            >
              <span>Open in Translator</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>

          {!hasAnyResults ? (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-stone-800">
                No direct matches for &ldquo;{trimmedQuery}&rdquo;
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Try simpler keywords or open it in the Translator to compose word-by-word.
              </p>
              <button
                type="button"
                onClick={onOpenTranslator}
                className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#0F766E] px-4 text-xs font-medium text-white transition-colors hover:bg-[#0D655E]"
              >
                <span>Translate &ldquo;{trimmedQuery}&rdquo;</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="max-h-[65vh] divide-y divide-stone-100 overflow-y-auto">
              {results.numericMatch ? (
                <div className="p-2.5">
                  <NumericMatchCard
                    match={results.numericMatch}
                    region={region}
                    isBusy={isSpeakingText(
                      speakingState,
                      getNumericActiveText(results.numericMatch, region),
                      region,
                    )}
                    onSpeak={onSpeakText}
                    onShowBig={onShowBigNumeric}
                  />
                </div>
              ) : null}

              {results.phrases.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between bg-stone-50/50 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    <span>Phrases</span>
                    <span className="tabular-nums">{results.totalPhraseMatches}</span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {results.phrases.map(({ phrase }) => (
                      <SearchPhraseRow
                        key={phrase.id}
                        phrase={phrase}
                        region={region}
                        isBusy={isSpeakingText(
                          speakingState,
                          getPhraseText(phrase, region),
                          region,
                        )}
                        onSpeak={onSpeakText}
                        onToggleStar={onTogglePhraseStar}
                        onShowBig={onShowBigPhrase}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {results.words.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between bg-stone-50/50 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    <span>Offline Vocabulary</span>
                    <span className="tabular-nums">{results.totalWordMatches}</span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {results.words.map(({ entry }) => (
                      <SearchWordRow
                        key={entry.id}
                        entry={entry}
                        region={region}
                        starred={starredWordIds.has(entry.id)}
                        isBusy={isSpeakingText(
                          speakingState,
                          getDictionaryEntryText(entry, region),
                          region,
                        )}
                        onSpeak={onSpeakText}
                        onToggleStar={onToggleWordStar}
                        onShowBig={onShowBigWord}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const HeaderSearch: FC<HeaderSearchProps> = ({
  headerContainerRef,
  isOpen,
  isElevated,
  onOpen,
  onClose,
  onElevationEnd,
  phrases,
  starredWordIds,
  settings,
  onTogglePhraseStar,
  onToggleWordStar,
  onShowBig,
  onOpenInTranslate,
}) => {
  const [query, setQuery] = useState("");
  const [expandedWidth, setExpandedWidth] = useState(320);

  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const speakingState = useSpeakingStatus();

  const computeExpandedWidth = useCallback((): number => {
    const headerEl = headerContainerRef.current;
    const anchorEl = anchorRef.current;
    if (!headerEl || !anchorEl) {
      return 320;
    }
    const headerRect = headerEl.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const parsedPaddingRight = Number.parseFloat(window.getComputedStyle(headerEl).paddingRight);
    const paddingRight =
      Number.isFinite(parsedPaddingRight) && parsedPaddingRight > 0 ? parsedPaddingRight : 16;
    const available = Math.floor(headerRect.right - paddingRight - anchorRect.left);
    return Math.max(200, available);
  }, [headerContainerRef]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updateWidth = () => {
      setExpandedWidth(computeExpandedWidth());
    };
    updateWidth();

    const headerEl = headerContainerRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && headerEl
        ? new ResizeObserver(updateWidth)
        : undefined;
    if (observer && headerEl) {
      observer.observe(headerEl);
    }
    window.addEventListener("resize", updateWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [computeExpandedWidth, headerContainerRef, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen || !isElevated) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onElevationEnd();
      return undefined;
    }
    const fallbackTimer = window.setTimeout(() => {
      onElevationEnd();
    }, 1200);
    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [isElevated, isOpen, onElevationEnd]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const results = useMemo(
    () => searchGlobalEntries(query, phrases, settings.region),
    [phrases, query, settings.region],
  );

  const handleOpenClick = useCallback(() => {
    setExpandedWidth(computeExpandedWidth());
    onOpen();
  }, [computeExpandedWidth, onOpen]);

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClearQuery = useCallback(() => {
    setQuery("");
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && query.trim().length > 0) {
        const hasAnyMatch =
          results.phrases.length > 0 || results.words.length > 0 || results.numericMatch !== null;
        if (!hasAnyMatch) {
          event.preventDefault();
          onOpenInTranslate(query.trim());
          onClose();
        }
      }
    },
    [
      onClose,
      onOpenInTranslate,
      query,
      results.numericMatch,
      results.phrases.length,
      results.words.length,
    ],
  );

  const handleBarTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && event.propertyName === "width" && !isOpen) {
        onElevationEnd();
      }
    },
    [isOpen, onElevationEnd],
  );

  const handleSpeakText = useCallback(
    (text: string) => {
      void audioService.speakWithSettings(text, settings.region, settings);
    },
    [settings],
  );

  const handleShowBigPhrase = useCallback(
    (phrase: Phrase) => {
      onShowBig({
        english: phrase.english,
        north: phrase.north,
        central: phrase.central,
        south: phrase.south,
        phoneticNorth: phrase.phoneticNorth,
        phoneticCentral: phrase.phoneticCentral,
        phoneticSouth: phrase.phoneticSouth,
      });
      onClose();
    },
    [onClose, onShowBig],
  );

  const handleShowBigWord = useCallback(
    (entry: DictEntry) => {
      const north = getDictionaryEntryText(entry, "north");
      const central = getDictionaryEntryText(entry, "central");
      const south = getDictionaryEntryText(entry, "south");
      onShowBig({
        english: entry.en,
        north,
        central,
        south,
        phoneticNorth: approximateVietnamesePhonetic(north, "north"),
        phoneticCentral: approximateVietnamesePhonetic(central, "central"),
        phoneticSouth: approximateVietnamesePhonetic(south, "south"),
      });
      onClose();
    },
    [onClose, onShowBig],
  );

  const handleShowBigNumeric = useCallback(
    (match: GlobalSearchNumericMatch) => {
      onShowBig({
        english: match.label,
        north: match.north,
        central: match.central,
        south: match.south,
        phoneticNorth: approximateVietnamesePhonetic(match.north, "north"),
        phoneticCentral: approximateVietnamesePhonetic(match.central, "central"),
        phoneticSouth: approximateVietnamesePhonetic(match.south, "south"),
      });
      onClose();
    },
    [onClose, onShowBig],
  );

  const handleOpenTranslator = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    onOpenInTranslate(trimmed);
    onClose();
  }, [onClose, onOpenInTranslate, query]);

  const handleSelectChip = useCallback((value: string) => {
    setQuery(value);
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <div ref={anchorRef} className="relative h-11 w-11 shrink-0">
      <div
        role={isOpen ? "search" : undefined}
        onTransitionEnd={handleBarTransitionEnd}
        style={{ width: isOpen ? `${String(expandedWidth)}px` : "44px" }}
        className={`absolute left-0 top-0 flex h-11 items-center overflow-hidden rounded-xl transition-[width,background-color,border-color,box-shadow] duration-[1120ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen
            ? "z-[9999] border border-[#0F766E]/40 bg-white shadow-lg ring-2 ring-[#0F766E]/10"
            : isElevated
              ? "z-[9999] border border-stone-200 bg-white/95 shadow-sm"
              : "border border-transparent bg-transparent"
        }`}
      >
        {isOpen ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center text-[#0F766E]">
            <Search className="h-5 w-5" aria-hidden="true" />
          </div>
        ) : (
          <button
            type="button"
            onClick={handleOpenClick}
            aria-label="Open search"
            aria-expanded={false}
            title="Search phrases and vocabulary"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          tabIndex={isOpen ? 0 : -1}
          aria-hidden={!isOpen}
          aria-label="Search phrases, vocabulary, or VND prices"
          placeholder="Search phrases, words, or prices (e.g. 50k)..."
          className={`h-full min-w-0 flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
            isOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        {isOpen ? (
          <div className="flex shrink-0 items-center gap-0.5 pr-1">
            {hasQuery ? (
              <button
                type="button"
                onClick={handleClearQuery}
                aria-label="Clear search query"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <span className="text-[11px] font-medium">Clear</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCloseClick}
              aria-label="Close search"
              title="Close search"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <SearchResultsDropdown
          expandedWidth={expandedWidth}
          trimmedQuery={trimmedQuery}
          results={results}
          region={settings.region}
          starredWordIds={starredWordIds}
          speakingState={speakingState}
          onSelectChip={handleSelectChip}
          onOpenTranslator={handleOpenTranslator}
          onSpeakText={handleSpeakText}
          onTogglePhraseStar={onTogglePhraseStar}
          onToggleWordStar={onToggleWordStar}
          onShowBigPhrase={handleShowBigPhrase}
          onShowBigWord={handleShowBigWord}
          onShowBigNumeric={handleShowBigNumeric}
        />
      ) : null}
    </div>
  );
};
