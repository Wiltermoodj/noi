import { describe, expect, it } from "vitest";
import {
  adaptTextForRegionalSpeech,
  buildRegionalVoiceSpec,
  normalizeTextForSpeech,
} from "./ttsDialectProfile";

describe("Vietnamese dialect TTS tonal profile", () => {
  it("normalizes slash-separated options into natural pauses", () => {
    expect(normalizeTextForSpeech("Anh ơi! / Chị ơi! / Em ơi!")).toBe("Anh ơi!, Chị ơi!, Em ơi!");
  });

  it("produces Northern Hanoi 6-tone directives distinguishing hỏi and ngã", () => {
    const spec = buildRegionalVoiceSpec("Rẽ trái hỏi đường nhé", "north", false, "auto");

    expect(spec.voiceName).toBe("Kore");
    expect(spec.styleDirective).toContain("Hanoi");
    expect(spec.styleDirective).toContain("ngã");
    expect(spec.styleDirective).toContain("hỏi");
    expect(spec.styleDirective).toContain("crisp voiced 'z'");
    expect(spec.styleDirective).toContain("rẽ as 'zẽ'");
    expect(spec.spokenText).toBe("Dẽ chái hỏi đường nhé");
  });

  it("produces Central Da Nang / Hue tonal, consonant, and regional lexical directives", () => {
    const spec = buildRegionalVoiceSpec(
      "Cái ni bao nhiêu rứa, dùm sửa lại",
      "central",
      true,
      "male",
    );

    expect(spec.voiceName).toBe("Charon");
    expect(spec.styleDirective).toContain("Da Nang / Hue");
    expect(spec.styleDirective).toContain("hỏi and ngã merge");
    expect(spec.styleDirective).toContain("dùm as 'yùm'");
    expect(spec.styleDirective).toContain("tapped 'r'");
    expect(spec.styleDirective).toContain("ni, rứa");
    expect(spec.styleDirective).toContain("slowly and clearly");
    expect(spec.spokenText).toBe("Cái ni bao nhiêu rứa, yùm sửa lại");
  });

  it("produces Southern Ho Chi Minh City 'y' glide directives for gì/d/v and coda softening", () => {
    const spec = buildRegionalVoiceSpec(
      "Pass wifi là gì vậy em, tính tiền dùm nha",
      "south",
      false,
      "female",
    );

    expect(spec.voiceName).toBe("Zephyr");
    expect(spec.styleDirective).toContain("Ho Chi Minh City");
    expect(spec.styleDirective).toContain("never 'z'");
    expect(spec.styleDirective).toContain("gì as 'yì'");
    expect(spec.styleDirective).toContain("dùm as 'yùm'");
    expect(spec.styleDirective).toContain("vậy as 'yậy'");
    expect(spec.styleDirective).toContain("-nh and -ch");
    expect(spec.styleDirective).not.toContain("wifi as");
    expect(spec.spokenText).toBe("Pass wifi là yì yậy em, tín tiền yùm nha");
  });

  it("adapts spoken text per region without altering loanwords, đ, or Việt", () => {
    expect(adaptTextForRegionalSpeech("Cho em một dĩa chả giò, khăn giấy, dừa nha", "south")).toBe(
      "Cho em một yĩa chả yò, khăn yấy, yừa nha",
    );
    expect(adaptTextForRegionalSpeech("Đĩa cơm tiếng Việt dzô bịch", "south")).toBe(
      "Đĩa cơm tiếng Việt yô bịt",
    );
    expect(adaptTextForRegionalSpeech("Về nhà vệ sinh, bịch này dùm", "central")).toBe(
      "Về nhà vệ sin, bịt này yùm",
    );
    expect(adaptTextForRegionalSpeech("Đi thẳng rồi rẽ trái nhé, dzô", "north")).toBe(
      "Đi thẳng dồi dẽ chái nhé, dô",
    );
    expect(adaptTextForRegionalSpeech("Trà sữa đá", "north")).toBe("Chà sữa đá");
  });
});
