import { DIALECT_META, type DialectRegion } from "../types/vietnamese";
import { detectSyllableTone, getRegionalToneContour, type ViToneName } from "./toneAudioService";
import { normalizeText } from "./translationService";

export type PronunciationTipCategory = "dialect" | "tone" | "sound" | "vowel" | "ending";

export interface PhrasePronunciationTip {
  id: string;
  category: PronunciationTipCategory;
  title: string;
  detail: string;
  words: string[];
}

export interface ToneReferenceItem {
  tone: ViToneName;
  name: string;
  mark: string;
  shortHint: string;
  summary: string;
  tip: string;
  exampleWord: string;
  exampleMeaning: string;
  contour: number[];
}

export interface SoundReferenceItem {
  id: string;
  symbol: string;
  soundAs: string;
  tip: string;
  exampleWord: string;
  exampleMeaning: string;
  regionalHighlight?: boolean | undefined;
}

interface AnalyzedToken {
  display: string;
  lower: string;
  toneFree: string;
  ascii: string;
  tone: ViToneName;
}

const COMBINING_TONE_REGEX = /[\u0300\u0301\u0309\u0303\u0323]/g;
const CENTRAL_LEXICON_SET = new Set(["ni", "rứa", "mô", "chi", "nỏ"]);

function tokenizePhraseWords(phraseText: string): AnalyzedToken[] {
  const rawTokens = phraseText
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => /\p{L}/u.test(w));

  return rawTokens.map((display) => {
    const lower = display.toLocaleLowerCase("vi").normalize("NFC");
    const toneFree = lower.normalize("NFD").replace(COMBINING_TONE_REGEX, "").normalize("NFC");
    return {
      display,
      lower,
      toneFree,
      ascii: normalizeText(lower),
      tone: detectSyllableTone(lower),
    };
  });
}

function collectMatchingWords(
  tokens: AnalyzedToken[],
  predicate: (token: AnalyzedToken) => boolean,
): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const token of tokens) {
    if (!predicate(token)) continue;
    if (seen.has(token.lower)) continue;
    seen.add(token.lower);
    matches.push(token.display);
    if (matches.length >= 3) break;
  }
  return matches;
}

function pushTipIfMatched(
  tips: PhrasePronunciationTip[],
  words: string[],
  tip: Omit<PhrasePronunciationTip, "words">,
): void {
  if (words.length === 0) return;
  tips.push({ ...tip, words });
}

function isInitialDOrGi(token: AnalyzedToken): boolean {
  return /^(d|gi)/.test(token.toneFree);
}

function isRoundedFinalNgOrC(token: AnalyzedToken): boolean {
  return /(?<!u)[oôu](ng|c)$/.test(token.toneFree) || /uô(ng|c)$/.test(token.toneFree);
}

function collectDialectTips(
  tokens: AnalyzedToken[],
  region: DialectRegion,
): PhrasePronunciationTip[] {
  const tips: PhrasePronunciationTip[] = [];
  const dGiWords = collectMatchingWords(tokens, isInitialDOrGi);
  const rWords = collectMatchingWords(tokens, (t) => t.toneFree.startsWith("r"));
  const vWords = collectMatchingWords(tokens, (t) => t.toneFree.startsWith("v"));
  const trWords = collectMatchingWords(tokens, (t) => t.toneFree.startsWith("tr"));
  const nhChWords = collectMatchingWords(tokens, (t) => /(nh|ch)$/.test(t.ascii));
  const centralWords = collectMatchingWords(tokens, (t) => CENTRAL_LEXICON_SET.has(t.lower));

  if (region === "north") {
    pushTipIfMatched(tips, [...new Set([...dGiWords, ...rWords])].slice(0, 3), {
      id: "north-d-gi-r",
      category: "dialect",
      title: 'Initial d / gi / r → "z"',
      detail: 'In Hanoi, initial d, gi, and r merge into a crisp "z" sound (e.g., rồi → "zoy").',
    });
    pushTipIfMatched(tips, trWords, {
      id: "north-tr",
      category: "dialect",
      title: 'tr softens toward "ch"',
      detail: 'Casual Hanoi speakers pronounce tr very close to a clean "ch" sound.',
    });
    return tips;
  }

  if (region === "central") {
    pushTipIfMatched(tips, centralWords, {
      id: "central-lexicon",
      category: "dialect",
      title: "Authentic Central words",
      detail: "Local Huế / Đà Nẵng words (ni, rứa, mô, chi, nỏ) carry steady, rhythmic vowels.",
    });
    pushTipIfMatched(tips, dGiWords, {
      id: "central-d-gi",
      category: "dialect",
      title: 'Initial d / gi → "y"',
      detail: 'Pronounce initial d and gi as a smooth "y" glide (never Northern "z").',
    });
    pushTipIfMatched(tips, rWords, {
      id: "central-r",
      category: "dialect",
      title: "Light tapped r",
      detail: 'Tap the tongue tip lightly for initial r rather than Northern "z".',
    });
    pushTipIfMatched(tips, nhChWords, {
      id: "central-nh-ch",
      category: "ending",
      title: "Soft -nh / -ch endings",
      detail: "Final -nh and -ch relax slightly toward -n and -t in Central speech.",
    });
    return tips;
  }

  // South
  pushTipIfMatched(tips, dGiWords, {
    id: "south-d-gi",
    category: "dialect",
    title: 'Initial d / gi → "y"',
    detail: 'In Saigon, initial d and gi glide smoothly like "y" (e.g., gì → "yee"), never "z".',
  });
  pushTipIfMatched(tips, vWords, {
    id: "south-v",
    category: "dialect",
    title: 'Soft Southern v → "y"',
    detail: 'Casual Saigon speech softens initial v toward a gentle "y" glide (vậy → "yuhy").',
  });
  pushTipIfMatched(tips, nhChWords, {
    id: "south-nh-ch",
    category: "ending",
    title: "Soft -nh / -ch endings",
    detail: 'In Southern speech, final -nh and -ch soften toward -n and -t (e.g., tính → "tin").',
  });
  pushTipIfMatched(tips, rWords, {
    id: "south-r",
    category: "dialect",
    title: "Light tapped r",
    detail: 'Keep initial r as a light tapped "r" instead of Northern "z".',
  });
  return tips;
}

function collectToneTips(tokens: AnalyzedToken[], region: DialectRegion): PhrasePronunciationTip[] {
  const tips: PhrasePronunciationTip[] = [];
  const hoiWords = collectMatchingWords(tokens, (t) => t.tone === "hoi");
  const ngaWords = collectMatchingWords(tokens, (t) => t.tone === "nga");
  const nangWords = collectMatchingWords(tokens, (t) => t.tone === "nang");
  const sacWords = collectMatchingWords(tokens, (t) => t.tone === "sac");
  const huyenWords = collectMatchingWords(tokens, (t) => t.tone === "huyen");

  if (region === "north") {
    pushTipIfMatched(tips, ngaWords, {
      id: "tone-nga-north",
      category: "tone",
      title: "Ngã tone (˜) — creaky rise",
      detail:
        "Catch briefly in the throat mid-syllable then jump high; keep it distinct from hỏi in Hanoi.",
    });
    pushTipIfMatched(tips, hoiWords, {
      id: "tone-hoi-north",
      category: "tone",
      title: "Hỏi tone (̉) — low dip",
      detail: "Drop low and scoop gently upward without the sharp throat catch of ngã.",
    });
  } else {
    const mergedWords = [...new Set([...hoiWords, ...ngaWords])].slice(0, 3);
    pushTipIfMatched(tips, mergedWords, {
      id: "tone-hoi-nga-merged",
      category: "tone",
      title: "Merged hỏi / ngã dip",
      detail: `In ${DIALECT_META[region].regionName} speech, hỏi (̉) and ngã (˜) share one smooth dipping-rising curve.`,
    });
  }

  pushTipIfMatched(tips, nangWords, {
    id: "tone-nang",
    category: "tone",
    title: "Nặng tone (̣) — short low drop",
    detail: "Drop low and cut the syllable short cleanly from the chest, like a crisp stop.",
  });
  pushTipIfMatched(tips, sacWords, {
    id: "tone-sac",
    category: "tone",
    title: "Sắc tone (́) — sharp high rise",
    detail: 'Start mid-high and push pitch cleanly upward, like a quick energized "Huh?".',
  });
  pushTipIfMatched(tips, huyenWords, {
    id: "tone-huyen",
    category: "tone",
    title: "Huyền tone (̀) — gentle low fall",
    detail: "Relax your voice and glide softly downward, like a calm sigh.",
  });

  return tips;
}

function collectConsonantAndVowelTips(tokens: AnalyzedToken[]): PhrasePronunciationTip[] {
  const tips: PhrasePronunciationTip[] = [];

  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => /^(ngh|ng)/.test(t.toneFree)),
    {
      id: "sound-ng",
      category: "sound",
      title: "Initial ng / ngh",
      detail:
        'Start from the "ng" at the end of "sing" and glide straight into the vowel — no hard "g".',
    },
  );
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => t.toneFree.startsWith("nh")),
    {
      id: "sound-nh",
      category: "sound",
      title: 'Initial nh → "ny"',
      detail: 'Press the middle of your tongue to the roof of your mouth like "ny" in "canyon".',
    },
  );
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => t.toneFree.startsWith("kh")),
    {
      id: "sound-kh",
      category: "sound",
      title: "Soft breathy kh",
      detail: 'Friction from the back of the throat — softer than English "k" (never a hard stop).',
    },
  );
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => t.toneFree.startsWith("th")),
    {
      id: "sound-th",
      category: "sound",
      title: 'th = crisp "t" with air',
      detail: 'Never English "th" (think). Say a crisp "t" with a light puff of air like "tea".',
    },
  );
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => t.toneFree.startsWith("đ")),
    {
      id: "sound-d-bar",
      category: "sound",
      title: 'Crossed đ = firm "d"',
      detail:
        'Unlike uncrossed d (z/y), crossed đ is a firm "d" with tongue right behind upper teeth.',
    },
  );
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => t.toneFree.startsWith("ph")),
    {
      id: "sound-ph",
      category: "sound",
      title: 'ph = clean "f"',
      detail: 'Pronounce ph cleanly like English "f" (phở → "fuh"), never "p" + "h".',
    },
  );

  const uoGlideWords = collectMatchingWords(tokens, (t) => /ươ|ưa/.test(t.toneFree));
  pushTipIfMatched(tips, uoGlideWords, {
    id: "vowel-uo",
    category: "vowel",
    title: "Unrounded ươ / ưa glide",
    detail: 'Keep your lips flat in a slight smile while gliding from "uh" toward "ah".',
  });

  if (uoGlideWords.length === 0) {
    pushTipIfMatched(
      tips,
      collectMatchingWords(tokens, (t) => t.toneFree.includes("ư")),
      {
        id: "vowel-u-horn",
        category: "vowel",
        title: "Unrounded ư vowel",
        detail: 'Spread your lips in a relaxed smile while trying to say "oo" — never round lips.',
      },
    );
    pushTipIfMatched(
      tips,
      collectMatchingWords(tokens, (t) => t.toneFree.includes("ơ")),
      {
        id: "vowel-o-horn",
        category: "vowel",
        title: "Open ơ vowel",
        detail: 'Relax your jaw and say a clean "uh" (like "her" without the "r"), lips unrounded.',
      },
    );
  }

  pushTipIfMatched(tips, collectMatchingWords(tokens, isRoundedFinalNgOrC), {
    id: "ending-labial",
    category: "ending",
    title: "Close lips on -ong / -ông / -oc",
    detail: 'After o, ô, or u, close your lips lightly at the end (không ends almost like "-ngm").',
  });
  pushTipIfMatched(
    tips,
    collectMatchingWords(tokens, (t) => /[ptc]$/.test(t.ascii) && !isRoundedFinalNgOrC(t)),
    {
      id: "ending-unreleased",
      category: "ending",
      title: "Unreleased -p / -t / -c stops",
      detail: "Close your mouth or tongue cleanly at the end without releasing a puff of air.",
    },
  );

  return tips;
}

function interleaveTips(
  dialectTips: PhrasePronunciationTip[],
  toneTips: PhrasePronunciationTip[],
  soundTips: PhrasePronunciationTip[],
  maxTips: number,
): PhrasePronunciationTip[] {
  const result: PhrasePronunciationTip[] = [];
  const buckets = [dialectTips, toneTips, soundTips];
  const indices = [0, 0, 0];

  while (result.length < maxTips) {
    let added = false;
    for (let b = 0; b < buckets.length; b++) {
      if (result.length >= maxTips) break;
      const bucket = buckets[b];
      const idx = indices[b] ?? 0;
      const candidate = bucket?.[idx];
      if (candidate) {
        result.push(candidate);
        indices[b] = idx + 1;
        added = true;
      }
    }
    if (!added) break;
  }

  return result;
}

export function getPhrasePronunciationTips(
  phraseText: string,
  region: DialectRegion,
  maxTips = 3,
): PhrasePronunciationTip[] {
  const tokens = tokenizePhraseWords(phraseText);
  if (tokens.length === 0) return [];

  const dialectTips = collectDialectTips(tokens, region);
  const toneTips = collectToneTips(tokens, region);
  const soundTips = collectConsonantAndVowelTips(tokens);

  const selected = interleaveTips(dialectTips, toneTips, soundTips, maxTips);
  if (selected.length > 0) return selected;

  const meta = DIALECT_META[region];
  return [
    {
      id: `region-default-${region}`,
      category: "dialect",
      title: `${meta.regionName} rhythm`,
      detail: meta.pronunciationFocus,
      words: tokens.slice(0, 2).map((t) => t.display),
    },
  ];
}

export function getToneReferenceItems(region: DialectRegion): ToneReferenceItem[] {
  const isNorth = region === "north";
  return [
    {
      tone: "ngang",
      name: "Ngang",
      mark: "a",
      shortHint: "flat",
      summary: "Mid-level and steady",
      tip: "Hold a calm, even pitch from start to finish with no drop at the end.",
      exampleWord: "ba",
      exampleMeaning: "three / dad",
      contour: getRegionalToneContour("ngang", region),
    },
    {
      tone: "huyen",
      name: "Huyền",
      mark: "à",
      shortHint: "fall",
      summary: "Gentle low fall",
      tip: "Start below mid and let your voice trail smoothly downward like a relaxed sigh.",
      exampleWord: "bà",
      exampleMeaning: "grandmother",
      contour: getRegionalToneContour("huyen", region),
    },
    {
      tone: "sac",
      name: "Sắc",
      mark: "á",
      shortHint: "rise",
      summary: "Sharp high rise",
      tip: "Start mid-high and push sharply upward — crisp and bright, never lazy.",
      exampleWord: "bá",
      exampleMeaning: "uncle / hug (dialect)",
      contour: getRegionalToneContour("sac", region),
    },
    {
      tone: "hoi",
      name: "Hỏi",
      mark: "ả",
      shortHint: "dip",
      summary: isNorth ? "Low dipping curve" : "Dipping-rising (merges with ngã)",
      tip: isNorth
        ? "Dip low and scoop slightly back up — smoother and lower than ngã."
        : "Dip smoothly down then curve upward; sounds the same as ngã in everyday speech.",
      exampleWord: "phở",
      exampleMeaning: "pho noodle soup",
      contour: getRegionalToneContour("hoi", region),
    },
    {
      tone: "nga",
      name: "Ngã",
      mark: "ã",
      shortHint: isNorth ? "creak" : "dip",
      summary: isNorth ? "Creaky break + high rise" : "Merges with hỏi (dipping-rising)",
      tip: isNorth
        ? "Start mid, pause briefly with a light throat catch, then jump clearly upward."
        : "In Saigon and Central Vietnam, pronounce ngã with the same smooth dip-and-rise as hỏi.",
      exampleWord: "sữa",
      exampleMeaning: "milk",
      contour: getRegionalToneContour("nga", region),
    },
    {
      tone: "nang",
      name: "Nặng",
      mark: "ạ",
      shortHint: "drop",
      summary: "Short, heavy low drop",
      tip: "Drop low immediately and cut the vowel short from the chest.",
      exampleWord: "một",
      exampleMeaning: "one",
      contour: getRegionalToneContour("nang", region),
    },
  ];
}

export function getConsonantReferenceItems(region: DialectRegion): SoundReferenceItem[] {
  const isNorth = region === "north";
  const isSouth = region === "south";

  return [
    {
      id: "ref-d-gi",
      symbol: "d / gi",
      soundAs: isNorth ? '"z" (zoo)' : '"y" (yes)',
      tip: isNorth
        ? 'Hanoi merges initial d, gi, and r into a crisp "z" sound.'
        : 'In Southern and Central speech, d and gi glide smoothly like "y", never "z".',
      exampleWord: "giờ",
      exampleMeaning: "hour / now",
      regionalHighlight: true,
    },
    {
      id: "ref-d-bar",
      symbol: "đ",
      soundAs: 'firm "d"',
      tip: 'Always a crisp "d" with your tongue tip behind your upper teeth — completely different from uncrossed d.',
      exampleWord: "đi",
      exampleMeaning: "to go",
    },
    {
      id: "ref-r",
      symbol: "r",
      soundAs: isNorth ? '"z" (zoo)' : 'tapped "r"',
      tip: isNorth
        ? 'In Hanoi, initial r merges with d and gi as a crisp "z".'
        : 'Tap your tongue tip lightly once — lighter than an English "r" and never Northern "z".',
      exampleWord: "rồi",
      exampleMeaning: "already / then",
      regionalHighlight: true,
    },
    {
      id: "ref-v",
      symbol: "v",
      soundAs: isSouth ? 'soft "y" / "v"' : 'crisp "v"',
      tip: isSouth
        ? 'Casual Saigon speakers often soften initial v toward a smooth "y" glide (vậy → "yuhy").'
        : 'Pronounce v cleanly like English "v" in Northern and Central speech.',
      exampleWord: "vậy",
      exampleMeaning: "so / like that",
      regionalHighlight: isSouth,
    },
    {
      id: "ref-ng",
      symbol: "ng / ngh",
      soundAs: '"ng" (sing)',
      tip: 'Start with the "ng" at the end of "sing" and open smoothly into the vowel without adding a hard "g".',
      exampleWord: "ngon",
      exampleMeaning: "delicious",
    },
    {
      id: "ref-nh",
      symbol: "nh",
      soundAs: '"ny" (canyon)',
      tip: 'Press the middle of your tongue against the roof of your mouth like "ny" in "canyon".',
      exampleWord: "nha",
      exampleMeaning: "friendly softener",
    },
    {
      id: "ref-kh",
      symbol: "kh",
      soundAs: 'breathy "kh"',
      tip: 'Gentle throat friction from the back of the tongue — much softer than English "k".',
      exampleWord: "không",
      exampleMeaning: "no / not",
    },
    {
      id: "ref-th",
      symbol: "th vs. t",
      soundAs: 'th = "t" + air',
      tip: 'Vietnamese th is an aspirated "t" (like "tea"), never English "th" (think). Plain t has no puff of air.',
      exampleWord: "thẳng",
      exampleMeaning: "straight",
    },
    {
      id: "ref-ph",
      symbol: "ph",
      soundAs: 'clean "f"',
      tip: 'Always a clean "f" sound, never "p" followed by "h".',
      exampleWord: "phở",
      exampleMeaning: "pho noodle soup",
    },
    {
      id: "ref-tr",
      symbol: "tr vs. ch",
      soundAs: isNorth ? 'both near "ch"' : 'curled "tr"',
      tip: isNorth
        ? "In casual Hanoi speech, tr softens to sound very close to ch."
        : "Curl your tongue slightly back for tr so it contrasts clearly with flat ch.",
      exampleWord: "trái",
      exampleMeaning: "left / fruit",
      regionalHighlight: true,
    },
    {
      id: "ref-nh-ch-end",
      symbol: "-nh / -ch",
      soundAs: isNorth ? "-nh / -ch" : "soft -n / -t",
      tip: isNorth
        ? "Hanoi keeps palatal -nh and -ch endings crisp."
        : 'Southern and Central accents relax final -nh and -ch toward -n and -t (tính → "tin").',
      exampleWord: "tính",
      exampleMeaning: "to calculate / bill",
      regionalHighlight: !isNorth,
    },
    {
      id: "ref-stops",
      symbol: "-p / -t / -c",
      soundAs: "unreleased stop",
      tip: "Close your lips or tongue cleanly to stop the vowel, without releasing a puff of air at the end.",
      exampleWord: "chút",
      exampleMeaning: "a little bit",
    },
  ];
}

export function getVowelReferenceItems(): SoundReferenceItem[] {
  return [
    {
      id: "ref-u-horn",
      symbol: "ư",
      soundAs: 'unrounded "oo"',
      tip: 'Pull your lips back in a relaxed smile while trying to say "oo" — keep lips completely flat.',
      exampleWord: "tư",
      exampleMeaning: "fourth / private",
    },
    {
      id: "ref-o-horn",
      symbol: "ơ",
      soundAs: 'open "uh"',
      tip: 'Relax your jaw and say a steady "uh" (like "her" without the "r"), with unrounded lips.',
      exampleWord: "phở",
      exampleMeaning: "pho noodle soup",
    },
    {
      id: "ref-uo",
      symbol: "ươ / ưa",
      soundAs: '"uh-uh" glide',
      tip: "Keep lips unrounded and glide smoothly from ư into ơ/a — one of the most common Vietnamese sounds.",
      exampleWord: "nước",
      exampleMeaning: "water / country",
    },
    {
      id: "ref-a-breve",
      symbol: "ă vs. a",
      soundAs: 'short crisp "a"',
      tip: "ă is shorter and snappier than plain a, and always appears before a final consonant.",
      exampleWord: "ăn",
      exampleMeaning: "to eat",
    },
    {
      id: "ref-a-hat",
      symbol: "â",
      soundAs: 'short "uh"',
      tip: 'A quick, clipped "uh" (like "but") — shorter than ơ and always followed by a final sound.',
      exampleWord: "gần",
      exampleMeaning: "near / close",
    },
    {
      id: "ref-o-hat",
      symbol: "ô vs. o",
      soundAs: 'closed "oh" vs. "aw"',
      tip: 'Round your lips tightly for ô ("oh"), and drop your jaw wider for plain o ("aw").',
      exampleWord: "cô",
      exampleMeaning: "aunt / miss",
    },
    {
      id: "ref-rounded-end",
      symbol: "-ong / -ông / -oc",
      soundAs: "lip-closed ending",
      tip: 'After o, ô, or u, close your lips lightly at the end of -ng or -c (không finishes almost like "-ngm").',
      exampleWord: "nóng",
      exampleMeaning: "hot",
    },
  ];
}
