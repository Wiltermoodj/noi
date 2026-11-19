import { describe, expect, it } from "vitest";
import { evaluatePronunciation, getRegionalPronunciationGuide } from "./pronunciationService";

describe("Vietnamese pronunciation evaluation", () => {
  it("scores exact tone-matched spoken phrases at 100%", () => {
    const result = evaluatePronunciation(
      "Cho em một ly cà phê sữa đá nha.",
      ["Cho em một ly cà phê sữa đá nha"],
      "south",
    );

    expect(result.accuracy).toBe(100);
    expect(result.hasToneHints).toBe(false);
    expect(result.words.every((w) => w.status === "exact")).toBe(true);
  });

  it("flags base-syllable matches with different tones as tone hints", () => {
    const result = evaluatePronunciation("Tính tiền em ơi!", ["tinh tien em oi"], "north");

    expect(result.accuracy).toBe(74);
    expect(result.hasToneHints).toBe(true);
    expect(result.words.map((w) => w.status)).toEqual(["tone", "tone", "exact", "tone"]);
  });

  it("picks the highest-scoring alternative and handles slash options", () => {
    const result = evaluatePronunciation(
      "Anh ơi! / Chị ơi! / Em ơi!",
      ["chị ơi", "chi oi"],
      "south",
    );

    expect(result.accuracy).toBe(100);
    expect(result.bestTranscript).toBe("chị ơi");
  });

  it("marks missing words cleanly in sequence order", () => {
    const result = evaluatePronunciation("Đi thẳng rồi quẹo trái nha.", ["đi thẳng"], "south");

    expect(result.accuracy).toBe(33);
    expect(result.words[0]?.status).toBe("exact");
    expect(result.words[1]?.status).toBe("exact");
    expect(result.words[2]?.status).toBe("missed");
  });

  it("accepts Southern Ho Chi Minh City hỏi/ngã tone merger and -nh/-n softening", () => {
    const south = evaluatePronunciation("Tính tiền cà phê sữa", ["tín tiền cà phê sửa"], "south");
    const north = evaluatePronunciation("Tính tiền cà phê sữa", ["tín tiền cà phê sửa"], "north");

    expect(south.dialectMatchCount).toBe(2);
    expect(south.accuracy).toBe(98);
    expect(south.words[0]?.status).toBe("dialect");
    expect(south.words[4]?.status).toBe("dialect");

    // In Hanoi, hỏi vs ngã must stay distinct and -nh does not merge to -n
    expect(north.words[4]?.status).toBe("tone");
    expect(north.accuracy).toBeLessThan(south.accuracy);
  });

  it("accepts Northern Hanoi d/gi/r and tr/ch mergers", () => {
    const north = evaluatePronunciation("Rẽ trái rồi nhé", ["dẽ chái dồi nhé"], "north");

    expect(north.dialectMatchCount).toBe(3);
    expect(north.accuracy).toBe(96);
    expect(north.words[0]?.dialectNote).toBe("Hanoi sound");
  });

  it("accepts Central Da Nang hỏi/ngã tone merger", () => {
    const central = evaluatePronunciation(
      "Cái ni bao nhiêu rứa, sửa lại nha",
      ["cái ni bao nhiêu rứa sữa lại nha"],
      "central",
    );

    expect(central.words[5]?.status).toBe("dialect");
    expect(central.words[5]?.dialectNote).toBe("Da Nang sound");
  });

  it("normalizes ASR spoken digits and dzô/vô slang", () => {
    const result = evaluatePronunciation("Một, hai, ba, dzô!", ["1 2 3 vô"], "south");

    expect(result.accuracy).toBe(100);
    expect(result.words.every((w) => w.status === "exact")).toBe(true);
  });

  it("gives partial credit for close phonetic approximations without stealing later words", () => {
    const result = evaluatePronunciation(
      "Cho em đi thẳng rồi em quẹo trái",
      ["cho đi thẳng rồi em kẹo trái"],
      "south",
    );

    expect(result.words[0]?.status).toBe("exact");
    expect(result.words[1]?.status).toBe("missed");
    expect(result.words[5]?.status).toBe("exact");
    expect(result.words[6]?.status).toBe("close");
    expect(result.words[6]?.spoken).toBe("kẹo");
  });

  it("generates phrase-tailored regional pronunciation cues", () => {
    const northGuide = getRegionalPronunciationGuide("Đi thẳng rồi rẽ trái nhé.", "north");
    const southGuide = getRegionalPronunciationGuide("Cho em một ly cà phê sữa đá nha.", "south");
    const centralGuide = getRegionalPronunciationGuide("Cái ni bao nhiêu rứa chị?", "central");

    expect(northGuide.regionTitle).toContain("Hanoi");
    expect(northGuide.cues.some((c) => c.includes("z"))).toBe(true);
    expect(southGuide.regionTitle).toContain("Ho Chi Minh City");
    expect(southGuide.cues.some((c) => c.includes("Hỏi and ngã"))).toBe(true);
    expect(centralGuide.regionTitle).toContain("Da Nang");
    expect(centralGuide.cues.some((c) => c.includes("ni, rứa"))).toBe(true);

    const southGiGuide = getRegionalPronunciationGuide("Đang làm gì vậy?", "south");
    expect(southGiGuide.cues.some((c) => c.includes('"y"') && c.includes("never"))).toBe(true);

    const centralDGuide = getRegionalPronunciationGuide("Cho em xin dùm anh rồi nha.", "central");
    expect(centralDGuide.cues.some((c) => c.includes('"y"'))).toBe(true);
    expect(centralDGuide.cues.some((c) => c.includes("tapped"))).toBe(true);
  });
});
