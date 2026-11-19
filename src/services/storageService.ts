import { INITIAL_PHRASES } from "../data/phrases";
import {
  type AppSettings,
  DEFAULT_PLAYBACK_SPEED,
  DIALECT_REGIONS,
  type DialectRegion,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  PHRASE_CATEGORIES,
  type Phrase,
  type PhrasePriority,
  type ReviewOutcome,
  type StarredWordRecord,
  type StudyScope,
  type StudyStats,
} from "../types/vietnamese";

export const PHRASES_KEY = "noi_vietnamese_phrases_v1";
export const SETTINGS_KEY = "noi_vietnamese_settings_v1";
export const STARRED_WORDS_KEY = "noi_vietnamese_starred_words_v1";
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const VALID_REGIONS = new Set<DialectRegion>(DIALECT_REGIONS);
const VALID_TTS_SOURCES = new Set<AppSettings["ttsSource"]>(["cloud-first", "device-only"]);
const VALID_VOICE_PROFILES = new Set<AppSettings["ttsVoiceProfile"]>(["auto", "female", "male"]);
const VALID_CATEGORIES = new Set<Phrase["category"]>(PHRASE_CATEGORIES);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeDialectRegion(value: unknown, fallback: DialectRegion): DialectRegion {
  return typeof value === "string" && VALID_REGIONS.has(value as DialectRegion)
    ? (value as DialectRegion)
    : fallback;
}

function sanitizeTtsSource(
  value: unknown,
  fallback: AppSettings["ttsSource"],
): AppSettings["ttsSource"] {
  return typeof value === "string" && VALID_TTS_SOURCES.has(value as AppSettings["ttsSource"])
    ? (value as AppSettings["ttsSource"])
    : fallback;
}

function sanitizeTtsVoiceProfile(
  value: unknown,
  fallback: AppSettings["ttsVoiceProfile"],
): AppSettings["ttsVoiceProfile"] {
  return typeof value === "string" &&
    VALID_VOICE_PROFILES.has(value as AppSettings["ttsVoiceProfile"])
    ? (value as AppSettings["ttsVoiceProfile"])
    : fallback;
}

function sanitizePriority(value: unknown): PhrasePriority {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return 2;
}

function sanitizeReviewStats(value: unknown): Phrase["review"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const reviewCount =
    isFiniteNumber(raw["reviewCount"]) && raw["reviewCount"] >= 0
      ? Math.round(raw["reviewCount"])
      : 0;
  const streak =
    isFiniteNumber(raw["streak"]) && raw["streak"] >= 0 ? Math.round(raw["streak"]) : 0;
  const lastReviewedAt = isFiniteNumber(raw["lastReviewedAt"]) ? raw["lastReviewedAt"] : undefined;
  const nextReviewAt = isFiniteNumber(raw["nextReviewAt"]) ? raw["nextReviewAt"] : undefined;
  const bestPracticeAccuracy = isFiniteNumber(raw["bestPracticeAccuracy"])
    ? Math.min(100, Math.max(0, Math.round(raw["bestPracticeAccuracy"])))
    : undefined;

  return {
    reviewCount,
    streak,
    ...(lastReviewedAt !== undefined ? { lastReviewedAt } : {}),
    ...(nextReviewAt !== undefined ? { nextReviewAt } : {}),
    ...(bestPracticeAccuracy !== undefined ? { bestPracticeAccuracy } : {}),
  };
}

function sanitizePhraseRecord(item: unknown, fallbackIndex: number): Phrase | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as Record<string, unknown>;
  if (
    !isNonEmptyString(raw["id"]) ||
    !isNonEmptyString(raw["english"]) ||
    !isNonEmptyString(raw["north"]) ||
    !isNonEmptyString(raw["central"]) ||
    !isNonEmptyString(raw["south"])
  ) {
    return null;
  }

  const category: Phrase["category"] =
    typeof raw["category"] === "string" &&
    VALID_CATEGORIES.has(raw["category"] as Phrase["category"])
      ? (raw["category"] as Phrase["category"])
      : "Conversation";

  const review = sanitizeReviewStats(raw["review"]);

  return {
    id: raw["id"],
    category,
    english: raw["english"],
    north: raw["north"],
    central: raw["central"],
    south: raw["south"],
    phoneticNorth: typeof raw["phoneticNorth"] === "string" ? raw["phoneticNorth"] : "",
    phoneticCentral: typeof raw["phoneticCentral"] === "string" ? raw["phoneticCentral"] : "",
    phoneticSouth: typeof raw["phoneticSouth"] === "string" ? raw["phoneticSouth"] : "",
    textbook: typeof raw["textbook"] === "string" ? raw["textbook"] : "",
    streetNote: typeof raw["streetNote"] === "string" ? raw["streetNote"] : "",
    priority: sanitizePriority(raw["priority"]),
    sortOrder: isFiniteNumber(raw["sortOrder"]) ? Math.round(raw["sortOrder"]) : fallbackIndex,
    ...(typeof raw["isCustom"] === "boolean" ? { isCustom: raw["isCustom"] } : {}),
    ...(typeof raw["isStarred"] === "boolean" ? { isStarred: raw["isStarred"] } : {}),
    ...(isFiniteNumber(raw["starredAt"]) ? { starredAt: raw["starredAt"] } : {}),
    ...(review ? { review } : {}),
  };
}

export function normalizePlaybackSpeed(value: unknown, fallback = DEFAULT_PLAYBACK_SPEED): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, Math.round(value)));
}

export const DEFAULT_SETTINGS: AppSettings = {
  region: "south",
  autoPlayBoth: false,
  playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  slowVietnamese: false,
  ttsSource: "cloud-first",
  ttsVoiceProfile: "auto",
  preferredViVoiceURI: "",
  preferredEnVoiceURI: "",
};

export function parseSettingsFromRaw(raw: string | null): AppSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_SETTINGS;
    }
    const obj = parsed as Record<string, unknown>;
    const legacySpeed = obj["slowVietnamese"] === true ? 70 : DEFAULT_PLAYBACK_SPEED;
    const playbackSpeed = normalizePlaybackSpeed(obj["playbackSpeed"], legacySpeed);
    return {
      region: sanitizeDialectRegion(obj["region"], DEFAULT_SETTINGS.region),
      autoPlayBoth:
        typeof obj["autoPlayBoth"] === "boolean"
          ? obj["autoPlayBoth"]
          : DEFAULT_SETTINGS.autoPlayBoth,
      playbackSpeed,
      slowVietnamese: playbackSpeed <= 75,
      ttsSource: sanitizeTtsSource(obj["ttsSource"], DEFAULT_SETTINGS.ttsSource),
      ttsVoiceProfile: sanitizeTtsVoiceProfile(
        obj["ttsVoiceProfile"],
        DEFAULT_SETTINGS.ttsVoiceProfile,
      ),
      preferredViVoiceURI:
        typeof obj["preferredViVoiceURI"] === "string"
          ? obj["preferredViVoiceURI"]
          : DEFAULT_SETTINGS.preferredViVoiceURI,
      preferredEnVoiceURI:
        typeof obj["preferredEnVoiceURI"] === "string"
          ? obj["preferredEnVoiceURI"]
          : DEFAULT_SETTINGS.preferredEnVoiceURI,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSettings(): AppSettings {
  try {
    return parseSettingsFromRaw(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

interface CompactPhraseOverride {
  priority: PhrasePriority;
  sortOrder: number;
  isStarred?: boolean;
  starredAt?: number;
  review?: Phrase["review"];
}

interface CompactPhrasesPayloadV2 {
  version: 2;
  overrides: Record<string, CompactPhraseOverride>;
  customPhrases: Phrase[];
}

const BUILT_IN_PHRASE_IDS = new Set(INITIAL_PHRASES.map((phrase) => phrase.id));

function sanitizeCompactOverride(item: unknown, fallback: Phrase): CompactPhraseOverride | null {
  if (typeof item !== "object" || item === null) return null;
  const raw = item as Record<string, unknown>;
  const review = sanitizeReviewStats(raw["review"]);
  return {
    priority: sanitizePriority(raw["priority"]),
    sortOrder: isFiniteNumber(raw["sortOrder"]) ? Math.round(raw["sortOrder"]) : fallback.sortOrder,
    ...(typeof raw["isStarred"] === "boolean" ? { isStarred: raw["isStarred"] } : {}),
    ...(isFiniteNumber(raw["starredAt"]) ? { starredAt: raw["starredAt"] } : {}),
    ...(review ? { review } : {}),
  };
}

export function serializePhrasesCompact(phrases: Phrase[]): CompactPhrasesPayloadV2 {
  const overrides: Record<string, CompactPhraseOverride> = {};
  const customPhrases: Phrase[] = [];

  for (const phrase of phrases) {
    if (phrase.isCustom === true || !BUILT_IN_PHRASE_IDS.has(phrase.id)) {
      customPhrases.push(phrase);
      continue;
    }

    const override: CompactPhraseOverride = {
      priority: phrase.priority,
      sortOrder: phrase.sortOrder,
      ...(typeof phrase.isStarred === "boolean" ? { isStarred: phrase.isStarred } : {}),
      ...(isFiniteNumber(phrase.starredAt) ? { starredAt: phrase.starredAt } : {}),
      ...(phrase.review ? { review: phrase.review } : {}),
    };
    overrides[phrase.id] = override;
  }

  return {
    version: 2,
    overrides,
    customPhrases,
  };
}

function collectUniqueSanitizedPhrases(
  rawItems: unknown[],
  seedExcludedIds: ReadonlySet<string> = new Set(),
): { phrases: Phrase[]; seenIds: Set<string> } {
  const seenIds = new Set<string>(seedExcludedIds);
  const phrases: Phrase[] = [];
  for (let idx = 0; idx < rawItems.length; idx++) {
    const parsedItem = sanitizePhraseRecord(rawItems[idx], idx);
    if (!parsedItem || seenIds.has(parsedItem.id)) continue;
    seenIds.add(parsedItem.id);
    phrases.push(parsedItem);
  }
  return { phrases, seenIds };
}

function parseCompactPhrasesV2(payload: Record<string, unknown>): Phrase[] {
  const rawOverrides =
    typeof payload["overrides"] === "object" && payload["overrides"] !== null
      ? (payload["overrides"] as Record<string, unknown>)
      : {};
  const rawCustom = Array.isArray(payload["customPhrases"]) ? payload["customPhrases"] : [];

  const mergedBuiltIns = INITIAL_PHRASES.map((base): Phrase => {
    const override = sanitizeCompactOverride(rawOverrides[base.id], base);
    if (!override) {
      return { ...base };
    }
    return {
      ...base,
      priority: override.priority,
      sortOrder: override.sortOrder,
      ...(override.isStarred !== undefined ? { isStarred: override.isStarred } : {}),
      ...(override.starredAt !== undefined ? { starredAt: override.starredAt } : {}),
      ...(override.review ? { review: override.review } : {}),
    };
  });

  const { phrases: customPhrases } = collectUniqueSanitizedPhrases(rawCustom, BUILT_IN_PHRASE_IDS);
  return sortPhrasesForStudy([...mergedBuiltIns, ...customPhrases]);
}

function parseLegacyPhrasesV1(saved: unknown[]): Phrase[] {
  if (saved.length === 0) {
    return sortPhrasesForStudy(INITIAL_PHRASES);
  }
  const { phrases: sanitized, seenIds } = collectUniqueSanitizedPhrases(saved);
  if (sanitized.length === 0) {
    return sortPhrasesForStudy(INITIAL_PHRASES);
  }
  const additions = INITIAL_PHRASES.filter((p) => !seenIds.has(p.id)).map((p, idx) => ({
    ...p,
    sortOrder: sanitized.length + idx,
  }));
  return sortPhrasesForStudy([...sanitized, ...additions]);
}

export function parsePhrasesFromRaw(raw: string | null): Phrase[] {
  if (!raw) {
    return sortPhrasesForStudy(INITIAL_PHRASES);
  }
  try {
    const saved = JSON.parse(raw) as unknown;

    if (
      typeof saved === "object" &&
      saved !== null &&
      !Array.isArray(saved) &&
      (saved as Record<string, unknown>)["version"] === 2
    ) {
      return parseCompactPhrasesV2(saved as Record<string, unknown>);
    }

    if (!Array.isArray(saved)) {
      return sortPhrasesForStudy(INITIAL_PHRASES);
    }
    return parseLegacyPhrasesV1(saved);
  } catch {
    return sortPhrasesForStudy(INITIAL_PHRASES);
  }
}

export function loadPhrases(): Phrase[] {
  try {
    return parsePhrasesFromRaw(localStorage.getItem(PHRASES_KEY));
  } catch {
    return sortPhrasesForStudy(INITIAL_PHRASES);
  }
}

export function savePhrases(phrases: Phrase[]): boolean {
  try {
    localStorage.setItem(PHRASES_KEY, JSON.stringify(serializePhrasesCompact(phrases)));
    return true;
  } catch {
    return false;
  }
}

export function parseStarredWordsFromRaw(raw: string | null): StarredWordRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const byId = new Map<string, StarredWordRecord>();
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as StarredWordRecord).entryId === "string" &&
        isFiniteNumber((item as StarredWordRecord).starredAt)
      ) {
        const record = item as StarredWordRecord;
        const existing = byId.get(record.entryId);
        if (!existing || record.starredAt > existing.starredAt) {
          byId.set(record.entryId, record);
        }
      }
    }
    return Array.from(byId.values());
  } catch {
    return [];
  }
}

export function loadStarredWords(): StarredWordRecord[] {
  try {
    return parseStarredWordsFromRaw(localStorage.getItem(STARRED_WORDS_KEY));
  } catch {
    return [];
  }
}

export function saveStarredWords(records: StarredWordRecord[]): boolean {
  try {
    localStorage.setItem(STARRED_WORDS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function exportSavedAppStateJson(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: "noi-vietnamese",
      version: 2,
      settings: loadSettings(),
      phrases: serializePhrasesCompact(loadPhrases()),
      starredWords: loadStarredWords(),
    },
    null,
    2,
  );
}

export interface ImportedAppState {
  settings: AppSettings;
  phrases: Phrase[];
  starredWords: StarredWordRecord[];
}

export type ImportAppStateResult = ({ ok: true } & ImportedAppState) | { ok: false; error: string };

export function importSavedAppStateJson(rawJson: string): ImportAppStateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: "Backup file is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Backup file format is not recognized." };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj["app"] !== undefined && obj["app"] !== "noi-vietnamese") {
    return { ok: false, error: "Backup file does not belong to Nói." };
  }

  const hasKnownSection =
    obj["phrases"] !== undefined ||
    obj["settings"] !== undefined ||
    obj["starredWords"] !== undefined;
  if (!hasKnownSection) {
    return { ok: false, error: "Backup file contains no Nói data." };
  }

  const settings =
    obj["settings"] !== undefined
      ? parseSettingsFromRaw(JSON.stringify(obj["settings"]))
      : loadSettings();
  const phrases =
    obj["phrases"] !== undefined
      ? parsePhrasesFromRaw(JSON.stringify(obj["phrases"]))
      : loadPhrases();
  const starredWords =
    obj["starredWords"] !== undefined
      ? parseStarredWordsFromRaw(JSON.stringify(obj["starredWords"]))
      : loadStarredWords();

  const readRawSnapshot = (key: string): string | null => {
    try {
      return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
        ? localStorage.getItem(key)
        : null;
    } catch {
      return null;
    }
  };
  const restoreRawSnapshot = (key: string, prev: string | null): void => {
    try {
      if (typeof localStorage === "undefined") return;
      if (prev === null) {
        if (typeof localStorage.removeItem === "function") {
          localStorage.removeItem(key);
        }
      } else {
        localStorage.setItem(key, prev);
      }
    } catch {
      // Ignore rollback errors when storage is completely full
    }
  };

  const prevSettingsRaw = readRawSnapshot(SETTINGS_KEY);
  const prevPhrasesRaw = readRawSnapshot(PHRASES_KEY);
  const prevStarredRaw = readRawSnapshot(STARRED_WORDS_KEY);

  const savedAll = saveSettings(settings) && savePhrases(phrases) && saveStarredWords(starredWords);
  if (!savedAll) {
    restoreRawSnapshot(SETTINGS_KEY, prevSettingsRaw);
    restoreRawSnapshot(PHRASES_KEY, prevPhrasesRaw);
    restoreRawSnapshot(STARRED_WORDS_KEY, prevStarredRaw);
    return {
      ok: false,
      error: "Browser storage is full — unable to save restored backup.",
    };
  }

  return {
    ok: true,
    settings,
    phrases,
    starredWords,
  };
}

function mergeReviewStats(
  localReview: Phrase["review"],
  incomingReview: Phrase["review"],
): Phrase["review"] {
  if (!localReview) return incomingReview;
  if (!incomingReview) return localReview;

  const localLast = localReview.lastReviewedAt ?? 0;
  const incomingLast = incomingReview.lastReviewedAt ?? 0;
  const preferIncoming =
    incomingReview.reviewCount > localReview.reviewCount ||
    (incomingReview.reviewCount === localReview.reviewCount && incomingLast > localLast);

  const primary = preferIncoming ? incomingReview : localReview;
  const maxPractice = Math.max(
    localReview.bestPracticeAccuracy ?? 0,
    incomingReview.bestPracticeAccuracy ?? 0,
  );
  const hasPractice =
    localReview.bestPracticeAccuracy !== undefined ||
    incomingReview.bestPracticeAccuracy !== undefined;

  return {
    ...primary,
    ...(hasPractice ? { bestPracticeAccuracy: maxPractice } : {}),
  };
}

export function mergePhrasesFromStorage(
  localPhrases: Phrase[],
  incomingPhrases: Phrase[],
): Phrase[] {
  const localById = new Map(localPhrases.map((p) => [p.id, p]));
  const incomingById = new Map(incomingPhrases.map((p) => [p.id, p]));
  const merged: Phrase[] = [];

  for (const incoming of incomingPhrases) {
    const local = localById.get(incoming.id);
    if (!local) {
      merged.push(incoming);
      continue;
    }
    const mergedReview = mergeReviewStats(local.review, incoming.review);
    const preferIncomingState =
      (incoming.review?.lastReviewedAt ?? 0) >= (local.review?.lastReviewedAt ?? 0);
    merged.push({
      ...(preferIncomingState ? incoming : local),
      ...(mergedReview ? { review: mergedReview } : {}),
      ...(incoming.isStarred !== undefined
        ? { isStarred: incoming.isStarred, starredAt: incoming.starredAt }
        : {}),
    });
  }

  for (const local of localPhrases) {
    if (
      !incomingById.has(local.id) &&
      (local.isCustom === true || !BUILT_IN_PHRASE_IDS.has(local.id))
    ) {
      merged.push(local);
    }
  }

  return sortPhrasesForStudy(merged);
}

export function mergeStarredWordsFromStorage(
  local: StarredWordRecord[],
  incoming: StarredWordRecord[],
): StarredWordRecord[] {
  const byId = new Map<string, StarredWordRecord>();
  for (const item of incoming) {
    byId.set(item.entryId, item);
  }
  for (const item of local) {
    const existing = byId.get(item.entryId);
    if (!existing || item.starredAt > existing.starredAt) {
      byId.set(item.entryId, item);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.starredAt - a.starredAt);
}

export function clearSavedAppState(): void {
  try {
    localStorage.removeItem(PHRASES_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(STARRED_WORDS_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export function toggleWordStarInList(
  records: StarredWordRecord[],
  entryId: string,
  now = Date.now(),
): StarredWordRecord[] {
  const exists = records.some((item) => item.entryId === entryId);
  if (exists) {
    return records.filter((item) => item.entryId !== entryId);
  }
  return [{ entryId, starredAt: now }, ...records];
}

export function resetAllPhrases(): Phrase[] {
  const fresh = sortPhrasesForStudy(INITIAL_PHRASES.map((p) => ({ ...p })));
  savePhrases(fresh);
  return fresh;
}

export function isPhraseDue(phrase: Phrase, now = Date.now()): boolean {
  const nextAt = phrase.review?.nextReviewAt;
  if (nextAt !== undefined) {
    return nextAt <= now;
  }
  return phrase.priority >= 2;
}

export function sortPhrasesForStudy(phrases: Phrase[], now = Date.now()): Phrase[] {
  return [...phrases].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aDue = isPhraseDue(a, now) ? 0 : 1;
    const bDue = isPhraseDue(b, now) ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    const aNext = a.review?.nextReviewAt ?? 0;
    const bNext = b.review?.nextReviewAt ?? 0;
    if (aNext !== bNext) return aNext - bNext;
    return a.sortOrder - b.sortOrder;
  });
}

export function recordPhraseReview(
  phrases: Phrase[],
  id: string,
  outcome: ReviewOutcome,
  now = Date.now(),
): Phrase[] {
  const updated = phrases.map((phrase): Phrase => {
    if (phrase.id !== id) return phrase;

    const prevCount = phrase.review?.reviewCount ?? 0;
    const prevStreak = phrase.review?.streak ?? 0;
    const bestPracticeAccuracy = phrase.review?.bestPracticeAccuracy;

    if (outcome === "again") {
      return {
        ...phrase,
        priority: 3,
        review: {
          reviewCount: prevCount + 1,
          streak: 0,
          lastReviewedAt: now,
          nextReviewAt: now + 5 * MINUTE_MS,
          ...(bestPracticeAccuracy !== undefined ? { bestPracticeAccuracy } : {}),
        },
      };
    }

    if (outcome === "mastered") {
      return {
        ...phrase,
        priority: 1,
        review: {
          reviewCount: prevCount + 1,
          streak: prevStreak + 1,
          lastReviewedAt: now,
          nextReviewAt: now + 21 * DAY_MS,
          ...(bestPracticeAccuracy !== undefined ? { bestPracticeAccuracy } : {}),
        },
      };
    }

    const nextStreak = prevStreak + 1;
    const intervalDays = Math.min(14, 2 ** Math.max(0, nextStreak - 1));
    const nextPriorityValue: PhrasePriority =
      phrase.priority === 3 && nextStreak >= 2 ? 2 : phrase.priority;

    return {
      ...phrase,
      priority: nextPriorityValue,
      review: {
        reviewCount: prevCount + 1,
        streak: nextStreak,
        lastReviewedAt: now,
        nextReviewAt: now + intervalDays * DAY_MS,
        ...(bestPracticeAccuracy !== undefined ? { bestPracticeAccuracy } : {}),
      },
    };
  });

  return sortPhrasesForStudy(updated, now);
}

export function recordPhrasePractice(phrases: Phrase[], id: string, accuracy: number): Phrase[] {
  const clamped = Math.min(100, Math.max(0, Math.round(accuracy)));
  return phrases.map((phrase): Phrase => {
    if (phrase.id !== id) return phrase;
    const prevBest = phrase.review?.bestPracticeAccuracy ?? 0;
    const nextBest = Math.max(prevBest, clamped);
    const existing = phrase.review;
    return {
      ...phrase,
      review: {
        reviewCount: existing?.reviewCount ?? 0,
        streak: existing?.streak ?? 0,
        ...(existing?.lastReviewedAt !== undefined
          ? { lastReviewedAt: existing.lastReviewedAt }
          : {}),
        ...(existing?.nextReviewAt !== undefined ? { nextReviewAt: existing.nextReviewAt } : {}),
        bestPracticeAccuracy: nextBest,
      },
    };
  });
}

export function buildStudyQueue(
  phrases: Phrase[],
  scope: StudyScope,
  requeueIds: readonly string[] = [],
  now = Date.now(),
): Phrase[] {
  if (scope === "due") {
    const duePhrases = phrases.filter((p) => isPhraseDue(p, now));
    if (requeueIds.length === 0) return duePhrases;

    const dueIds = new Set(duePhrases.map((p) => p.id));
    const byId = new Map(phrases.map((p) => [p.id, p]));
    const requeued: Phrase[] = [];
    for (const id of requeueIds) {
      if (dueIds.has(id)) continue;
      const match = byId.get(id);
      if (match) requeued.push(match);
    }
    return [...duePhrases, ...requeued];
  }
  if (scope === "high") {
    const high = phrases.filter((p) => p.priority === 3);
    return high.length > 0 ? high : phrases;
  }
  if (scope === "starred") {
    return phrases.filter((p) => Boolean(p.isStarred));
  }
  return phrases;
}

export function updatePhrasePriorityInDeck(
  phrases: Phrase[],
  id: string,
  priority: PhrasePriority,
): Phrase[] {
  return sortPhrasesForStudy(phrases.map((p) => (p.id === id ? { ...p, priority } : p)));
}

export function togglePhraseStarInDeck(phrases: Phrase[], id: string, now = Date.now()): Phrase[] {
  return phrases.map((p): Phrase => {
    if (p.id !== id) return p;
    const nextStarred = !p.isStarred;
    return {
      ...p,
      isStarred: nextStarred,
      starredAt: nextStarred ? now : undefined,
    };
  });
}

export function movePhraseInDeck(
  phrases: Phrase[],
  id: string,
  direction: "up" | "down",
): Phrase[] {
  const idx = phrases.findIndex((p) => p.id === id);
  if (idx === -1) return phrases;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  const current = phrases[idx];
  const target = phrases[swapIdx];
  if (!current || !target) return phrases;

  const copy = [...phrases];
  copy[idx] = target;
  copy[swapIdx] = {
    ...current,
    priority: target.priority,
  };

  return copy.map((item, i) => ({ ...item, sortOrder: i }));
}

function generateCustomPhraseId(now: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom_${crypto.randomUUID()}`;
  }
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `custom_${String(now)}_${randomSuffix}`;
}

export function createCustomPhraseInDeck(
  phrases: Phrase[],
  newItem: Omit<Phrase, "id" | "sortOrder">,
): Phrase[] {
  const now = Date.now();
  const created: Phrase = {
    ...newItem,
    id: generateCustomPhraseId(now),
    sortOrder: -1,
    starredAt: newItem.isStarred ? (newItem.starredAt ?? now) : undefined,
  };
  return sortPhrasesForStudy([created, ...phrases]).map((item, i) => ({
    ...item,
    sortOrder: i,
  }));
}

export function updateCustomPhraseInDeck(
  phrases: Phrase[],
  id: string,
  patch: Omit<Phrase, "id" | "sortOrder">,
  now = Date.now(),
): Phrase[] {
  const updated = phrases.map((phrase): Phrase => {
    if (phrase.id !== id) return phrase;
    const nextStarred = patch.isStarred ?? phrase.isStarred;
    return {
      ...phrase,
      ...patch,
      id: phrase.id,
      sortOrder: phrase.sortOrder,
      isCustom: true,
      isStarred: nextStarred,
      starredAt: nextStarred ? (phrase.starredAt ?? patch.starredAt ?? now) : undefined,
      ...(phrase.review ? { review: phrase.review } : {}),
    };
  });
  return sortPhrasesForStudy(updated, now);
}

export function getReviewIntervalLabel(phrase: Phrase, outcome: ReviewOutcome): string {
  if (outcome === "again") return "5m";
  if (outcome === "mastered") return "21d";
  const nextStreak = (phrase.review?.streak ?? 0) + 1;
  const intervalDays = Math.min(14, 2 ** Math.max(0, nextStreak - 1));
  return `${String(intervalDays)}d`;
}

export function deletePhraseFromDeck(phrases: Phrase[], id: string): Phrase[] {
  return phrases.filter((p) => p.id !== id);
}

export function getStudyStats(
  phrases: Phrase[],
  now = Date.now(),
  starredWordsCount = 0,
): StudyStats {
  let dueCount = 0;
  let highCount = 0;
  let masteredCount = 0;
  let starredPhraseCount = 0;

  for (const phrase of phrases) {
    if (isPhraseDue(phrase, now)) dueCount++;
    if (phrase.priority === 3) highCount++;
    if (phrase.priority === 1) masteredCount++;
    if (phrase.isStarred) starredPhraseCount++;
  }

  return {
    total: phrases.length,
    dueCount,
    highCount,
    masteredCount,
    starredCount: starredPhraseCount + starredWordsCount,
    starredPhraseCount,
  };
}

export function getPhraseText(phrase: Phrase, region: DialectRegion): string {
  if (region === "north") return phrase.north;
  if (region === "central") return phrase.central;
  return phrase.south;
}

export function getPhrasePhonetic(phrase: Phrase, region: DialectRegion): string {
  if (region === "north") return phrase.phoneticNorth;
  if (region === "central") return phrase.phoneticCentral;
  return phrase.phoneticSouth;
}

export function nextPriority(current: PhrasePriority): PhrasePriority {
  if (current === 3) return 2;
  if (current === 2) return 1;
  return 3;
}
