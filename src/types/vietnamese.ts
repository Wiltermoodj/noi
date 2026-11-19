export type DialectRegion = "north" | "central" | "south";

export const DIALECT_REGIONS: readonly DialectRegion[] = ["north", "central", "south"];

export type PhrasePriority = 3 | 2 | 1; // 3 = High, 2 = Normal, 1 = Learned

export type ReviewOutcome = "again" | "good" | "mastered";

export type PhraseCategory =
  | "Coffee & Food"
  | "Markets & Shopping"
  | "Getting Around"
  | "Conversation"
  | "Politeness & Pronouns"
  | "Numbers & Time";

export const PHRASE_CATEGORIES: readonly PhraseCategory[] = [
  "Coffee & Food",
  "Markets & Shopping",
  "Getting Around",
  "Conversation",
  "Politeness & Pronouns",
  "Numbers & Time",
];

export type StudyScope = "due" | "high" | "starred" | "all";

export interface PhraseReviewState {
  reviewCount: number;
  streak: number;
  lastReviewedAt?: number | undefined;
  nextReviewAt?: number | undefined;
  bestPracticeAccuracy?: number | undefined;
}

export interface Phrase {
  id: string;
  category: PhraseCategory;
  english: string;
  north: string;
  central: string;
  south: string;
  phoneticNorth: string;
  phoneticCentral: string;
  phoneticSouth: string;
  textbook: string;
  streetNote: string;
  priority: PhrasePriority;
  sortOrder: number;
  isCustom?: boolean | undefined;
  isStarred?: boolean | undefined;
  starredAt?: number | undefined;
  review?: PhraseReviewState | undefined;
}

export interface StarredWordRecord {
  entryId: string;
  starredAt: number;
}

export type PhrasebookItemKind = "phrase" | "word";
export type PhrasebookKindFilter = "all" | PhrasebookItemKind;
export type PhrasebookSortOption =
  | "starred-newest"
  | "starred-oldest"
  | "vi-asc"
  | "en-asc"
  | "priority-desc"
  | "category-asc";

export interface StudyStats {
  total: number;
  dueCount: number;
  highCount: number;
  masteredCount: number;
  starredCount: number;
  starredPhraseCount: number;
}

export interface PhrasebookItem {
  uid: string;
  id: string;
  kind: PhrasebookItemKind;
  english: string;
  north: string;
  central: string;
  south: string;
  phoneticNorth: string;
  phoneticCentral: string;
  phoneticSouth: string;
  topicKey: PhraseCategory | DictEntry["partOfSpeech"];
  topicLabel: string;
  note: string;
  textbook?: string | undefined;
  priority?: PhrasePriority | undefined;
  isCustom: boolean;
  starredAt: number;
  hasRegionalDiff: boolean;
  aliases: string[];
  phrase?: Phrase | undefined;
  entry?: DictEntry | undefined;
}

export interface DictEntry {
  id: string;
  en: string;
  vi: string;
  north?: string | undefined;
  central?: string | undefined;
  south?: string | undefined;
  partOfSpeech: "noun" | "verb" | "adj" | "phrase" | "pronoun" | "number" | "particle";
  note: string;
  aliases?: string[] | undefined;
}

export interface TranslationBreakdown {
  startIndex: number;
  sourceToken: string;
  targetText: string;
  entry: DictEntry;
}

export interface NumericInterpretation {
  value: number;
  kind: "number" | "vnd";
  displayLabel: string;
}

export interface TranslationResult {
  query: string;
  direction: "en-vi" | "vi-en";
  primaryTranslation: string;
  regionalVariants?:
    | {
        north: string;
        central: string;
        south: string;
      }
    | undefined;
  phonetic?: string | undefined;
  streetNote?: string | undefined;
  matchedPhrases: Phrase[];
  dictionaryMatches: DictEntry[];
  wordBreakdown: TranslationBreakdown[];
  unmatchedTokens: string[];
  isCompositional: boolean;
  numericInterpretation?: NumericInterpretation | undefined;
}

export type TtsSourceMode = "cloud-first" | "device-only";
export type TtsVoiceProfile = "auto" | "female" | "male";

export const MIN_PLAYBACK_SPEED = 10;
export const MAX_PLAYBACK_SPEED = 100;
export const DEFAULT_PLAYBACK_SPEED = 100;

export interface AppSettings {
  region: DialectRegion;
  autoPlayBoth: boolean;
  playbackSpeed: number;
  slowVietnamese: boolean;
  ttsSource: TtsSourceMode;
  ttsVoiceProfile: TtsVoiceProfile;
  preferredViVoiceURI: string;
  preferredEnVoiceURI: string;
}

export const DIALECT_META: Record<
  DialectRegion,
  {
    label: string;
    regionName: string;
    cities: string;
    fullRegionLabel: string;
    accentHint: string;
    pronunciationFocus: string;
  }
> = {
  north: {
    label: "North",
    regionName: "Northern",
    cities: "Hà Nội",
    fullRegionLabel: "Northern Vietnam (Hanoi)",
    accentHint: 'Crisp 6-tone clarity; d/gi/r sound like "z"; ends phrases with nhé or thế.',
    pronunciationFocus:
      'Distinct 6 tones (hỏi vs. ngã stay separate); d, gi, and r merge to "z"; tr/ch and s/x often soften.',
  },
  central: {
    label: "Central",
    regionName: "Central",
    cities: "Huế · Đà Nẵng",
    fullRegionLabel: "Central Vietnam (Da Nang · Hue)",
    accentHint: "Distinctive local words like ni (this), rứa (so/like that), chi (what), nỏ (no).",
    pronunciationFocus:
      'Strong rhythmic vowels; d and gi sound like "y" while r stays tapped; hỏi and ngã often merge; -nh/-ch soften toward -n/-t.',
  },
  south: {
    label: "South",
    regionName: "Southern",
    cities: "Sài Gòn",
    fullRegionLabel: "Southern Vietnam (Ho Chi Minh City)",
    accentHint: 'Soft relaxed tones; d/gi/v sound like "y"; uses nha, hông, mắc, and quẹo.',
    pronunciationFocus:
      'Hỏi and ngã merge into one dipping-rising tone; d, gi, and v sound like "y"; -nh/-ch soften to -n/-t.',
  },
};

export const PRIORITY_LABELS: Record<PhrasePriority, string> = {
  3: "High",
  2: "Normal",
  1: "Learned",
};
