import { ArrowRight, Loader2, Maximize2, Star, Volume2 } from "lucide-react";
import type { FC } from "react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService, type SpeakingStatus } from "../services/audioService";
import {
  type GlobalSearchNumericMatch,
  searchGlobalEntries,
} from "../services/globalSearchService";
import { getPhrasePhonetic, getPhraseText } from "../services/storageService";
import { approximateVietnamesePhonetic } from "../services/toneAudioService";
import { getDictionaryEntryText } from "../services/translationService";
import type { AppSettings, DialectRegion, DictEntry, Phrase } from "../types/vietnamese";
import type { ShowBigPayload } from "./ShowBigModal";

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
      className="min-h-[32px] rounded-lg border border-border bg-surface-subtle px-2.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent"
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

const NumericMatchCardBase: FC<NumericMatchCardProps> = ({
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-accent-border bg-accent-soft px-3.5 py-2.5">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
          <span>Number &amp; Price</span>
          <span aria-hidden="true">·</span>
          <span>{match.label}</span>
        </div>
        <p className="mt-0.5 truncate font-display text-sm font-semibold text-ink">{activeText}</p>
        <p className="truncate text-xs italic text-accent">{match.phonetic}</p>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${match.label}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleSpeak}
          aria-label={`Listen to ${match.label}`}
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
            isBusy ? "bg-accent text-accent-fg" : "bg-surface text-accent hover:bg-accent-muted"
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

const NumericMatchCard = memo(NumericMatchCardBase);

interface SearchPhraseRowProps {
  phrase: Phrase;
  region: DialectRegion;
  isBusy: boolean;
  onSpeak: (text: string) => void;
  onToggleStar: (id: string) => void;
  onShowBig: (phrase: Phrase) => void;
}

const SearchPhraseRowBase: FC<SearchPhraseRowProps> = ({
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
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-surface-subtle">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-muted">
          <span className="font-medium text-ink-secondary">{phrase.category}</span>
          {phrase.isCustom ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-accent">Custom</span>
            </>
          ) : null}
        </div>
        <p className="mt-0.5 truncate font-display text-sm font-semibold text-ink">{vi}</p>
        <p className="truncate text-xs text-ink-secondary">{phrase.english}</p>
        <p className="truncate text-[11px] italic text-accent">{phonetic}</p>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${phrase.english}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
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
          onClick={handleSpeak}
          aria-label={`Listen to ${phrase.english}`}
          title="Listen"
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
            isBusy
              ? "bg-accent text-accent-fg"
              : "text-ink-faint hover:bg-surface-muted hover:text-accent"
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

const SearchPhraseRow = memo(SearchPhraseRowBase);

interface SearchWordRowProps {
  entry: DictEntry;
  region: DialectRegion;
  starred: boolean;
  isBusy: boolean;
  onSpeak: (text: string) => void;
  onToggleStar: (id: string) => void;
  onShowBig: (entry: DictEntry) => void;
}

const SearchWordRowBase: FC<SearchWordRowProps> = ({
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
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-surface-subtle">
      <button type="button" onClick={handleSpeak} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-display text-sm font-semibold text-ink">{vi}</span>
          <span className="truncate text-xs text-ink-secondary">· {entry.en}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-muted">{entry.note}</p>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleShowBig}
          aria-label={`Show large text for ${entry.en}`}
          title="Show to Local"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
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
              ? "text-star hover:bg-star-soft"
              : "text-ink-faint hover:bg-surface-muted hover:text-ink-secondary"
          }`}
        >
          <Star className={`h-4 w-4 ${starred ? "fill-star-fill" : ""}`} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleSpeak}
          aria-label={`Listen to ${entry.en}`}
          title="Listen"
          className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg transition-colors ${
            isBusy
              ? "bg-accent text-accent-fg"
              : "text-ink-faint hover:bg-surface-muted hover:text-accent"
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

const SearchWordRow = memo(SearchWordRowBase);

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

export interface HeaderSearchDropdownProps {
  expandedWidth: number;
  trimmedQuery: string;
  deferredQuery: string;
  phrases: Phrase[];
  starredWordIds: Set<string>;
  settings: AppSettings;
  onSelectChip: (value: string) => void;
  onOpenTranslator: () => void;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onClose: () => void;
  onHasMatchesChange: (hasMatches: boolean) => void;
}

export const HeaderSearchDropdown: FC<HeaderSearchDropdownProps> = ({
  expandedWidth,
  trimmedQuery,
  deferredQuery,
  phrases,
  starredWordIds,
  settings,
  onSelectChip,
  onOpenTranslator,
  onTogglePhraseStar,
  onToggleWordStar,
  onShowBig,
  onClose,
  onHasMatchesChange,
}) => {
  const speakingState = useSpeakingStatus();
  const region = settings.region;

  const results = useMemo(
    () => searchGlobalEntries(deferredQuery, phrases, region),
    [deferredQuery, phrases, region],
  );

  const hasQuery = trimmedQuery.length > 0;
  const hasAnyResults =
    results.phrases.length > 0 || results.words.length > 0 || results.numericMatch !== null;
  const totalMatches =
    results.totalPhraseMatches + results.totalWordMatches + (results.numericMatch ? 1 : 0);

  useEffect(() => {
    onHasMatchesChange(hasAnyResults);
  }, [hasAnyResults, onHasMatchesChange]);

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

  return (
    <div
      style={{ width: `${String(expandedWidth)}px` }}
      className="absolute left-0 top-full z-[9999] mt-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
    >
      {!hasQuery ? (
        <div className="space-y-3 p-4">
          <p className="text-xs font-medium text-ink-secondary">
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
          <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs">
            <span className="text-ink-muted tabular-nums">
              {totalMatches} {totalMatches === 1 ? "match" : "matches"}
            </span>
            <button
              type="button"
              onClick={onOpenTranslator}
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              <span>Open in Translator</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>

          {!hasAnyResults ? (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-ink">
                No direct matches for &ldquo;{trimmedQuery}&rdquo;
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Try simpler keywords or open it in the Translator to compose word-by-word.
              </p>
              <button
                type="button"
                onClick={onOpenTranslator}
                className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              >
                <span>Translate &ldquo;{trimmedQuery}&rdquo;</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="max-h-[65vh] divide-y divide-border-subtle overflow-y-auto">
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
                    onSpeak={handleSpeakText}
                    onShowBig={handleShowBigNumeric}
                  />
                </div>
              ) : null}

              {results.phrases.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between bg-surface-subtle px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    <span>Phrases</span>
                    <span className="tabular-nums">{results.totalPhraseMatches}</span>
                  </div>
                  <div className="divide-y divide-border-subtle">
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
                        onSpeak={handleSpeakText}
                        onToggleStar={onTogglePhraseStar}
                        onShowBig={handleShowBigPhrase}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {results.words.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between bg-surface-subtle px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    <span>Offline Vocabulary</span>
                    <span className="tabular-nums">{results.totalWordMatches}</span>
                  </div>
                  <div className="divide-y divide-border-subtle">
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
                        onSpeak={handleSpeakText}
                        onToggleStar={onToggleWordStar}
                        onShowBig={handleShowBigWord}
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
