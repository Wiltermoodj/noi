import { DICTIONARY_ENTRIES } from "../data/dictionary";
import {
  type DialectRegion,
  type DictEntry,
  PHRASE_CATEGORIES,
  type Phrase,
  type PhrasebookItem,
  type PhrasebookKindFilter,
  type PhrasebookSortOption,
  type PhraseCategory,
  type PhrasePriority,
  type StarredWordRecord,
} from "../types/vietnamese";
import { getPhrasePhonetic, getPhraseText } from "./storageService";
import { approximateVietnamesePhonetic } from "./toneAudioService";
import { getDictionaryEntryText, normalizeText } from "./translationService";

export type { PhrasebookItem } from "../types/vietnamese";

export type PhrasebookTopicFilter = "all" | PhraseCategory | DictEntry["partOfSpeech"];
export type PhrasebookPriorityFilter = "all" | PhrasePriority | "custom";

export interface PhrasebookFilters {
  search: string;
  kind: PhrasebookKindFilter;
  topic: PhrasebookTopicFilter;
  priority: PhrasebookPriorityFilter;
  regionalDiffOnly: boolean;
}

export const PART_OF_SPEECH_LABELS: Record<DictEntry["partOfSpeech"], string> = {
  noun: "Noun",
  verb: "Verb",
  adj: "Adjective",
  phrase: "Short Phrase",
  pronoun: "Pronoun",
  number: "Number",
  particle: "Particle",
};

export const PHRASEBOOK_CATEGORIES: readonly PhraseCategory[] = PHRASE_CATEGORIES;

export const PHRASEBOOK_PARTS_OF_SPEECH: DictEntry["partOfSpeech"][] = [
  "noun",
  "verb",
  "adj",
  "phrase",
  "pronoun",
  "number",
  "particle",
];

function hasRegionalDifference(north: string, central: string, south: string): boolean {
  const n = normalizeText(north);
  const c = normalizeText(central);
  const s = normalizeText(south);
  return n !== c || n !== s || c !== s;
}

export function buildPersonalPhrasebook(
  phrases: Phrase[],
  starredWords: StarredWordRecord[],
  dictionaryEntries: DictEntry[] = DICTIONARY_ENTRIES,
): PhrasebookItem[] {
  const items: PhrasebookItem[] = [];

  for (const phrase of phrases) {
    if (!phrase.isStarred) continue;
    items.push({
      uid: `phrase:${phrase.id}`,
      id: phrase.id,
      kind: "phrase",
      english: phrase.english,
      north: phrase.north,
      central: phrase.central,
      south: phrase.south,
      phoneticNorth: phrase.phoneticNorth,
      phoneticCentral: phrase.phoneticCentral,
      phoneticSouth: phrase.phoneticSouth,
      topicKey: phrase.category,
      topicLabel: phrase.category,
      note: phrase.streetNote,
      textbook: phrase.textbook,
      priority: phrase.priority,
      isCustom: Boolean(phrase.isCustom),
      starredAt: phrase.starredAt ?? 0,
      hasRegionalDiff: hasRegionalDifference(phrase.north, phrase.central, phrase.south),
      aliases: [],
      phrase,
    });
  }

  const entryMap = new Map<string, DictEntry>();
  for (const entry of dictionaryEntries) {
    entryMap.set(entry.id, entry);
  }

  for (const record of starredWords) {
    const entry = entryMap.get(record.entryId);
    if (!entry) continue;
    const north = getDictionaryEntryText(entry, "north");
    const central = getDictionaryEntryText(entry, "central");
    const south = getDictionaryEntryText(entry, "south");
    items.push({
      uid: `word:${entry.id}`,
      id: entry.id,
      kind: "word",
      english: entry.en,
      north,
      central,
      south,
      phoneticNorth: approximateVietnamesePhonetic(north, "north"),
      phoneticCentral: approximateVietnamesePhonetic(central, "central"),
      phoneticSouth: approximateVietnamesePhonetic(south, "south"),
      topicKey: entry.partOfSpeech,
      topicLabel: PART_OF_SPEECH_LABELS[entry.partOfSpeech],
      note: entry.note,
      isCustom: false,
      starredAt: record.starredAt,
      hasRegionalDiff: hasRegionalDifference(north, central, south),
      aliases: entry.aliases ?? [],
      entry,
    });
  }

  return items;
}

export function getPhrasebookItemText(item: PhrasebookItem, region: DialectRegion): string {
  if (item.phrase) return getPhraseText(item.phrase, region);
  if (region === "north") return item.north;
  if (region === "central") return item.central;
  return item.south;
}

export function getPhrasebookItemPhonetic(item: PhrasebookItem, region: DialectRegion): string {
  if (item.phrase) return getPhrasePhonetic(item.phrase, region);
  if (region === "north") return item.phoneticNorth;
  if (region === "central") return item.phoneticCentral;
  return item.phoneticSouth;
}

export interface PhraseFilters {
  search: string;
  category: "All" | PhraseCategory;
  priority: "all" | PhrasePriority;
  starredOnly: boolean;
}

function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function matchesSearchTokens(
  fields: readonly (string | undefined)[],
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return true;
  const haystack = fields
    .map((field) => (field ? normalizeText(field) : ""))
    .filter(Boolean)
    .join(" ");
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

export function matchesPhraseKeywordSearch(phrase: Phrase, query: string): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;
  return matchesSearchTokens(
    [
      phrase.english,
      phrase.north,
      phrase.central,
      phrase.south,
      phrase.phoneticNorth,
      phrase.phoneticCentral,
      phrase.phoneticSouth,
      phrase.streetNote,
      phrase.textbook,
      phrase.category,
    ],
    tokens,
  );
}

export function filterPhrases(phrases: Phrase[], filters: PhraseFilters): Phrase[] {
  const tokens = tokenizeSearchQuery(filters.search);
  return phrases.filter((phrase) => {
    if (filters.starredOnly && !phrase.isStarred) return false;
    if (filters.category !== "All" && phrase.category !== filters.category) return false;
    if (filters.priority !== "all" && phrase.priority !== filters.priority) return false;
    if (tokens.length === 0) return true;
    return matchesSearchTokens(
      [
        phrase.english,
        phrase.north,
        phrase.central,
        phrase.south,
        phrase.phoneticNorth,
        phrase.phoneticCentral,
        phrase.phoneticSouth,
        phrase.streetNote,
        phrase.textbook,
        phrase.category,
      ],
      tokens,
    );
  });
}

function matchesSearchQuery(item: PhrasebookItem, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  return matchesSearchTokens(
    [
      item.english,
      item.north,
      item.central,
      item.south,
      item.phoneticNorth,
      item.phoneticCentral,
      item.phoneticSouth,
      item.note,
      item.textbook,
      item.topicLabel,
      ...item.aliases,
    ],
    tokens,
  );
}

function matchesPriorityFilter(item: PhrasebookItem, priority: PhrasebookPriorityFilter): boolean {
  if (priority === "all") return true;
  if (priority === "custom") return item.isCustom;
  return item.kind === "phrase" && item.priority === priority;
}

function matchesPhrasebookFilters(
  item: PhrasebookItem,
  filters: PhrasebookFilters,
  tokens: readonly string[],
): boolean {
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.topic !== "all" && item.topicKey !== filters.topic) return false;
  if (!matchesPriorityFilter(item, filters.priority)) return false;
  if (filters.regionalDiffOnly && !item.hasRegionalDiff) return false;
  return matchesSearchQuery(item, tokens);
}

export function filterPersonalPhrasebook(
  items: PhrasebookItem[],
  filters: PhrasebookFilters,
): PhrasebookItem[] {
  const tokens = tokenizeSearchQuery(filters.search);
  return items.filter((item) => matchesPhrasebookFilters(item, filters, tokens));
}

function compareByNewest(a: PhrasebookItem, b: PhrasebookItem): number {
  if (b.starredAt !== a.starredAt) return b.starredAt - a.starredAt;
  return a.english.localeCompare(b.english, "en");
}

function compareByOldest(a: PhrasebookItem, b: PhrasebookItem): number {
  if (a.starredAt !== b.starredAt) return a.starredAt - b.starredAt;
  return a.english.localeCompare(b.english, "en");
}

function compareByVi(a: PhrasebookItem, b: PhrasebookItem, region: DialectRegion): number {
  const cmp = getPhrasebookItemText(a, region).localeCompare(
    getPhrasebookItemText(b, region),
    "vi",
  );
  return cmp !== 0 ? cmp : a.english.localeCompare(b.english, "en");
}

function compareByEn(a: PhrasebookItem, b: PhrasebookItem, region: DialectRegion): number {
  const cmp = a.english.localeCompare(b.english, "en");
  if (cmp !== 0) return cmp;
  return getPhrasebookItemText(a, region).localeCompare(getPhrasebookItemText(b, region), "vi");
}

function compareByPriority(a: PhrasebookItem, b: PhrasebookItem): number {
  const pA = a.priority ?? 0;
  const pB = b.priority ?? 0;
  if (pB !== pA) return pB - pA;
  return compareByNewest(a, b);
}

function compareByCategory(a: PhrasebookItem, b: PhrasebookItem, region: DialectRegion): number {
  const cmp = a.topicLabel.localeCompare(b.topicLabel, "en");
  if (cmp !== 0) return cmp;
  return getPhrasebookItemText(a, region).localeCompare(getPhrasebookItemText(b, region), "vi");
}

export function sortPersonalPhrasebook(
  items: PhrasebookItem[],
  sortBy: PhrasebookSortOption,
  region: DialectRegion,
): PhrasebookItem[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case "starred-newest":
        return compareByNewest(a, b);
      case "starred-oldest":
        return compareByOldest(a, b);
      case "vi-asc":
        return compareByVi(a, b, region);
      case "en-asc":
        return compareByEn(a, b, region);
      case "priority-desc":
        return compareByPriority(a, b);
      case "category-asc":
        return compareByCategory(a, b, region);
      default:
        return 0;
    }
  });
}
