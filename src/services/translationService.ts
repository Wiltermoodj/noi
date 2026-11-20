import { DICTIONARY_ENTRIES } from "../data/dictionary";
import type {
  DialectRegion,
  DictEntry,
  Phrase,
  TranslationBreakdown,
  TranslationResult,
} from "../types/vietnamese";
import { getPhrasePhonetic, getPhraseText } from "./storageService";
import { approximateVietnamesePhonetic } from "./toneAudioService";
import { translateNumericQuery } from "./vietnameseNumbers";

const COMMON_UNACCENTED_VI = new Set([
  "anh",
  "chi",
  "em",
  "oi",
  "nha",
  "nhe",
  "hong",
  "khong",
  "tinh",
  "tien",
  "bao",
  "nhieu",
  "ca",
  "phe",
  "sua",
  "da",
  "tra",
  "pho",
  "banh",
  "mi",
  "ngon",
  "qua",
  "troi",
  "mac",
  "dat",
  "bot",
  "chut",
  "di",
  "cho",
  "xuong",
  "day",
  "duoc",
  "roi",
  "cam",
  "on",
  "xin",
  "loi",
  "chao",
  "queo",
  "trai",
  "phai",
  "thang",
  "o",
  "dau",
  "mo",
  "rua",
  "ni",
  "no",
  "chuc",
  "ngan",
  "nghin",
  "muoi",
  "tram",
  "trieu",
  "ruoi",
  "nau",
  "coc",
  "ly",
  "bat",
  "to",
  "bun",
  "com",
  "lau",
  "xoi",
  "che",
  "goi",
  "cuon",
  "nuong",
  "chien",
  "xao",
  "hap",
  "luoc",
  "mam",
  "tuong",
  "chanh",
  "toi",
  "hanh",
  "tieu",
  "muc",
  "cua",
  "tom",
  "vit",
  "suon",
  "chuoi",
  "buoi",
  "thom",
  "bap",
  "chua",
  "dang",
  "gion",
  "xeo",
  "quang",
  "trung",
  "rau",
  "ot",
  "thit",
  "heo",
  "lon",
  "ga",
  "ngot",
  "cay",
  "doi",
  "khat",
  "chay",
  "nuoc",
  "dua",
  "chu",
  "bac",
  "ong",
  "nguoi",
  "tai",
  "nua",
  "hom",
  "ngay",
  "dem",
  "tuan",
  "som",
  "muon",
  "tre",
  "phong",
  "chia",
  "khoa",
  "tang",
  "dieu",
  "lanh",
  "quat",
  "khan",
  "tam",
  "chan",
  "giat",
  "chieu",
  "sach",
  "yen",
  "ngo",
  "kiet",
  "hem",
  "duong",
  "cau",
  "quan",
  "tiem",
  "sieu",
  "thi",
  "cong",
  "vien",
  "song",
  "nui",
  "ben",
  "tau",
  "xe",
  "giuong",
  "nam",
  "non",
  "hiem",
  "ngoi",
  "ghe",
  "gui",
  "giu",
  "quay",
  "vong",
  "mua",
  "nang",
  "kem",
  "chong",
  "sot",
  "bung",
  "thuoc",
  "benh",
  "khach",
  "san",
  "giay",
  "dep",
  "kinh",
  "mau",
  "trang",
  "xanh",
  "nho",
  "moi",
  "ky",
  "thu",
  "mien",
  "phi",
  "sinh",
  "mia",
  "mit",
  "gung",
  "chup",
  "hinh",
  "xem",
  "coi",
  "tim",
  "kiem",
  "biet",
  "thich",
  "quen",
  "ngu",
  "nghi",
  "met",
  "vui",
  "nhanh",
  "tuoi",
  "giong",
  "khac",
  "viet",
  "giup",
  "dum",
  "gium",
  "lac",
  "xai",
  "dung",
  "xang",
  "pha",
  "ket",
  "tac",
  "thung",
  "lop",
  "xiu",
  "yaourt",
  "nanh",
  "ep",
  "te",
  "cham",
  "vai",
  "nhan",
  "mang",
  "chom",
  "khoai",
  "que",
  "lui",
  "suat",
  "phan",
  "xinh",
  "vach",
  "thuc",
  "boa",
  "nem",
  "mung",
  "phu",
  "chai",
  "guong",
  "kieng",
  "moc",
  "mui",
  "rop",
  "khau",
  "kham",
  "nhiet",
  "ke",
  "lua",
  "vang",
  "keo",
  "rong",
  "nghe",
  "chon",
  "dong",
  "uot",
  "kho",
  "ranh",
  "thuong",
  "chau",
  "tui",
  "cuoi",
  "nhat",
  "trua",
  "truoc",
  "sau",
  "rieu",
  "loc",
  "beo",
  "nhai",
  "lai",
  "ruou",
  "muop",
  "giam",
  "vinh",
  "thac",
  "ruong",
  "noi",
  "khu",
  "hoi",
  "chuyen",
  "hai",
  "gio",
  "suong",
  "mu",
  "lut",
  "ngap",
  "hoang",
  "hon",
  "binh",
  "minh",
  "canh",
  "hoan",
  "huy",
  "cuc",
  "sac",
  "khoan",
  "ho",
  "khuyen",
  "huong",
  "nhang",
  "nen",
  "quet",
  "rac",
  "voi",
  "tu",
  "sanh",
  "tret",
  "keu",
  "ruoc",
  "gioi",
  "thieu",
  "hao",
  "lang",
  "thoai",
  "mai",
  "tieng",
  "truyen",
  "thong",
  "cao",
  "thap",
  "dai",
  "trong",
  "vo",
  "dzo",
  "cung",
  "lien",
  "luon",
  "thoang",
  "thinh",
]);

const IGNORED_GLUE_WORDS = new Set(["the", "is", "are", "am", "of", "to", "in", "on", "at"]);

const MAX_NORMALIZE_CACHE_SIZE = 4096;
const normalizeTextCache = new Map<string, string>();

export function normalizeText(text: string): string {
  if (!text) return "";
  const cached = normalizeTextCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  const normalized = text
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizeTextCache.size >= MAX_NORMALIZE_CACHE_SIZE) {
    const oldestKey = normalizeTextCache.keys().next().value;
    if (oldestKey !== undefined) {
      normalizeTextCache.delete(oldestKey);
    }
  }
  normalizeTextCache.set(text, normalized);
  return normalized;
}

interface IndexedDictEntry {
  enNorm: string;
  enCleanNorm: string;
  viNorm: string;
  northNorm: string;
  centralNorm: string;
  southNorm: string;
  aliasNorms: string[];
  viFormsNorm: string[];
  sliceViFormsNorm: string[];
  filterHaystack: string;
}

const dictEntryIndexCache = new WeakMap<DictEntry, IndexedDictEntry>();

function getIndexedDictEntry(entry: DictEntry): IndexedDictEntry {
  const existing = dictEntryIndexCache.get(entry);
  if (existing) return existing;

  const enNorm = normalizeText(entry.en);
  const enCleanNorm = normalizeText(entry.en.replace(/\([^)]*\)/g, ""));
  const viNorm = normalizeText(entry.vi);
  const northNorm = entry.north ? normalizeText(entry.north) : "";
  const centralNorm = entry.central ? normalizeText(entry.central) : "";
  const southNorm = entry.south ? normalizeText(entry.south) : "";
  const aliasNorms = (entry.aliases ?? []).map(normalizeText);
  const viFormsNorm = [viNorm, northNorm, centralNorm, southNorm].filter((s) => s.length > 0);
  const baseVi = (entry.vi.split("•")[0] ?? entry.vi).replace(/\([^)]*\)/g, "");
  const sliceViFormsNorm = [northNorm, centralNorm, southNorm, normalizeText(baseVi)].filter(
    (s) => s.length > 0,
  );
  const filterHaystack = [enNorm, viNorm, northNorm, centralNorm, southNorm, ...aliasNorms]
    .filter(Boolean)
    .join("\n");

  const indexed: IndexedDictEntry = {
    enNorm,
    enCleanNorm,
    viNorm,
    northNorm,
    centralNorm,
    southNorm,
    aliasNorms,
    viFormsNorm,
    sliceViFormsNorm,
    filterHaystack,
  };
  dictEntryIndexCache.set(entry, indexed);
  return indexed;
}

let enViSliceLookupMap: Map<string, DictEntry> | null = null;
let viEnSliceLookupMap: Map<string, DictEntry> | null = null;

function ensureSliceLookupMaps(): {
  enVi: Map<string, DictEntry>;
  viEn: Map<string, DictEntry>;
} {
  if (enViSliceLookupMap && viEnSliceLookupMap) {
    return { enVi: enViSliceLookupMap, viEn: viEnSliceLookupMap };
  }

  const enVi = new Map<string, DictEntry>();
  const viEn = new Map<string, DictEntry>();

  for (const entry of DICTIONARY_ENTRIES) {
    const idx = getIndexedDictEntry(entry);
    if (idx.enCleanNorm && !enVi.has(idx.enCleanNorm)) {
      enVi.set(idx.enCleanNorm, entry);
    }
    for (const alias of idx.aliasNorms) {
      if (alias && !enVi.has(alias)) {
        enVi.set(alias, entry);
      }
    }
    for (const form of idx.sliceViFormsNorm) {
      if (form && !viEn.has(form)) {
        viEn.set(form, entry);
      }
    }
  }

  enViSliceLookupMap = enVi;
  viEnSliceLookupMap = viEn;
  return { enVi, viEn };
}

export function detectDirection(query: string): "en-vi" | "vi-en" {
  const hasVietnameseDiacritics =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(query);
  if (hasVietnameseDiacritics) return "vi-en";

  const norm = normalizeText(query);
  const tokens = norm.split(" ").filter(Boolean);
  const viHits = tokens.filter((t) => COMMON_UNACCENTED_VI.has(t)).length;
  if (tokens.length > 0 && viHits / tokens.length >= 0.5) {
    return "vi-en";
  }
  return "en-vi";
}

export function getDictionaryEntryText(entry: DictEntry, region: DialectRegion): string {
  if (region === "north" && entry.north) return entry.north;
  if (region === "central" && entry.central) return entry.central;
  if (region === "south" && entry.south) return entry.south;
  const firstSegment = entry.vi.split("•")[0] ?? entry.vi;
  return firstSegment.replace(/\s*\([NCS/]+\)/g, "").trim();
}

export function filterDictionaryEntries(
  filterQuery: string,
  entries: DictEntry[] = DICTIONARY_ENTRIES,
  partOfSpeech: "all" | DictEntry["partOfSpeech"] = "all",
): DictEntry[] {
  const q = normalizeText(filterQuery);
  return entries.filter((entry) => {
    if (partOfSpeech !== "all" && entry.partOfSpeech !== partOfSpeech) return false;
    if (!q) return true;
    return getIndexedDictEntry(entry).filterHaystack.includes(q);
  });
}

function scoreEnglishPhrase(normQuery: string, enNorm: string): number {
  if (enNorm === normQuery) return 100;
  if (enNorm.includes(normQuery)) return 75;
  if (normQuery.includes(enNorm)) return 70;
  const qWords = normQuery.split(" ");
  const hits = qWords.filter((w) => w.length > 2 && enNorm.includes(w)).length;
  return hits > 0 ? (hits / qWords.length) * 55 : 0;
}

function scoreVietnamesePhrase(normQuery: string, variants: string[]): number {
  if (variants.some((v) => v === normQuery)) return 100;
  if (variants.some((v) => v.includes(normQuery))) return 78;
  if (variants.some((v) => normQuery.includes(v))) return 72;
  const qWords = normQuery.split(" ");
  const bestHits = Math.max(
    ...variants.map((v) => qWords.filter((w) => w.length >= 2 && v.includes(w)).length),
  );
  return bestHits > 0 ? (bestHits / qWords.length) * 55 : 0;
}

interface IndexedPhrase {
  enNorm: string;
  variantsNorm: [string, string, string];
}

const phraseIndexCache = new WeakMap<Phrase, IndexedPhrase>();

function getIndexedPhrase(phrase: Phrase): IndexedPhrase {
  const cached = phraseIndexCache.get(phrase);
  if (cached) return cached;
  const indexed: IndexedPhrase = {
    enNorm: normalizeText(phrase.english),
    variantsNorm: [
      normalizeText(phrase.north),
      normalizeText(phrase.central),
      normalizeText(phrase.south),
    ],
  };
  phraseIndexCache.set(phrase, indexed);
  return indexed;
}

export function findMatchingLibraryPhrase(
  phrases: Phrase[],
  enText: string,
  viText: string,
  region: DialectRegion,
): Phrase | undefined {
  const normEn = normalizeText(enText);
  const normVi = normalizeText(viText);
  const regionIdx = region === "north" ? 0 : region === "central" ? 1 : 2;
  return phrases.find((phrase) => {
    const indexed = getIndexedPhrase(phrase);
    return (
      (normEn.length > 0 && indexed.enNorm === normEn) ||
      (normVi.length > 0 &&
        (indexed.variantsNorm[regionIdx] === normVi || indexed.variantsNorm.includes(normVi)))
    );
  });
}

function findMatchedPhrases(
  normQuery: string,
  direction: "en-vi" | "vi-en",
  phrases: Phrase[],
): { phrase: Phrase; score: number }[] {
  const matched: { phrase: Phrase; score: number }[] = [];
  for (const phrase of phrases) {
    const indexed = getIndexedPhrase(phrase);
    const score =
      direction === "en-vi"
        ? scoreEnglishPhrase(normQuery, indexed.enNorm)
        : scoreVietnamesePhrase(normQuery, indexed.variantsNorm);
    if (score >= 30) {
      matched.push({ phrase, score });
    }
  }
  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, 4);
}

function scoreDictEntry(normQuery: string, direction: "en-vi" | "vi-en", entry: DictEntry): number {
  const indexed = getIndexedDictEntry(entry);
  if (direction === "en-vi") {
    const { enNorm, aliasNorms } = indexed;
    if (enNorm === normQuery || aliasNorms.includes(normQuery)) return 100;
    if (enNorm.includes(normQuery) || aliasNorms.some((a) => a.includes(normQuery))) return 72;
    if (
      normQuery.includes(enNorm) ||
      aliasNorms.some((a) => a.length > 2 && normQuery.includes(a))
    ) {
      return 65;
    }
    return 0;
  }

  const { viFormsNorm } = indexed;
  if (viFormsNorm.some((v) => v === normQuery)) return 100;
  if (viFormsNorm.some((v) => v.includes(normQuery))) return 72;
  if (viFormsNorm.some((v) => v.length >= 2 && normQuery.includes(v))) return 62;
  return 0;
}

function findDictionaryMatches(
  normQuery: string,
  direction: "en-vi" | "vi-en",
): { entry: DictEntry; score: number }[] {
  return DICTIONARY_ENTRIES.map((entry) => ({
    entry,
    score: scoreDictEntry(normQuery, direction, entry),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function expandSliceCandidates(slice: string): string[] {
  const candidates = [slice];
  if (!slice.includes(" ") && slice.length > 3) {
    if (slice.endsWith("ies")) {
      candidates.push(`${slice.slice(0, -3)}y`);
    } else if (slice.endsWith("ses") || slice.endsWith("xes")) {
      candidates.push(slice.slice(0, -2));
    } else if (slice.endsWith("s") && !slice.endsWith("ss")) {
      candidates.push(slice.slice(0, -1));
    }
  }
  return candidates;
}

function findEntryMatchingSlice(
  slice: string,
  direction: "en-vi" | "vi-en",
): DictEntry | undefined {
  const { enVi, viEn } = ensureSliceLookupMaps();
  if (direction === "en-vi") {
    const candidates = expandSliceCandidates(slice);
    for (const candidate of candidates) {
      const hit = enVi.get(candidate);
      if (hit) return hit;
    }
    return undefined;
  }
  return viEn.get(slice);
}

function tryBuildNumericTokenEntry(
  slice: string,
  idx: number,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
): { targetText: string; entry: DictEntry } | null {
  const numeric = translateNumericQuery(slice, direction, region);
  if (!numeric) return null;
  const entry: DictEntry = {
    id: `num-${String(idx)}`,
    en: direction === "en-vi" ? slice : numeric.primaryTranslation,
    vi: direction === "en-vi" ? numeric.primaryTranslation : slice,
    north: numeric.regionalVariants?.north,
    central: numeric.regionalVariants?.central,
    south: numeric.regionalVariants?.south,
    partOfSpeech: "number",
    note: numeric.streetNote,
  };
  return {
    targetText: numeric.primaryTranslation,
    entry,
  };
}

function matchLongestTokenAt(
  words: string[],
  idx: number,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
): { len: number; slice: string; targetText: string; entry: DictEntry } | null {
  for (let len = Math.min(4, words.length - idx); len >= 1; len--) {
    const slice = words.slice(idx, idx + len).join(" ");
    const found = findEntryMatchingSlice(slice, direction);
    if (found) {
      const cleanEn = found.en.replace(/\s*\([^)]*\)/g, "").split("/")[0] ?? found.en;
      const targetText =
        direction === "en-vi" ? getDictionaryEntryText(found, region) : cleanEn.trim();
      return { len, slice, targetText, entry: found };
    }
    if (len === 1) {
      const numericMatch = tryBuildNumericTokenEntry(slice, idx, direction, region);
      if (numericMatch) {
        return { len: 1, slice, targetText: numericMatch.targetText, entry: numericMatch.entry };
      }
    }
  }
  return null;
}

function composeWordBreakdown(
  normQuery: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
): { breakdown: TranslationBreakdown[]; chunks: string[]; unmatchedTokens: string[] } {
  const words = normQuery.split(" ").filter(Boolean);
  const breakdown: TranslationBreakdown[] = [];
  const chunks: string[] = [];
  const unmatchedTokens: string[] = [];

  let idx = 0;
  while (idx < words.length) {
    const match = matchLongestTokenAt(words, idx, direction, region);
    if (match) {
      chunks.push(match.targetText);
      breakdown.push({
        startIndex: idx,
        sourceToken: match.slice,
        targetText: match.targetText,
        entry: match.entry,
      });
      idx += match.len;
    } else {
      const token = words[idx];
      if (token && !IGNORED_GLUE_WORDS.has(token)) {
        unmatchedTokens.push(token);
      }
      idx += 1;
    }
  }

  return { breakdown, chunks, unmatchedTokens };
}

function buildPhraseResult(
  query: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
  phrase: Phrase,
  matchedPhrases: Phrase[],
  dictionaryMatches: DictEntry[],
  wordBreakdown: TranslationBreakdown[],
): TranslationResult {
  return {
    query,
    direction,
    primaryTranslation: direction === "en-vi" ? getPhraseText(phrase, region) : phrase.english,
    regionalVariants:
      direction === "en-vi"
        ? { north: phrase.north, central: phrase.central, south: phrase.south }
        : undefined,
    phonetic: direction === "en-vi" ? getPhrasePhonetic(phrase, region) : undefined,
    streetNote: phrase.streetNote,
    matchedPhrases,
    dictionaryMatches,
    wordBreakdown,
    unmatchedTokens: [],
    isCompositional: false,
  };
}

function buildDictEntryResult(
  query: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
  entry: DictEntry,
  matchedPhrases: Phrase[],
  dictionaryMatches: DictEntry[],
  wordBreakdown: TranslationBreakdown[],
): TranslationResult {
  const hasVariants = Boolean(entry.north ?? entry.central ?? entry.south);
  const primaryTranslation =
    direction === "en-vi" ? getDictionaryEntryText(entry, region) : entry.en;
  return {
    query,
    direction,
    primaryTranslation,
    regionalVariants:
      direction === "en-vi" && hasVariants
        ? {
            north: entry.north ?? entry.vi,
            central: entry.central ?? entry.vi,
            south: entry.south ?? entry.vi,
          }
        : undefined,
    phonetic:
      direction === "en-vi" ? approximateVietnamesePhonetic(primaryTranslation, region) : undefined,
    streetNote: entry.note,
    matchedPhrases,
    dictionaryMatches,
    wordBreakdown,
    unmatchedTokens: [],
    isCompositional: false,
  };
}

function buildCompositionalResult(
  query: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
  chunks: string[],
  breakdown: TranslationBreakdown[],
  unmatchedTokens: string[],
  matchedPhrases: Phrase[],
  dictionaryMatches: DictEntry[],
): TranslationResult {
  const buildRegional = (targetRegion: DialectRegion) =>
    breakdown
      .map((b) =>
        direction === "en-vi" ? getDictionaryEntryText(b.entry, targetRegion) : b.targetText,
      )
      .join(" ");

  const primaryTranslation = chunks.join(" ");
  return {
    query,
    direction,
    primaryTranslation,
    regionalVariants:
      direction === "en-vi"
        ? {
            north: buildRegional("north"),
            central: buildRegional("central"),
            south: buildRegional("south"),
          }
        : undefined,
    phonetic:
      direction === "en-vi" ? approximateVietnamesePhonetic(primaryTranslation, region) : undefined,
    streetNote:
      breakdown.length > 1
        ? "Built word-by-word from your offline spoken vocabulary across Northern, Central, and Southern dialects."
        : breakdown[0]?.entry.note,
    matchedPhrases,
    dictionaryMatches,
    wordBreakdown: breakdown,
    unmatchedTokens,
    isCompositional: breakdown.length > 1 || unmatchedTokens.length > 0,
  };
}

function selectTranslationResult(
  query: string,
  normQuery: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
  phraseScored: { phrase: Phrase; score: number }[],
  dictScored: { entry: DictEntry; score: number }[],
  breakdown: TranslationBreakdown[],
  chunks: string[],
  unmatchedTokens: string[],
): TranslationResult {
  const matchedPhrases = phraseScored.map((m) => m.phrase);
  const dictionaryMatches = dictScored.slice(0, 6).map((d) => d.entry);

  const topPhrase = phraseScored[0];
  if (topPhrase?.score === 100) {
    return buildPhraseResult(
      query,
      direction,
      region,
      topPhrase.phrase,
      matchedPhrases,
      dictionaryMatches,
      breakdown,
    );
  }

  const topDict = dictScored[0];
  if (topDict && topDict.score >= 85 && breakdown.length <= 1 && unmatchedTokens.length === 0) {
    return buildDictEntryResult(
      query,
      direction,
      region,
      topDict.entry,
      matchedPhrases,
      dictionaryMatches,
      breakdown,
    );
  }

  const numericMatch = translateNumericQuery(normQuery, direction, region);
  if (numericMatch) {
    return {
      query,
      direction,
      primaryTranslation: numericMatch.primaryTranslation,
      regionalVariants: numericMatch.regionalVariants,
      phonetic:
        direction === "en-vi"
          ? approximateVietnamesePhonetic(numericMatch.primaryTranslation, region)
          : undefined,
      streetNote: numericMatch.streetNote,
      matchedPhrases,
      dictionaryMatches,
      wordBreakdown: [],
      unmatchedTokens: [],
      isCompositional: false,
      numericInterpretation: numericMatch.interpretation,
    };
  }

  if (topPhrase && topPhrase.score >= 70) {
    return buildPhraseResult(
      query,
      direction,
      region,
      topPhrase.phrase,
      matchedPhrases,
      dictionaryMatches,
      breakdown,
    );
  }

  if (chunks.length > 0) {
    return buildCompositionalResult(
      query,
      direction,
      region,
      chunks,
      breakdown,
      unmatchedTokens,
      matchedPhrases,
      dictionaryMatches,
    );
  }

  if (topPhrase) {
    return buildPhraseResult(
      query,
      direction,
      region,
      topPhrase.phrase,
      matchedPhrases,
      dictionaryMatches,
      [],
    );
  }

  return {
    query,
    direction,
    primaryTranslation: "",
    matchedPhrases: [],
    dictionaryMatches,
    wordBreakdown: [],
    unmatchedTokens,
    isCompositional: false,
  };
}

export function translateOffline(
  rawQuery: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
  phrases: Phrase[],
): TranslationResult | null {
  const query = rawQuery.trim();
  if (!query) return null;

  const normQuery = normalizeText(query);
  if (!normQuery) return null;

  const phraseScored = findMatchedPhrases(normQuery, direction, phrases);
  const dictScored = findDictionaryMatches(normQuery, direction);
  const { breakdown, chunks, unmatchedTokens } = composeWordBreakdown(normQuery, direction, region);

  return selectTranslationResult(
    query,
    normQuery,
    direction,
    region,
    phraseScored,
    dictScored,
    breakdown,
    chunks,
    unmatchedTokens,
  );
}

export function buildPhraseFromTranslation(
  result: TranslationResult,
  direction: "en-vi" | "vi-en",
  starred: boolean,
): Omit<Phrase, "id" | "sortOrder"> {
  const isEnToVi = direction === "en-vi";
  const en = isEnToVi ? result.query : result.primaryTranslation;
  const north = isEnToVi
    ? (result.regionalVariants?.north ?? result.primaryTranslation)
    : result.query;
  const central = isEnToVi
    ? (result.regionalVariants?.central ?? result.primaryTranslation)
    : result.query;
  const south = isEnToVi
    ? (result.regionalVariants?.south ?? result.primaryTranslation)
    : result.query;

  const normQuery = normalizeText(result.query);
  const exactMatchedPhrase = result.matchedPhrases.find((p) => {
    const indexed = getIndexedPhrase(p);
    if (isEnToVi) return indexed.enNorm === normQuery;
    return indexed.variantsNorm.includes(normQuery);
  });

  return {
    category: result.numericInterpretation ? "Numbers & Time" : "Conversation",
    english: en,
    north,
    central,
    south,
    phoneticNorth:
      exactMatchedPhrase?.phoneticNorth ?? approximateVietnamesePhonetic(north, "north"),
    phoneticCentral:
      exactMatchedPhrase?.phoneticCentral ?? approximateVietnamesePhonetic(central, "central"),
    phoneticSouth:
      exactMatchedPhrase?.phoneticSouth ?? approximateVietnamesePhonetic(south, "south"),
    textbook: exactMatchedPhrase?.textbook ?? "Saved from offline translator",
    streetNote: result.streetNote ?? "Saved from your offline translator.",
    priority: 3,
    isCustom: true,
    isStarred: starred,
    starredAt: starred ? Date.now() : undefined,
  };
}

export function buildGoogleTranslateUrl(text: string, direction: "en-vi" | "vi-en"): string {
  const sl = direction === "en-vi" ? "en" : "vi";
  const tl = direction === "en-vi" ? "vi" : "en";
  const params = new URLSearchParams({
    sl,
    tl,
    text: text.trim(),
    op: "translate",
  });
  return `https://translate.google.com/?${params.toString()}`;
}
