import { describe, expect, it } from "vitest";
import { DICTIONARY_ENTRIES } from "../data/dictionary";
import { INITIAL_PHRASES } from "../data/phrases";
import {
  buildStudyQueue,
  getStudyStats,
  isPhraseDue,
  movePhraseInDeck,
  recordPhrasePractice,
  recordPhraseReview,
  sortPhrasesForStudy,
  togglePhraseStarInDeck,
} from "./storageService";
import {
  buildGoogleTranslateUrl,
  buildPhraseFromTranslation,
  detectDirection,
  filterDictionaryEntries,
  getDictionaryEntryText,
  normalizeText,
  translateOffline,
} from "./translationService";

describe("Spoken Vietnamese dataset integrity", () => {
  it("ensures every phrase has unique IDs, non-empty regional variants, and textbook contrast", () => {
    expect(INITIAL_PHRASES.length).toBeGreaterThanOrEqual(240);
    const ids = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const sortOrders = new Set<number>();
    for (const phrase of INITIAL_PHRASES) {
      expect(ids.has(phrase.id)).toBe(false);
      ids.add(phrase.id);
      expect(sortOrders.has(phrase.sortOrder)).toBe(false);
      sortOrders.add(phrase.sortOrder);
      categoryCounts.set(phrase.category, (categoryCounts.get(phrase.category) ?? 0) + 1);
      expect(phrase.english.trim().length).toBeGreaterThan(0);
      expect(phrase.north.trim().length).toBeGreaterThan(0);
      expect(phrase.central.trim().length).toBeGreaterThan(0);
      expect(phrase.south.trim().length).toBeGreaterThan(0);
      expect(phrase.phoneticNorth.trim().length).toBeGreaterThan(0);
      expect(phrase.phoneticCentral.trim().length).toBeGreaterThan(0);
      expect(phrase.phoneticSouth.trim().length).toBeGreaterThan(0);
      expect(phrase.textbook.trim().length).toBeGreaterThan(0);
      expect(phrase.streetNote.trim().length).toBeGreaterThan(0);
    }
    for (const count of categoryCounts.values()) {
      expect(count).toBeGreaterThanOrEqual(34);
    }
  });

  it("ensures every dictionary entry has unique IDs and translations", () => {
    expect(DICTIONARY_ENTRIES.length).toBeGreaterThanOrEqual(600);
    const ids = new Set<string>();
    for (const entry of DICTIONARY_ENTRIES) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.en.trim().length).toBeGreaterThan(0);
      expect(entry.vi.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Offline bidirectional translation", () => {
  it("normalizes Vietnamese diacritics including đ", () => {
    expect(normalizeText("Tính tiền đắt quá!")).toBe("tinh tien dat qua");
  });

  it("translates English to regional spoken Vietnamese", () => {
    const north = translateOffline("expensive", "en-vi", "north", INITIAL_PHRASES);
    const south = translateOffline("expensive", "en-vi", "south", INITIAL_PHRASES);

    expect(north?.primaryTranslation).toBe("đắt");
    expect(south?.primaryTranslation).toBe("mắc");
  });

  it("translates Vietnamese (with or without accents) back to English", () => {
    const accented = translateOffline("tính tiền", "vi-en", "south", INITIAL_PHRASES);
    const unaccented = translateOffline("tinh tien", "vi-en", "south", INITIAL_PHRASES);
    const fullPhrase = translateOffline("Tính tiền em ơi!", "vi-en", "south", INITIAL_PHRASES);

    expect(accented?.primaryTranslation).toBe("bill / check");
    expect(unaccented?.primaryTranslation).toBe("bill / check");
    expect(accented?.matchedPhrases[0]?.english).toBe("Check, please!");
    expect(fullPhrase?.primaryTranslation).toBe("Check, please!");
  });

  it("detects Vietnamese direction accurately", () => {
    expect(detectDirection("cà phê sữa đá")).toBe("vi-en");
    expect(detectDirection("mac qua")).toBe("vi-en");
    expect(detectDirection("nam chuc ngan")).toBe("vi-en");
    expect(detectDirection("iced coffee")).toBe("en-vi");
  });

  it("translates English numbers and VND prices into regional spoken Vietnamese", () => {
    const fiftyNorth = translateOffline("50k", "en-vi", "north", INITIAL_PHRASES);
    const fiftySouth = translateOffline("50k", "en-vi", "south", INITIAL_PHRASES);
    const twentyFiveSouth = translateOffline("25000", "en-vi", "south", INITIAL_PHRASES);

    expect(fiftyNorth?.primaryTranslation).toBe("năm mươi nghìn");
    expect(fiftySouth?.primaryTranslation).toBe("năm chục ngàn");
    expect(twentyFiveSouth?.primaryTranslation).toBe("hai lăm ngàn");
    expect(fiftySouth?.numericInterpretation?.value).toBe(50000);
  });

  it("translates spoken Vietnamese VND prices back to English", () => {
    const thirtyK = translateOffline("ba chuc ngan", "vi-en", "south", INITIAL_PHRASES);
    const halfHundred = translateOffline("một trăm rưỡi ngàn", "vi-en", "south", INITIAL_PHRASES);
    const fiftyPhrase = translateOffline("nam chuc ngan", "vi-en", "south", INITIAL_PHRASES);

    expect(thirtyK?.primaryTranslation).toBe("30,000 VND (30k)");
    expect(halfHundred?.primaryTranslation).toBe("150,000 VND (150k)");
    expect(fiftyPhrase?.primaryTranslation).toBe("Fifty thousand dong.");
  });

  it("preserves unmatched tokens during partial compositional translation", () => {
    const partial = translateOffline("two mangoes", "en-vi", "south", INITIAL_PHRASES);
    expect(partial?.primaryTranslation).toBe("hai");
    expect(partial?.unmatchedTokens).toEqual(["mangoes"]);
  });

  it("composes plural nouns and inline prices cleanly across dialects", () => {
    const pluralOrder = translateOffline("two coffees", "en-vi", "south", INITIAL_PHRASES);
    const pricedOrder = translateOffline("coffee 50k", "en-vi", "north", INITIAL_PHRASES);

    expect(pluralOrder?.primaryTranslation).toBe("hai cà phê");
    expect(pluralOrder?.unmatchedTokens).toEqual([]);
    expect(pricedOrder?.primaryTranslation).toBe("cà phê năm mươi nghìn");
  });

  it("projects and filters dictionary entries consistently", () => {
    const pricey = DICTIONARY_ENTRIES.find((e) => e.id === "d38");
    expect(pricey).toBeDefined();
    if (pricey) {
      expect(getDictionaryEntryText(pricey, "north")).toBe("đắt");
      expect(getDictionaryEntryText(pricey, "south")).toBe("mắc");
    }
    expect(filterDictionaryEntries("quẹo").some((e) => e.id === "d50")).toBe(true);
    const adjOnly = filterDictionaryEntries("", DICTIONARY_ENTRIES, "adj");
    expect(adjOnly.length).toBeGreaterThan(0);
    expect(adjOnly.every((e) => e.partOfSpeech === "adj")).toBe(true);
  });

  it("computes independent regional phonetics when saving translations as phrases", () => {
    const southResult = translateOffline("50k", "en-vi", "south", INITIAL_PHRASES);
    expect(southResult).not.toBeNull();
    if (!southResult) return;

    const saved = buildPhraseFromTranslation(southResult, "en-vi", true);
    expect(saved.north).toBe("năm mươi nghìn");
    expect(saved.south).toBe("năm chục ngàn");
    expect(saved.phoneticNorth).not.toBe(saved.phoneticSouth);
    expect(saved.phoneticNorth).toContain("ngin");
    expect(saved.phoneticSouth).toContain("ngan");
  });

  it("builds valid Google Translate deep-link URLs", () => {
    const url = buildGoogleTranslateUrl("Cho em một ly trà đá", "vi-en");
    expect(url).toContain("sl=vi");
    expect(url).toContain("tl=en");
    expect(url).toContain("op=translate");
  });

  it("translates regional food vocabulary across North, Central, and South dialects", () => {
    expect(translateOffline("tofu", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "đậu phụ",
    );
    expect(translateOffline("tofu", "en-vi", "central", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "đậu khuôn",
    );
    expect(translateOffline("tofu", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "đậu hũ",
    );

    expect(
      translateOffline("fried spring rolls", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("nem rán");
    expect(
      translateOffline("fried spring rolls", "en-vi", "central", INITIAL_PHRASES)
        ?.primaryTranslation,
    ).toBe("ram");
    expect(
      translateOffline("fried spring rolls", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("chả giò");

    expect(
      translateOffline("fish sauce", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("nước mắm");
    expect(
      translateOffline("cilantro", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("ngò rí");
  });

  it("composes multi-word food orders and detects unaccented Vietnamese food queries", () => {
    const friedTofuNorth = translateOffline("fried tofu", "en-vi", "north", INITIAL_PHRASES);
    const friedTofuSouth = translateOffline("fried tofu", "en-vi", "south", INITIAL_PHRASES);
    expect(friedTofuNorth?.primaryTranslation).toBe("rán đậu phụ");
    expect(friedTofuSouth?.primaryTranslation).toBe("chiên đậu hũ");

    const grilledSquid = translateOffline("two grilled squid", "en-vi", "south", INITIAL_PHRASES);
    expect(grilledSquid?.primaryTranslation).toBe("hai nướng mực");
    expect(grilledSquid?.unmatchedTokens).toEqual([]);

    expect(detectDirection("bun cha")).toBe("vi-en");
    expect(detectDirection("nuoc mam")).toBe("vi-en");
    expect(
      translateOffline("nuoc mam", "vi-en", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("fish sauce");
  });

  it("translates expanded travel, hotel, and shopping vocabulary across dialects", () => {
    expect(
      translateOffline("air conditioner", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("điều hòa");
    expect(
      translateOffline("air conditioner", "en-vi", "central", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("máy lạnh");
    expect(
      translateOffline("air conditioner", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("máy lạnh");

    expect(translateOffline("alley", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "ngõ",
    );
    expect(translateOffline("alley", "en-vi", "central", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "kiệt",
    );
    expect(translateOffline("alley", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "hẻm",
    );

    expect(
      translateOffline("kilogram", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("cân");
    expect(
      translateOffline("kilogram", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("ký");

    expect(translateOffline("helmet", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "mũ bảo hiểm",
    );
    expect(translateOffline("helmet", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "nón bảo hiểm",
    );

    expect(translateOffline("laundry", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "giặt là",
    );
    expect(translateOffline("laundry", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "giặt ủi",
    );

    expect(
      translateOffline("take a photo", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("chụp ảnh");
    expect(
      translateOffline("take a photo", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("chụp hình");
  });

  it("detects unaccented expanded Vietnamese queries without misclassifying English", () => {
    expect(detectDirection("may lanh")).toBe("vi-en");
    expect(detectDirection("chup hinh")).toBe("vi-en");
    expect(detectDirection("giat ui")).toBe("vi-en");
    expect(detectDirection("kem chong nang")).toBe("vi-en");

    expect(detectDirection("air conditioner")).toBe("en-vi");
    expect(detectDirection("take a photo")).toBe("en-vi");

    expect(
      translateOffline("may lanh", "vi-en", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("air conditioner");
    expect(
      translateOffline("kem chong nang", "vi-en", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("sunscreen");
  });

  it("translates newly expanded regional vocabulary and phrases accurately", () => {
    expect(translateOffline("Monday", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "thứ Hai",
    );
    expect(
      translateOffline("coconut coffee", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("cà phê cốt dừa");

    expect(
      translateOffline("traffic jam", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("tắc đường");
    expect(
      translateOffline("traffic jam", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("kẹt xe");

    expect(
      translateOffline("flat tire", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("thủng lốp");
    expect(
      translateOffline("flat tire", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("lủng bánh");

    expect(translateOffline("zipper", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "khóa kéo",
    );
    expect(translateOffline("zipper", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "dây kéo",
    );

    expect(
      translateOffline("kumquat iced tea", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("trà quất");
    expect(
      translateOffline("kumquat iced tea", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("trà tắc");

    expect(detectDirection("ket xe")).toBe("vi-en");
    expect(detectDirection("ca phe cot dua")).toBe("vi-en");
    expect(detectDirection("he wants coffee")).toBe("en-vi");
    expect(detectDirection("he had a flat tire")).toBe("en-vi");
    expect(translateOffline("ket xe", "vi-en", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "traffic jam",
    );

    const peanutQuestion = INITIAL_PHRASES.find((p) => p.id === "p129");
    expect(peanutQuestion?.north).toContain("lạc");
    expect(peanutQuestion?.south).toContain("đậu phộng");

    const trafficPhrase = INITIAL_PHRASES.find((p) => p.id === "p147");
    expect(trafficPhrase?.north).toContain("tắc đường");
    expect(trafficPhrase?.south).toContain("kẹt xe");
  });

  it("translates second-batch regional vocabulary and phrases cleanly", () => {
    expect(
      translateOffline("fried rice", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("cơm rang");
    expect(
      translateOffline("fried rice", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("cơm chiên");

    expect(translateOffline("wallet", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "ví",
    );
    expect(translateOffline("wallet", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "bóp",
    );

    expect(translateOffline("lighter", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "bật lửa",
    );
    expect(translateOffline("lighter", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "hộp quẹt",
    );

    expect(
      translateOffline("order food", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("gọi món");
    expect(
      translateOffline("order food", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("kêu món");

    expect(translateOffline("cassava", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "sắn",
    );
    expect(translateOffline("cassava", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation).toBe(
      "khoai mì",
    );

    expect(detectDirection("com chien")).toBe("vi-en");
    expect(detectDirection("bun rieu")).toBe("vi-en");
    expect(detectDirection("hoang hon")).toBe("vi-en");
    expect(detectDirection("wait in the lobby")).toBe("en-vi");
    expect(
      translateOffline("com chien", "vi-en", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("fried rice");

    const floorPhrase = INITIAL_PHRASES.find((p) => p.id === "p240");
    expect(floorPhrase?.north).toContain("Tầng một");
    expect(floorPhrase?.south).toContain("Tầng trệt");

    const brothPhrase = INITIAL_PHRASES.find((p) => p.id === "p186");
    expect(brothPhrase?.north).toContain("Nước dùng");
    expect(brothPhrase?.south).toContain("Nước lèo");
  });

  it("includes đúng rồi and daily conversational snippets across regions", () => {
    const dungRoiPhrase = INITIAL_PHRASES.find((p) => p.id === "p241");
    expect(dungRoiPhrase?.north).toBe("Đúng rồi!");
    expect(dungRoiPhrase?.central).toBe("Đúng rồi!");
    expect(dungRoiPhrase?.south).toBe("Đúng rồi!");
    expect(dungRoiPhrase?.category).toBe("Conversation");

    const dungRoiViEn = translateOffline("đúng rồi", "vi-en", "south", INITIAL_PHRASES);
    expect(dungRoiViEn?.primaryTranslation.toLowerCase()).toContain("that's right");
    expect(dungRoiViEn?.matchedPhrases.some((p) => p.id === "p241")).toBe(true);

    const dungRoiEnVi = translateOffline("that's right", "en-vi", "north", INITIAL_PHRASES);
    expect(dungRoiEnVi?.primaryTranslation.toLowerCase()).toContain("đúng rồi");

    expect(
      translateOffline("no wonder", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("thảo nào");
    expect(
      translateOffline("no wonder", "en-vi", "central", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("hèn chi");
    expect(
      translateOffline("no wonder", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("hèn gì");

    expect(
      translateOffline("oh really", "en-vi", "north", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("thế à");
    expect(
      translateOffline("oh really", "en-vi", "central", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("rứa hả");
    expect(
      translateOffline("oh really", "en-vi", "south", INITIAL_PHRASES)?.primaryTranslation,
    ).toBe("vậy hả");
  });
});

describe("Priority study queue sorting and spaced review", () => {
  it("orders High priority (3) before Normal (2) and Learned (1)", () => {
    const sorted = sortPhrasesForStudy(INITIAL_PHRASES);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        expect(prev.priority).toBeGreaterThanOrEqual(curr.priority);
      }
    }
  });

  it("schedules future review intervals and updates due counts on review outcomes", () => {
    const now = 1_700_000_000_000;
    const first = INITIAL_PHRASES[0];
    expect(first).toBeDefined();
    if (!first) return;

    expect(isPhraseDue(first, now)).toBe(true);

    const afterGood = recordPhraseReview(INITIAL_PHRASES, first.id, "good", now);
    const updatedGood = afterGood.find((p) => p.id === first.id);
    expect(updatedGood?.review?.reviewCount).toBe(1);
    expect(updatedGood?.review?.streak).toBe(1);
    expect(updatedGood ? isPhraseDue(updatedGood, now) : true).toBe(false);

    const afterMastered = recordPhraseReview(afterGood, first.id, "mastered", now);
    const updatedMastered = afterMastered.find((p) => p.id === first.id);
    expect(updatedMastered?.priority).toBe(1);
    expect(getStudyStats(afterMastered, now).masteredCount).toBeGreaterThan(
      getStudyStats(INITIAL_PHRASES, now).masteredCount,
    );
  });

  it("moves phrases cleanly within the deck", () => {
    const first = INITIAL_PHRASES[0];
    const second = INITIAL_PHRASES[1];
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    const moved = movePhraseInDeck(INITIAL_PHRASES, second.id, "up");
    expect(moved[0]?.id).toBe(second.id);
    expect(moved[1]?.id).toBe(first.id);
  });

  it("retains Again-graded cards at the end of the due queue and supports starred scope", () => {
    const now = 1_700_000_000_000;
    const first = INITIAL_PHRASES[0];
    const second = INITIAL_PHRASES[1];
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    const afterAgain = recordPhraseReview(INITIAL_PHRASES, first.id, "again", now);
    const updatedFirst = afterAgain.find((p) => p.id === first.id);
    expect(updatedFirst ? isPhraseDue(updatedFirst, now) : true).toBe(false);

    const dueWithRetry = buildStudyQueue(afterAgain, "due", [first.id], now);
    expect(dueWithRetry.at(-1)?.id).toBe(first.id);

    const starredDeck = togglePhraseStarInDeck(afterAgain, second.id, now);
    const starredQueue = buildStudyQueue(starredDeck, "starred", [], now);
    expect(starredQueue.map((p) => p.id)).toEqual([second.id]);
    expect(getStudyStats(starredDeck, now).starredPhraseCount).toBe(1);
  });

  it("tracks best pronunciation practice accuracy across reviews", () => {
    const now = 1_700_000_000_000;
    const first = INITIAL_PHRASES[0];
    expect(first).toBeDefined();
    if (!first) return;

    const practicedHigh = recordPhrasePractice(INITIAL_PHRASES, first.id, 92);
    const practicedLower = recordPhrasePractice(practicedHigh, first.id, 74);
    expect(practicedLower.find((p) => p.id === first.id)?.review?.bestPracticeAccuracy).toBe(92);

    const reviewed = recordPhraseReview(practicedLower, first.id, "good", now);
    expect(reviewed.find((p) => p.id === first.id)?.review?.bestPracticeAccuracy).toBe(92);
  });
});
