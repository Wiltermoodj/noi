import { describe, expect, it } from "vitest";
import {
  getConsonantReferenceItems,
  getPhrasePronunciationTips,
  getToneReferenceItems,
  getVowelReferenceItems,
} from "./pronunciationTipsService";

describe("pronunciationTipsService", () => {
  it("anchors Southern tips to exact matching words for d/gi, hỏi/ngã merger, and -nh endings", () => {
    const tips = getPhrasePronunciationTips("Tính tiền cà phê sữa dùm em nha.", "south", 4);

    expect(tips.length).toBeGreaterThanOrEqual(3);
    const dGiTip = tips.find((t) => t.id === "south-d-gi");
    expect(dGiTip?.words).toContain("dùm");
    expect(dGiTip?.detail).toContain('"y"');

    const toneTip = tips.find((t) => t.id === "tone-hoi-nga-merged");
    expect(toneTip?.words).toContain("sữa");
  });

  it("distinguishes Northern Hanoi d/gi/r → z and separate ngã tone", () => {
    const tips = getPhrasePronunciationTips("Đi thẳng rồi rẽ trái nhé.", "north", 4);

    const dGiRTip = tips.find((t) => t.id === "north-d-gi-r");
    expect(dGiRTip).toBeDefined();
    expect(dGiRTip?.words).toEqual(["rồi", "rẽ"]);

    const ngaTip = tips.find((t) => t.id === "tone-nga-north");
    expect(ngaTip?.words).toContain("rẽ");
  });

  it("highlights authentic Central vocabulary and tapped r", () => {
    const tips = getPhrasePronunciationTips("Cái ni bao nhiêu rứa chị?", "central", 4);

    const centralTip = tips.find((t) => t.id === "central-lexicon");
    expect(centralTip?.words).toEqual(["ni", "rứa"]);
  });

  it("surfaces tricky Vietnamese consonants and vowels like ng, th, ph, ươ, and rounded -ong/-ông", () => {
    const ngTips = getPhrasePronunciationTips("Ngon quá không anh?", "south", 5);
    expect(ngTips.some((t) => t.id === "sound-ng" && t.words.includes("Ngon"))).toBe(true);
    expect(ngTips.some((t) => t.id === "ending-labial" && t.words.includes("không"))).toBe(true);

    const phoTips = getPhrasePronunciationTips("Cho em phở nước nhé.", "north", 5);
    expect(phoTips.some((t) => t.id === "sound-ph" && t.words.includes("phở"))).toBe(true);
    expect(phoTips.some((t) => t.id === "vowel-uo" && t.words.includes("nước"))).toBe(true);
  });

  it("returns fallback regional rhythm tip for minimal plain-ngang words", () => {
    const tips = getPhrasePronunciationTips("Ba", "south", 3);
    expect(tips).toHaveLength(1);
    expect(tips[0]?.words).toEqual(["Ba"]);
  });

  it("adapts Tone and Consonant reference guides to the active region", () => {
    const northTones = getToneReferenceItems("north");
    const southTones = getToneReferenceItems("south");
    expect(northTones).toHaveLength(6);
    expect(southTones).toHaveLength(6);
    expect(northTones.find((t) => t.tone === "nga")?.summary).toContain("Creaky");
    expect(southTones.find((t) => t.tone === "nga")?.summary).toContain("Merges");

    const northConsonants = getConsonantReferenceItems("north");
    const southConsonants = getConsonantReferenceItems("south");
    expect(northConsonants.find((c) => c.id === "ref-d-gi")?.soundAs).toContain("z");
    expect(southConsonants.find((c) => c.id === "ref-d-gi")?.soundAs).toContain("y");

    const vowels = getVowelReferenceItems();
    expect(vowels.length).toBeGreaterThanOrEqual(6);
  });
});
