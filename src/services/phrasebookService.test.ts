import { describe, expect, it } from "vitest";
import { DICTIONARY_ENTRIES } from "../data/dictionary";
import { INITIAL_PHRASES } from "../data/phrases";
import {
  buildPersonalPhrasebook,
  filterPersonalPhrasebook,
  filterPhrases,
  matchesPhraseKeywordSearch,
  sortPersonalPhrasebook,
} from "./phrasebookService";
import {
  createCustomPhraseInDeck,
  getReviewIntervalLabel,
  getStudyStats,
  togglePhraseStarInDeck,
  toggleWordStarInList,
  updateCustomPhraseInDeck,
} from "./storageService";

describe("Personal phrasebook starring, filtering, and sorting", () => {
  it("stars and unstars phrases and dictionary words cleanly", () => {
    const firstPhrase = INITIAL_PHRASES[0];
    const firstWord = DICTIONARY_ENTRIES[0];
    expect(firstPhrase).toBeDefined();
    expect(firstWord).toBeDefined();
    if (!firstPhrase || !firstWord) return;

    const starredPhrases = togglePhraseStarInDeck(INITIAL_PHRASES, firstPhrase.id, 1000);
    expect(starredPhrases.find((p) => p.id === firstPhrase.id)?.isStarred).toBe(true);
    expect(starredPhrases.find((p) => p.id === firstPhrase.id)?.starredAt).toBe(1000);

    const starredWords = toggleWordStarInList([], firstWord.id, 2000);
    expect(starredWords).toEqual([{ entryId: firstWord.id, starredAt: 2000 }]);

    const stats = getStudyStats(starredPhrases, 3000, starredWords.length);
    expect(stats.starredCount).toBe(2);

    const unstarredPhrases = togglePhraseStarInDeck(starredPhrases, firstPhrase.id, 4000);
    expect(unstarredPhrases.find((p) => p.id === firstPhrase.id)?.isStarred).toBe(false);
    expect(unstarredPhrases.find((p) => p.id === firstPhrase.id)?.starredAt).toBeUndefined();

    const unstarredWords = toggleWordStarInList(starredWords, firstWord.id, 4000);
    expect(unstarredWords).toEqual([]);
  });

  it("builds a unified personal phrasebook from starred phrases and words", () => {
    let deck = togglePhraseStarInDeck(INITIAL_PHRASES, "p01", 1000);
    deck = togglePhraseStarInDeck(deck, "p04", 2000);
    deck = createCustomPhraseInDeck(deck, {
      category: "Conversation",
      english: "No cilantro please",
      north: "Không rau mùi nhé",
      central: "Không ngò nha",
      south: "Không ngò nha",
      phoneticNorth: "khong zow mooy nyeh",
      phoneticCentral: "khong ngaw nyah",
      phoneticSouth: "khong ngaw nyah",
      textbook: "Custom saved phrase",
      streetNote: "For pho or banh mi orders",
      priority: 2,
      isCustom: true,
      isStarred: true,
      starredAt: 3000,
    });

    const words = toggleWordStarInList([], "d38", 2500);
    const items = buildPersonalPhrasebook(deck, words);

    expect(items).toHaveLength(4);
    expect(items.filter((i) => i.kind === "phrase")).toHaveLength(3);
    expect(items.filter((i) => i.kind === "word")).toHaveLength(1);
    expect(items.find((i) => i.id === "d38")?.south).toBe("mắc");
    expect(items.find((i) => i.id === "d38")?.north).toBe("đắt");
  });

  it("filters by kind, topic, priority, custom flag, regional difference, and search", () => {
    let deck = togglePhraseStarInDeck(INITIAL_PHRASES, "p01", 1000); // Coffee & Food, priority 3, regional diff
    deck = togglePhraseStarInDeck(deck, "p02", 2000); // Markets & Shopping, priority 3, regional diff
    deck = createCustomPhraseInDeck(deck, {
      category: "Conversation",
      english: "No ice please",
      north: "Không đá nhé",
      central: "Không đá nhé",
      south: "Không đá nhé",
      phoneticNorth: "khong dah nyeh",
      phoneticCentral: "khong dah nyeh",
      phoneticSouth: "khong dah nyeh",
      textbook: "Custom",
      streetNote: "Coffee shop",
      priority: 1,
      isCustom: true,
      isStarred: true,
      starredAt: 3000,
    });

    let words = toggleWordStarInList([], "d11", 1500); // coffee (noun, same across regions)
    words = toggleWordStarInList(words, "d38", 2500); // expensive (adj, differs across regions)

    const items = buildPersonalPhrasebook(deck, words);

    const wordsOnly = filterPersonalPhrasebook(items, {
      search: "",
      kind: "word",
      topic: "all",
      priority: "all",
      regionalDiffOnly: false,
    });
    expect(wordsOnly.map((i) => i.id)).toEqual(["d38", "d11"]);

    const coffeeCat = filterPersonalPhrasebook(items, {
      search: "",
      kind: "all",
      topic: "Coffee & Food",
      priority: "all",
      regionalDiffOnly: false,
    });
    expect(coffeeCat.map((i) => i.id)).toEqual(["p01"]);

    const customOnly = filterPersonalPhrasebook(items, {
      search: "",
      kind: "all",
      topic: "all",
      priority: "custom",
      regionalDiffOnly: false,
    });
    expect(customOnly).toHaveLength(1);
    expect(customOnly[0]?.english).toBe("No ice please");

    const regionalDiff = filterPersonalPhrasebook(items, {
      search: "",
      kind: "all",
      topic: "all",
      priority: "all",
      regionalDiffOnly: true,
    });
    expect(regionalDiff.some((i) => i.id === "d11")).toBe(false);
    expect(regionalDiff.some((i) => i.id === "d38")).toBe(true);

    const unaccentedSearch = filterPersonalPhrasebook(items, {
      search: "khong da",
      kind: "all",
      topic: "all",
      priority: "all",
      regionalDiffOnly: false,
    });
    expect(unaccentedSearch).toHaveLength(1);
    expect(unaccentedSearch[0]?.english).toBe("No ice please");
  });

  it("sorts personal phrasebook by recency, Vietnamese, English, priority, and category", () => {
    let deck = togglePhraseStarInDeck(INITIAL_PHRASES, "p01", 1000);
    deck = togglePhraseStarInDeck(deck, "p02", 3000);
    const words = toggleWordStarInList([], "d38", 2000); // expensive (mắc / đắt)
    const items = buildPersonalPhrasebook(deck, words);

    const newestFirst = sortPersonalPhrasebook(items, "starred-newest", "south");
    expect(newestFirst.map((i) => i.id)).toEqual(["p02", "d38", "p01"]);

    const oldestFirst = sortPersonalPhrasebook(items, "starred-oldest", "south");
    expect(oldestFirst.map((i) => i.id)).toEqual(["p01", "d38", "p02"]);

    const enAsc = sortPersonalPhrasebook(items, "en-asc", "south");
    expect(enAsc.map((i) => i.id)).toEqual(["d38", "p02", "p01"]); // expensive < How much... < One iced...

    const viAsc = sortPersonalPhrasebook(items, "vi-asc", "south");
    expect(viAsc[0]?.id).toBe("p02"); // "Cái này..." < "Cho em..." < "mắc"
  });

  it("supports multi-keyword, accent-insensitive, phonetic, and note searches across phrases and phrasebook", () => {
    const customPhraseDeck = createCustomPhraseInDeck(INITIAL_PHRASES, {
      category: "Coffee & Food",
      english: "Iced milk coffee without sugar",
      north: "Cà phê nâu đá không đường",
      central: "Cà phê sữa đá không đường",
      south: "Cà phê sữa đá không đường",
      phoneticNorth: "kah feh now dah khong duong",
      phoneticCentral: "kah feh sua dah khong duong",
      phoneticSouth: "kah feh sua dah khong duong",
      textbook: "Tôi muốn cà phê sữa đá",
      streetNote: "Hanoi calls iced milk coffee nâu đá",
      priority: 3,
      isCustom: true,
      isStarred: true,
      starredAt: 5000,
    });

    const filteredMultiWord = filterPhrases(customPhraseDeck, {
      search: "coffee sugar",
      category: "All",
      priority: "all",
      starredOnly: false,
    });
    expect(filteredMultiWord.some((p) => p.english === "Iced milk coffee without sugar")).toBe(
      true,
    );

    const filteredUnaccentedVi = filterPhrases(customPhraseDeck, {
      search: "khong duong",
      category: "All",
      priority: "all",
      starredOnly: false,
    });
    expect(filteredUnaccentedVi.some((p) => p.english === "Iced milk coffee without sugar")).toBe(
      true,
    );

    const filteredPhonetic = filterPhrases(customPhraseDeck, {
      search: "kah feh now",
      category: "All",
      priority: "all",
      starredOnly: false,
    });
    expect(filteredPhonetic.some((p) => p.english === "Iced milk coffee without sugar")).toBe(true);

    const filteredNote = filterPhrases(customPhraseDeck, {
      search: "Hanoi",
      category: "All",
      priority: "all",
      starredOnly: false,
    });
    expect(filteredNote.some((p) => p.english === "Iced milk coffee without sugar")).toBe(true);
    const firstPhrase = customPhraseDeck[0];
    expect(firstPhrase).toBeDefined();
    if (firstPhrase) {
      expect(matchesPhraseKeywordSearch(firstPhrase, "   ")).toBe(true);
    }

    const items = buildPersonalPhrasebook(customPhraseDeck, []);
    const phrasebookPhonetic = filterPersonalPhrasebook(items, {
      search: "now dah",
      kind: "all",
      topic: "all",
      priority: "all",
      regionalDiffOnly: false,
    });
    expect(phrasebookPhonetic).toHaveLength(1);
    expect(phrasebookPhonetic[0]?.english).toBe("Iced milk coffee without sugar");

    const phrasebookTextbook = filterPersonalPhrasebook(items, {
      search: "muon sua",
      kind: "all",
      topic: "all",
      priority: "all",
      regionalDiffOnly: false,
    });
    expect(phrasebookTextbook).toHaveLength(1);
  });

  it("edits custom phrases while preserving id, review progress, and star timestamps", () => {
    const baseDeck = createCustomPhraseInDeck(INITIAL_PHRASES, {
      category: "Coffee & Food",
      english: "No ice",
      north: "Không đá",
      central: "Không đá",
      south: "Không đá",
      phoneticNorth: "khong dah",
      phoneticCentral: "khong dah",
      phoneticSouth: "khong dah",
      textbook: "Custom saved phrase",
      streetNote: "Coffee order",
      priority: 3,
      isCustom: true,
      isStarred: true,
      starredAt: 1234,
    });

    const created = baseDeck.find((p) => p.isCustom);
    expect(created).toBeDefined();
    if (!created) return;

    const withReview = baseDeck.map((p) =>
      p.id === created.id ? { ...p, review: { reviewCount: 2, streak: 2, nextReviewAt: 9999 } } : p,
    );

    const editedDeck = updateCustomPhraseInDeck(
      withReview,
      created.id,
      {
        category: "Coffee & Food",
        english: "Less ice",
        north: "Ít đá nhé",
        central: "Ít đá nha",
        south: "Ít đá nha",
        phoneticNorth: "it dah nyeh",
        phoneticCentral: "it dah nyah",
        phoneticSouth: "it dah nyah",
        textbook: "Custom saved phrase",
        streetNote: "Less ice at cafes",
        priority: 2,
        isCustom: true,
        isStarred: true,
      },
      5000,
    );

    const updated = editedDeck.find((p) => p.id === created.id);
    expect(updated?.english).toBe("Less ice");
    expect(updated?.north).toBe("Ít đá nhé");
    expect(updated?.south).toBe("Ít đá nha");
    expect(updated?.starredAt).toBe(1234);
    expect(updated?.review?.streak).toBe(2);
    expect(updated?.isCustom).toBe(true);
  });

  it("formats spaced repetition review interval labels accurately", () => {
    const sample = INITIAL_PHRASES[0];
    expect(sample).toBeDefined();
    if (!sample) return;

    expect(getReviewIntervalLabel(sample, "again")).toBe("5m");
    expect(getReviewIntervalLabel(sample, "good")).toBe("1d");
    expect(
      getReviewIntervalLabel(
        { ...sample, review: { reviewCount: 2, streak: 2, nextReviewAt: 0 } },
        "good",
      ),
    ).toBe("4d");
    expect(getReviewIntervalLabel(sample, "mastered")).toBe("21d");
  });
});
