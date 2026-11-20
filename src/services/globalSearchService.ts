import { DICTIONARY_ENTRIES } from "../data/dictionary";
import type { DialectRegion, DictEntry, Phrase } from "../types/vietnamese";
import { getPhrasePhonetic } from "./storageService";
import { approximateVietnamesePhonetic } from "./toneAudioService";
import { detectDirection, getDictionaryEntryText, normalizeText } from "./translationService";
import { translateNumericQuery } from "./vietnameseNumbers";

export interface GlobalSearchPhraseMatch {
  phrase: Phrase;
  score: number;
}

export interface GlobalSearchWordMatch {
  entry: DictEntry;
  score: number;
}

export interface GlobalSearchNumericMatch {
  query: string;
  label: string;
  north: string;
  central: string;
  south: string;
  phonetic: string;
  note: string;
}

export interface GlobalSearchResults {
  query: string;
  phrases: GlobalSearchPhraseMatch[];
  words: GlobalSearchWordMatch[];
  numericMatch: GlobalSearchNumericMatch | null;
  totalPhraseMatches: number;
  totalWordMatches: number;
}

function tokenizeQuery(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function containsAllTokens(haystack: string, tokens: readonly string[]): boolean {
  if (!haystack || tokens.length === 0) return false;
  return tokens.every((token) => haystack.includes(token));
}

interface IndexedSearchPhrase {
  enNorm: string;
  northNorm: string;
  centralNorm: string;
  southNorm: string;
  variantNorms: readonly [string, string, string];
  phoneticNorms: readonly [string, string, string];
  combinedHaystack: string;
}

interface IndexedSearchWord {
  enNorm: string;
  aliasNorms: readonly string[];
  viNorms: readonly string[];
  combinedHaystack: string;
}

const searchPhraseIndexCache = new WeakMap<Phrase, IndexedSearchPhrase>();
const searchWordIndexCache = new WeakMap<DictEntry, IndexedSearchWord>();

function getIndexedSearchPhrase(phrase: Phrase): IndexedSearchPhrase {
  const cached = searchPhraseIndexCache.get(phrase);
  if (cached) return cached;

  const enNorm = normalizeText(phrase.english);
  const northNorm = normalizeText(phrase.north);
  const centralNorm = normalizeText(phrase.central);
  const southNorm = normalizeText(phrase.south);
  const variantNorms = [northNorm, centralNorm, southNorm] as const;
  const phoneticNorms = [
    normalizeText(phrase.phoneticNorth),
    normalizeText(phrase.phoneticCentral),
    normalizeText(phrase.phoneticSouth),
  ] as const;
  const combinedHaystack = [
    enNorm,
    ...variantNorms,
    ...phoneticNorms,
    normalizeText(phrase.category),
    normalizeText(phrase.streetNote),
    normalizeText(phrase.textbook),
  ]
    .filter(Boolean)
    .join(" ");

  const indexed: IndexedSearchPhrase = {
    enNorm,
    northNorm,
    centralNorm,
    southNorm,
    variantNorms,
    phoneticNorms,
    combinedHaystack,
  };
  searchPhraseIndexCache.set(phrase, indexed);
  return indexed;
}

function getIndexedSearchWord(entry: DictEntry): IndexedSearchWord {
  const cached = searchWordIndexCache.get(entry);
  if (cached) return cached;

  const enNorm = normalizeText(entry.en);
  const aliasNorms = (entry.aliases ?? []).map(normalizeText);
  const viNorms = [
    normalizeText(getDictionaryEntryText(entry, "north")),
    normalizeText(getDictionaryEntryText(entry, "central")),
    normalizeText(getDictionaryEntryText(entry, "south")),
    normalizeText(entry.vi),
    entry.north ? normalizeText(entry.north) : "",
    entry.central ? normalizeText(entry.central) : "",
    entry.south ? normalizeText(entry.south) : "",
  ].filter(Boolean);

  const combinedHaystack = [
    enNorm,
    ...aliasNorms,
    ...viNorms,
    normalizeText(entry.partOfSpeech),
    normalizeText(entry.note),
  ]
    .filter(Boolean)
    .join(" ");

  const indexed: IndexedSearchWord = {
    enNorm,
    aliasNorms,
    viNorms,
    combinedHaystack,
  };
  searchWordIndexCache.set(entry, indexed);
  return indexed;
}

function scorePhraseMatch(phrase: Phrase, normQuery: string, tokens: readonly string[]): number {
  const { enNorm, variantNorms, phoneticNorms, combinedHaystack } = getIndexedSearchPhrase(phrase);

  let score: number;
  if (enNorm === normQuery || variantNorms.some((v) => v === normQuery)) {
    score = 100;
  } else if (enNorm.startsWith(normQuery) || variantNorms.some((v) => v.startsWith(normQuery))) {
    score = 85;
  } else if (
    containsAllTokens(enNorm, tokens) ||
    variantNorms.some((v) => containsAllTokens(v, tokens))
  ) {
    score = 70;
  } else if (phoneticNorms.some((p) => containsAllTokens(p, tokens))) {
    score = 50;
  } else {
    if (!containsAllTokens(combinedHaystack, tokens)) {
      return 0;
    }
    score = 35;
  }

  return phrase.isStarred ? score + 3 : score;
}

function scoreWordMatch(entry: DictEntry, normQuery: string, tokens: readonly string[]): number {
  const { enNorm, aliasNorms, viNorms, combinedHaystack } = getIndexedSearchWord(entry);

  if (
    enNorm === normQuery ||
    aliasNorms.includes(normQuery) ||
    viNorms.some((v) => v === normQuery)
  ) {
    return 100;
  }
  if (
    enNorm.startsWith(normQuery) ||
    aliasNorms.some((a) => a.startsWith(normQuery)) ||
    viNorms.some((v) => v.startsWith(normQuery))
  ) {
    return 85;
  }
  if (
    containsAllTokens(enNorm, tokens) ||
    aliasNorms.some((a) => containsAllTokens(a, tokens)) ||
    viNorms.some((v) => containsAllTokens(v, tokens))
  ) {
    return 70;
  }

  return containsAllTokens(combinedHaystack, tokens) ? 35 : 0;
}

function buildNumericMatch(
  trimmedQuery: string,
  normQuery: string,
  region: DialectRegion,
): GlobalSearchNumericMatch | null {
  const direction = detectDirection(trimmedQuery);
  const numeric = translateNumericQuery(normQuery, direction, region);
  if (!numeric) return null;

  const north = numeric.regionalVariants?.north ?? numeric.primaryTranslation;
  const central = numeric.regionalVariants?.central ?? numeric.primaryTranslation;
  const south = numeric.regionalVariants?.south ?? numeric.primaryTranslation;
  const activeText = region === "north" ? north : region === "central" ? central : south;

  return {
    query: trimmedQuery,
    label: numeric.interpretation.displayLabel,
    north,
    central,
    south,
    phonetic: approximateVietnamesePhonetic(activeText, region),
    note: numeric.streetNote,
  };
}

export function searchGlobalEntries(
  rawQuery: string,
  phrases: readonly Phrase[],
  region: DialectRegion,
  dictionaryEntries: readonly DictEntry[] = DICTIONARY_ENTRIES,
  limitPerGroup = 6,
): GlobalSearchResults {
  const trimmed = rawQuery.trim();
  const normQuery = normalizeText(trimmed);
  const tokens = tokenizeQuery(trimmed);

  if (!trimmed || tokens.length === 0) {
    return {
      query: trimmed,
      phrases: [],
      words: [],
      numericMatch: null,
      totalPhraseMatches: 0,
      totalWordMatches: 0,
    };
  }

  const matchedPhrases: GlobalSearchPhraseMatch[] = [];
  for (const phrase of phrases) {
    const score = scorePhraseMatch(phrase, normQuery, tokens);
    if (score > 0) {
      matchedPhrases.push({ phrase, score });
    }
  }
  matchedPhrases.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.phrase.sortOrder - b.phrase.sortOrder;
  });

  const matchedWords: GlobalSearchWordMatch[] = [];
  for (const entry of dictionaryEntries) {
    const score = scoreWordMatch(entry, normQuery, tokens);
    if (score > 0) {
      matchedWords.push({ entry, score });
    }
  }
  matchedWords.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.en.localeCompare(b.entry.en, "en");
  });

  return {
    query: trimmed,
    phrases: matchedPhrases.slice(0, limitPerGroup),
    words: matchedWords.slice(0, limitPerGroup),
    numericMatch: buildNumericMatch(trimmed, normQuery, region),
    totalPhraseMatches: matchedPhrases.length,
    totalWordMatches: matchedWords.length,
  };
}

export function getPhrasePhoneticDisplay(phrase: Phrase, region: DialectRegion): string {
  return getPhrasePhonetic(phrase, region);
}
