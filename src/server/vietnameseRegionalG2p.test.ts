import { describe, expect, it } from "vitest";
import {
  KOKORO_VOCAB,
  phonemizeVietnameseForRegion,
  phonemizeVietnameseWord,
} from "./vietnameseRegionalG2p.ts";

describe("Vietnamese regional IPA G2P phonemizer", () => {
  it("distinguishes initial r as rhotic ɹ in South/Central vs voiced z in North", () => {
    expect(phonemizeVietnameseWord("rồi", "north")).toBe("zˈo↘j");
    expect(phonemizeVietnameseWord("rồi", "central")).toBe("ɹˈo↘j");
    expect(phonemizeVietnameseWord("rồi", "south")).toBe("ɹˈo↘j");

    expect(phonemizeVietnameseWord("rứa", "central")).toBe("ɹˈyə↗");
    expect(phonemizeVietnameseWord("rẽ", "north")).toBe("zˈɛʔ↗");
    expect(phonemizeVietnameseWord("rẽ", "south")).toBe("ɹˈɛ↓");
  });

  it("maps d, gi, and dz to smooth palatal glide j in South/Central and z in North", () => {
    expect(phonemizeVietnameseWord("dĩa", "north")).toBe("zˈiəʔ↗");
    expect(phonemizeVietnameseWord("dĩa", "south")).toBe("jˈiə↓");

    expect(phonemizeVietnameseWord("dùm", "north")).toBe("zˈu↘m");
    expect(phonemizeVietnameseWord("dùm", "central")).toBe("jˈu↘m");
    expect(phonemizeVietnameseWord("dùm", "south")).toBe("jˈu↘m");

    expect(phonemizeVietnameseWord("gì", "north")).toBe("zˈi↘");
    expect(phonemizeVietnameseWord("gì", "south")).toBe("jˈi↘");

    expect(phonemizeVietnameseWord("giò", "north")).toBe("zˈɔ↘");
    expect(phonemizeVietnameseWord("giò", "south")).toBe("jˈɔ↘");

    expect(phonemizeVietnameseWord("dzô", "north")).toBe("zˈo");
    expect(phonemizeVietnameseWord("dzô", "south")).toBe("jˈo");
  });

  it("softens casual Southern v to j while preserving v in Central, North, and Việt", () => {
    expect(phonemizeVietnameseWord("vậy", "north")).toBe("vˈəɪʔ↓");
    expect(phonemizeVietnameseWord("vậy", "central")).toBe("vˈəɪʔ↓");
    expect(phonemizeVietnameseWord("vậy", "south")).toBe("jˈəɪʔ↓");

    expect(phonemizeVietnameseWord("Việt", "south")).toBe("vˈiɛʔ↓t");
    expect(phonemizeVietnameseWord("về", "central")).toBe("vˈe↘");
  });

  it("keeps retroflex tr/s and alveolar -inh/-ich codas in South/Central vs Hanoi merges in North", () => {
    expect(phonemizeVietnameseWord("trà", "north")).toBe("ʧˈaː↘");
    expect(phonemizeVietnameseWord("trà", "south")).toBe("ʈʂˈaː↘");
    expect(phonemizeVietnameseWord("trời", "south")).toBe("ʈʂˈəː↘j");

    expect(phonemizeVietnameseWord("sữa", "north")).toBe("sˈyəʔ↗");
    expect(phonemizeVietnameseWord("sữa", "central")).toBe("ʂˈyə↓");
    expect(phonemizeVietnameseWord("sữa", "south")).toBe("ʂˈyə↓");

    expect(phonemizeVietnameseWord("tính", "north")).toBe("tˈi↗ɲ");
    expect(phonemizeVietnameseWord("tính", "south")).toBe("tˈi↗n");

    expect(phonemizeVietnameseWord("bịch", "north")).toBe("bˈiʔ↓c");
    expect(phonemizeVietnameseWord("bịch", "central")).toBe("bˈiʔ↓t");
  });

  it("normalizes numbers regionally and produces valid bounded Kokoro token sequences", () => {
    const north = phonemizeVietnameseForRegion("50.000 đồng nhé", "north");
    const south = phonemizeVietnameseForRegion("50.000 đồng nha", "south");

    expect(north.normalized).toContain("nghìn");
    expect(south.normalized).toContain("ngàn");

    const full = phonemizeVietnameseForRegion(
      "Cho em xuống ngay đây được rồi anh. Pass wifi là gì vậy em?",
      "south",
    );
    expect(full.chunks.length).toBe(1);
    const chunk = full.chunks[0];
    expect(chunk).toBeDefined();
    expect(chunk?.phonemes).toContain("ɹˈo↘j");
    expect(chunk?.phonemes).toContain("jˈi↘");
    expect(chunk?.phonemes).toContain("jˈəɪʔ↓");
    expect(chunk?.phonemes).toContain("wˈaɪfaɪ");
    expect(chunk?.tokens[0]).toBe(0);
    expect(chunk?.tokens[chunk.tokens.length - 1]).toBe(0);

    const validIds = new Set(Object.values(KOKORO_VOCAB));
    validIds.add(0);
    expect(chunk?.tokens.every((id) => validIds.has(id))).toBe(true);
  });
});
