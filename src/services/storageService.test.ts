import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_PHRASES } from "../data/phrases";
import {
  createCustomPhraseInDeck,
  DEFAULT_SETTINGS,
  exportSavedAppStateJson,
  importSavedAppStateJson,
  mergePhrasesFromStorage,
  mergeStarredWordsFromStorage,
  PHRASES_KEY,
  parsePhrasesFromRaw,
  parseSettingsFromRaw,
  parseStarredWordsFromRaw,
  savePhrases,
  saveSettings,
  saveStarredWords,
  serializePhrasesCompact,
} from "./storageService";

describe("storageService schema validation and quota resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sanitizes corrupted or invalid settings back to safe defaults", () => {
    expect(parseSettingsFromRaw("{not-json")).toEqual(DEFAULT_SETTINGS);

    const sanitized = parseSettingsFromRaw(
      JSON.stringify({
        region: "unknown-region",
        ttsSource: "invalid-source",
        ttsVoiceProfile: "robot",
        playbackSpeed: 999,
        autoPlayBoth: "yes",
        preferredViVoiceURI: 123,
      }),
    );

    expect(sanitized.region).toBe("south");
    expect(sanitized.ttsSource).toBe("cloud-first");
    expect(sanitized.ttsVoiceProfile).toBe("auto");
    expect(sanitized.playbackSpeed).toBe(100);
    expect(sanitized.autoPlayBoth).toBe(false);
    expect(sanitized.preferredViVoiceURI).toBe("");
  });

  it("preserves valid settings and maps legacy slowVietnamese flag when playbackSpeed is absent", () => {
    const parsed = parseSettingsFromRaw(
      JSON.stringify({
        region: "north",
        slowVietnamese: true,
        ttsSource: "device-only",
        ttsVoiceProfile: "female",
        autoPlayBoth: true,
      }),
    );

    expect(parsed.region).toBe("north");
    expect(parsed.playbackSpeed).toBe(70);
    expect(parsed.slowVietnamese).toBe(true);
    expect(parsed.ttsSource).toBe("device-only");
    expect(parsed.ttsVoiceProfile).toBe("female");
    expect(parsed.autoPlayBoth).toBe(true);
  });

  it("drops malformed phrase items and falls back cleanly when stored deck is corrupted", () => {
    expect(parsePhrasesFromRaw("corrupt").length).toBe(INITIAL_PHRASES.length);
    expect(parsePhrasesFromRaw(JSON.stringify([{ bad: true }])).length).toBe(
      INITIAL_PHRASES.length,
    );

    const validCustom = {
      id: "custom_1",
      category: "Conversation",
      english: "Good morning",
      north: "Chào buổi sáng",
      central: "Chào buổi sáng",
      south: "Chào buổi sáng",
      priority: 3,
      sortOrder: 0,
      isCustom: true,
      review: {
        reviewCount: 2,
        streak: 1,
        bestPracticeAccuracy: 150,
      },
    };

    const parsed = parsePhrasesFromRaw(JSON.stringify([validCustom, { id: "broken" }]));
    const custom = parsed.find((p) => p.id === "custom_1");
    expect(custom).toBeDefined();
    expect(custom?.review?.bestPracticeAccuracy).toBe(100);
    expect(parsed.length).toBe(INITIAL_PHRASES.length + 1);
  });

  it("serializes phrases in compact v2 format and exports full app state backup", () => {
    const first = INITIAL_PHRASES[0];
    expect(first).toBeDefined();
    if (!first) return;

    const custom = {
      id: "custom_compact_1",
      category: "Conversation" as const,
      english: "One more coffee",
      north: "Thêm một cà phê nữa",
      central: "Thêm một cà phê nữa",
      south: "Thêm một cà phê nữa",
      phoneticNorth: "tem mot ka fe nua",
      phoneticCentral: "tem mot ka fe nua",
      phoneticSouth: "tem mot ka fe nua",
      textbook: "Cho thêm một ly cà phê.",
      streetNote: "Casual refill",
      priority: 3 as const,
      sortOrder: 0,
      isCustom: true,
      isStarred: true,
      starredAt: 5000,
    };

    const modifiedDeck = [
      custom,
      {
        ...first,
        priority: 1 as const,
        isStarred: true,
        starredAt: 4200,
        review: { reviewCount: 3, streak: 2, bestPracticeAccuracy: 94 },
      },
      ...INITIAL_PHRASES.slice(1),
    ];

    const compact = serializePhrasesCompact(modifiedDeck);
    expect(compact.version).toBe(2);
    expect(compact.customPhrases).toHaveLength(1);
    expect(compact.overrides[first.id]?.priority).toBe(1);
    expect(compact.overrides[first.id]?.isStarred).toBe(true);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(modifiedDeck).length);

    const restored = parsePhrasesFromRaw(JSON.stringify(compact));
    expect(restored).toHaveLength(INITIAL_PHRASES.length + 1);
    const restoredBuiltIn = restored.find((p) => p.id === first.id);
    expect(restoredBuiltIn?.priority).toBe(1);
    expect(restoredBuiltIn?.isStarred).toBe(true);
    expect(restoredBuiltIn?.review?.bestPracticeAccuracy).toBe(94);
    expect(restored.find((p) => p.id === "custom_compact_1")?.english).toBe("One more coffee");

    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    expect(savePhrases(modifiedDeck)).toBe(true);
    expect(store.get(PHRASES_KEY)).toContain('"version":2');
    const backup = JSON.parse(exportSavedAppStateJson()) as {
      app: string;
      version: number;
      phrases: { version: number; customPhrases: unknown[] };
    };
    expect(backup.app).toBe("noi-vietnamese");
    expect(backup.version).toBe(2);
    expect(backup.phrases.customPhrases).toHaveLength(1);
  });

  it("filters malformed starred word records and deduplicates by entryId", () => {
    const parsed = parseStarredWordsFromRaw(
      JSON.stringify([
        { entryId: "w1", starredAt: 1000 },
        { entryId: "w1", starredAt: 2500 },
        { entryId: "w1", starredAt: 1500 },
        { entryId: 123, starredAt: 1000 },
        { entryId: "w2", starredAt: "bad" },
      ]),
    );
    expect(parsed).toEqual([{ entryId: "w1", starredAt: 2500 }]);
  });

  it("returns false instead of throwing when localStorage quota is exceeded", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    });

    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
    expect(savePhrases(INITIAL_PHRASES)).toBe(false);
    expect(saveStarredWords([{ entryId: "w1", starredAt: 1 }])).toBe(false);
  });

  it("validates and restores JSON backups while rejecting malformed payloads", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    expect(importSavedAppStateJson("{invalid").ok).toBe(false);
    expect(importSavedAppStateJson(JSON.stringify({ app: "other-app", phrases: [] })).ok).toBe(
      false,
    );
    expect(importSavedAppStateJson(JSON.stringify({ app: "noi-vietnamese" })).ok).toBe(false);

    const backupPayload = JSON.stringify({
      app: "noi-vietnamese",
      version: 2,
      settings: { region: "north", playbackSpeed: 75 },
      phrases: [
        {
          id: "custom_restored_1",
          category: "Conversation",
          english: "Thank you very much",
          north: "Cảm ơn nhiều ạ",
          central: "Cảm ơn nhiều ạ",
          south: "Cảm ơn nhiều nha",
          priority: 3,
          sortOrder: 0,
          isCustom: true,
        },
      ],
      starredWords: [{ entryId: "w_pho", starredAt: 12345 }],
    });

    const result = importSavedAppStateJson(backupPayload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.region).toBe("north");
    expect(result.settings.playbackSpeed).toBe(75);
    expect(result.phrases.some((p) => p.id === "custom_restored_1")).toBe(true);
    expect(result.starredWords).toEqual([{ entryId: "w_pho", starredAt: 12345 }]);
  });

  it("merges cross-tab phrase reviews and starred words without losing concurrent progress", () => {
    const base = INITIAL_PHRASES[0];
    expect(base).toBeDefined();
    if (!base) return;

    const localCustom = {
      ...base,
      id: "custom_tab_a",
      english: "Local custom",
      isCustom: true,
      sortOrder: 0,
    };
    const localBuiltIn = {
      ...base,
      review: { reviewCount: 5, streak: 3, lastReviewedAt: 200, bestPracticeAccuracy: 92 },
    };
    const incomingBuiltIn = {
      ...base,
      review: { reviewCount: 3, streak: 2, lastReviewedAt: 150, bestPracticeAccuracy: 96 },
    };

    const mergedPhrases = mergePhrasesFromStorage(
      [localCustom, localBuiltIn, ...INITIAL_PHRASES.slice(1)],
      [incomingBuiltIn, ...INITIAL_PHRASES.slice(1)],
    );
    expect(mergedPhrases.some((p) => p.id === "custom_tab_a")).toBe(true);
    const mergedBase = mergedPhrases.find((p) => p.id === base.id);
    expect(mergedBase?.review?.reviewCount).toBe(5);
    expect(mergedBase?.review?.bestPracticeAccuracy).toBe(96);

    const mergedStars = mergeStarredWordsFromStorage(
      [
        { entryId: "w1", starredAt: 300 },
        { entryId: "w2", starredAt: 100 },
      ],
      [
        { entryId: "w1", starredAt: 200 },
        { entryId: "w3", starredAt: 400 },
      ],
    );
    expect(mergedStars).toEqual([
      { entryId: "w3", starredAt: 400 },
      { entryId: "w1", starredAt: 300 },
      { entryId: "w2", starredAt: 100 },
    ]);
  });

  it("generates distinct IDs for back-to-back custom phrases", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const sample = {
      category: "Conversation" as const,
      english: "One",
      north: "Một",
      central: "Một",
      south: "Một",
      phoneticNorth: "moht",
      phoneticCentral: "moht",
      phoneticSouth: "moht",
      textbook: "Một",
      streetNote: "",
      priority: 2 as const,
    };

    const deck1 = createCustomPhraseInDeck([], sample);
    const deck2 = createCustomPhraseInDeck(deck1, { ...sample, english: "Two" });
    expect(deck1[0]?.id).toBeDefined();
    expect(deck2[0]?.id).toBeDefined();
    expect(deck1[0]?.id).not.toBe(deck2[0]?.id);
  });

  it("rolls back all localStorage keys if backup import hits quota midway", () => {
    const store = new Map<string, string>();
    store.set(
      "noi_vietnamese_settings_v1",
      JSON.stringify({ ...DEFAULT_SETTINGS, region: "south" }),
    );
    store.set(PHRASES_KEY, JSON.stringify({ version: 2, customPhrases: [], overrides: {} }));
    store.set(
      "noi_vietnamese_starred_words_v1",
      JSON.stringify([{ entryId: "w_orig", starredAt: 100 }]),
    );

    let writeAttempts = 0;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writeAttempts += 1;
        if (writeAttempts === 3) {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    const backupPayload = JSON.stringify({
      app: "noi-vietnamese",
      version: 2,
      settings: { region: "north", playbackSpeed: 65 },
      phrases: [
        {
          id: "custom_rollback_1",
          category: "Conversation",
          english: "Should roll back",
          north: "Hoàn tác ạ",
          central: "Hoàn tác nha",
          south: "Hoàn tác nha",
          priority: 3,
          sortOrder: 0,
          isCustom: true,
        },
      ],
      starredWords: [{ entryId: "w_new", starredAt: 999 }],
    });

    const result = importSavedAppStateJson(backupPayload);
    expect(result.ok).toBe(false);
    const savedSettings = JSON.parse(store.get("noi_vietnamese_settings_v1") ?? "{}") as {
      region?: string;
    };
    expect(savedSettings.region).toBe("south");
    expect(store.get(PHRASES_KEY)).not.toContain("custom_rollback_1");
    expect(store.get("noi_vietnamese_starred_words_v1")).toContain("w_orig");
  });

  it("deduplicates duplicate phrase IDs in compact v2 and legacy v1 storage payloads", () => {
    const makeCustom = (id: string, english: string) => ({
      id,
      category: "Conversation",
      english,
      north: "Xin chào",
      central: "Xin chào",
      south: "Xin chào",
      priority: 3,
      sortOrder: 0,
      isCustom: true,
    });

    const v2Parsed = parsePhrasesFromRaw(
      JSON.stringify({
        version: 2,
        overrides: {},
        customPhrases: [makeCustom("custom_dup", "First"), makeCustom("custom_dup", "Second")],
      }),
    );
    const v2DupMatches = v2Parsed.filter((p) => p.id === "custom_dup");
    expect(v2DupMatches).toHaveLength(1);
    expect(v2DupMatches[0]?.english).toBe("First");

    const v1Parsed = parsePhrasesFromRaw(
      JSON.stringify([makeCustom("custom_v1_dup", "One"), makeCustom("custom_v1_dup", "Two")]),
    );
    const v1DupMatches = v1Parsed.filter((p) => p.id === "custom_v1_dup");
    expect(v1DupMatches).toHaveLength(1);
    expect(v1DupMatches[0]?.english).toBe("One");
  });
});
