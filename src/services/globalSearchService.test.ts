import { describe, expect, it } from "vitest";
import { INITIAL_PHRASES } from "../data/phrases";
import { searchGlobalEntries } from "./globalSearchService";

describe("globalSearchService", () => {
  it("returns empty results for blank queries", () => {
    const res = searchGlobalEntries("   ", INITIAL_PHRASES, "south");
    expect(res.phrases).toEqual([]);
    expect(res.words).toEqual([]);
    expect(res.numericMatch).toBeNull();
    expect(res.totalPhraseMatches).toBe(0);
    expect(res.totalWordMatches).toBe(0);
  });

  it("finds phrases and vocabulary words across English, Vietnamese, and unaccented input", () => {
    const coffeeResults = searchGlobalEntries("iced milk coffee", INITIAL_PHRASES, "north");
    expect(coffeeResults.phrases.length).toBeGreaterThan(0);
    expect(coffeeResults.phrases[0]?.phrase.north).toContain("nâu đá");

    const unaccentedVi = searchGlobalEntries("tinh tien", INITIAL_PHRASES, "south");
    expect(unaccentedVi.phrases.some((item) => item.phrase.english.includes("Check"))).toBe(true);

    const wordResults = searchGlobalEntries("expensive", INITIAL_PHRASES, "south");
    expect(wordResults.words.some((w) => w.entry.south === "mắc")).toBe(true);
  });

  it("surfaces numeric and VND price translations", () => {
    const priceResult = searchGlobalEntries("50k", INITIAL_PHRASES, "south");
    expect(priceResult.numericMatch).not.toBeNull();
    expect(priceResult.numericMatch?.south).toContain("năm chục");
  });
});
