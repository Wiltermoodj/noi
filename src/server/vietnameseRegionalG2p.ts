import type { DialectRegion } from "../types/vietnamese.ts";

export interface PhonemeChunk {
  text: string;
  phonemes: string;
  tokens: number[];
}

export const KOKORO_VOCAB: Readonly<Record<string, number>> = {
  ";": 1,
  ":": 2,
  ",": 3,
  ".": 4,
  "!": 5,
  "?": 6,
  "—": 9,
  "…": 10,
  '"': 11,
  "(": 12,
  ")": 13,
  "“": 14,
  "”": 15,
  " ": 16,
  "\u0303": 17,
  ʣ: 18,
  ʥ: 19,
  ʦ: 20,
  ʨ: 21,
  ᵝ: 22,
  "\uAB67": 23,
  A: 24,
  I: 25,
  O: 31,
  Q: 33,
  S: 35,
  T: 36,
  W: 39,
  Y: 41,
  ᵊ: 42,
  a: 43,
  b: 44,
  c: 45,
  d: 46,
  e: 47,
  f: 48,
  h: 50,
  i: 51,
  j: 52,
  k: 53,
  l: 54,
  m: 55,
  n: 56,
  o: 57,
  p: 58,
  q: 59,
  r: 60,
  s: 61,
  t: 62,
  u: 63,
  v: 64,
  w: 65,
  x: 66,
  y: 67,
  z: 68,
  ɑ: 69,
  ɐ: 70,
  ɒ: 71,
  æ: 72,
  β: 75,
  ɔ: 76,
  ɕ: 77,
  ç: 78,
  ɖ: 80,
  ð: 81,
  ʤ: 82,
  ə: 83,
  ɚ: 85,
  ɛ: 86,
  ɜ: 87,
  ɟ: 90,
  ɡ: 92,
  ɥ: 99,
  ɨ: 101,
  ɪ: 102,
  ʝ: 103,
  ɯ: 110,
  ɰ: 111,
  ŋ: 112,
  ɳ: 113,
  ɲ: 114,
  ɴ: 115,
  ø: 116,
  ɸ: 118,
  θ: 119,
  œ: 120,
  ɹ: 123,
  ɾ: 125,
  ɻ: 126,
  ʁ: 128,
  ɽ: 129,
  ʂ: 130,
  ʃ: 131,
  ʈ: 132,
  ʧ: 133,
  ʊ: 135,
  ʋ: 136,
  ʌ: 138,
  ɣ: 139,
  ɤ: 140,
  χ: 142,
  ʎ: 143,
  ʒ: 147,
  ʔ: 148,
  ˈ: 156,
  ˌ: 157,
  ː: 158,
  ʰ: 162,
  ʲ: 164,
  "↓": 169,
  "→": 171,
  "↗": 172,
  "↘": 173,
  ᵻ: 177,
};

type ToneNumber = 1 | 2 | 3 | 4 | 5 | 6;

const COMBINING_TO_TONE: Readonly<Record<string, ToneNumber>> = {
  "\u0300": 2, // huyền
  "\u0301": 3, // sắc
  "\u0309": 4, // hỏi
  "\u0303": 5, // ngã
  "\u0323": 6, // nặng
};

const LOANWORD_PHONEMES: Readonly<Record<string, string>> = {
  wifi: "wˈaɪfaɪ",
  pass: "pˈæs",
  size: "sˈaɪz",
  toilet: "tˈɔɪlᵻt",
  bye: "bˈaɪ",
  menu: "mˈɛnjuː",
  bill: "bˈɪl",
  taxi: "tˈæksi",
  grab: "ɡɹˈæb",
  zalo: "zˈaːlo",
  flan: "fˈlaːn",
  sim: "sˈɪm",
  atm: "eɪ tiː ɛm",
  ok: "oʊkˈeɪ",
  qr: "kjuː ɑːɹ",
  app: "ˈæp",
  bus: "bˈʌs",
  bar: "bˈɑːɹ",
  spa: "spˈɑː",
  hotel: "hoʊtˈɛl",
  visa: "vˈiːzə",
  card: "kˈɑːɹd",
  cash: "kˈæʃ",
  vegan: "vˈiːɡən",
  coffee: "kˈɔfi",
  cafe: "kæfˈeɪ",
  email: "ˈiːmeɪl",
  passcode: "pˈæskoʊd",
  password: "pˈæswɜːd",
  uber: "ˈuːbɚ",
  caramen: "kˈaː ɹˈaː mˈɛn",
  yaourt: "jˈaː ˈuə",
  drap: "ɡˈaː",
  nilon: "nˈi lˈɔŋ",
  vali: "vˈaː lˈi",
  check: "ʧˈɛk",
  out: "ˈaʊt",
  in: "ˈɪn",
  instagram: "ˈɪnstəɡɹæm",
};

const LETTER_SPELLING: Readonly<Record<string, string>> = {
  a: "eɪ",
  b: "biː",
  c: "siː",
  d: "diː",
  e: "iː",
  f: "ɛf",
  g: "ʤiː",
  h: "eɪʧ",
  i: "aɪ",
  j: "ʤeɪ",
  k: "keɪ",
  l: "ɛl",
  m: "ɛm",
  n: "ɛn",
  o: "oʊ",
  p: "piː",
  q: "kjuː",
  r: "ɑːɹ",
  s: "ɛs",
  t: "tiː",
  u: "juː",
  v: "viː",
  w: "dʌbəljuː",
  x: "ɛks",
  y: "waɪ",
  z: "ziː",
};

const DIGITS_VI = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"] as const;

const MAX_CHUNK_TOKENS = 460;

const ONES_AFTER_TENS: Record<number, string> = {
  1: "mốt",
  4: "tư",
  5: "lăm",
};

function digitWord(d: number): string {
  return DIGITS_VI[d] ?? "";
}

function readTensAndOnes(
  tens: number,
  ones: number,
  hasHundreds: boolean,
  region: DialectRegion,
): string[] {
  if (tens > 1) {
    const base = `${digitWord(tens)} mươi`;
    if (ones === 0) return [base];
    return [base, ONES_AFTER_TENS[ones] ?? digitWord(ones)];
  }
  if (tens === 1) {
    if (ones === 0) return ["mười"];
    return ["mười", ones === 5 ? "lăm" : digitWord(ones)];
  }
  if (ones === 0) return [];
  if (hasHundreds) {
    return [region === "north" ? "linh" : "lẻ", digitWord(ones)];
  }
  return [digitWord(ones)];
}

function readThreeDigitGroup(n: number, full: boolean, region: DialectRegion): string {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const hasHundreds = hundreds > 0 || full;
  const parts: string[] = hasHundreds ? [`${DIGITS_VI[hundreds] ?? "không"} trăm`] : [];
  parts.push(...readTensAndOnes(tens, ones, hasHundreds, region));
  return parts.join(" ");
}

function numberToVietnameseWords(raw: string, region: DialectRegion): string {
  const cleaned = raw.replace(/[.,]/g, "");
  const num = Number(cleaned);
  if (!Number.isSafeInteger(num) || num < 0 || num > 999_999_999) {
    return Array.from(cleaned, (ch) => DIGITS_VI[Number(ch)] ?? "").join(" ");
  }
  if (num === 0) return "không";

  const millions = Math.floor(num / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  const thousandWord = region === "north" ? "nghìn" : "ngàn";
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(`${readThreeDigitGroup(millions, false, region)} triệu`);
  }
  if (thousands > 0) {
    parts.push(`${readThreeDigitGroup(thousands, millions > 0, region)} ${thousandWord}`);
  }
  if (rest > 0) {
    parts.push(readThreeDigitGroup(rest, millions > 0 || thousands > 0, region));
  }

  return parts.join(" ");
}

function normalizeVietnameseInput(text: string, region: DialectRegion): string {
  return text
    .normalize("NFC")
    .replace(/\s*\/\s*/g, ", ")
    .replace(/(\d{1,3}(?:[.,]\d{3})+|\d+)/g, (match) => numberToVietnameseWords(match, region))
    .replace(/[–—]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractToneAndStripMark(word: string): { base: string; tone: ToneNumber } {
  const nfd = word.toLowerCase().normalize("NFD");
  let tone: ToneNumber = 1;
  let stripped = "";

  for (const ch of nfd) {
    const mapped = COMBINING_TO_TONE[ch];
    if (mapped !== undefined) {
      tone = mapped;
    } else {
      stripped += ch;
    }
  }

  return { base: stripped.normalize("NFC"), tone };
}

function toneToSymbol(tone: ToneNumber, region: DialectRegion): string {
  switch (tone) {
    case 1:
      return "";
    case 2:
      return "↘";
    case 3:
      return "↗";
    case 4:
      return "↓";
    case 5:
      // Northern Hanoi keeps glottalized high-rising ngã (ʔ↗);
      // Central & Southern dialects merge hỏi and ngã into the dipping contour (↓).
      return region === "north" ? "ʔ↗" : "↓";
    case 6:
      return "ʔ↓";
  }
}

interface SyllableParts {
  onset: string;
  medialW: boolean;
  vowel: string;
  coda: string;
}

const ORDERED_ONSETS = [
  "ngh",
  "ng",
  "nh",
  "ch",
  "gh",
  "gi",
  "kh",
  "ph",
  "qu",
  "th",
  "tr",
  "dz",
  "b",
  "c",
  "d",
  "đ",
  "g",
  "h",
  "k",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
  "x",
] as const;

const ORDERED_CODAS = ["nh", "ch", "ng", "m", "n", "p", "t", "c"] as const;

function splitOnset(base: string): { onset: string; rest: string } {
  if (base === "gi" || /^gi[mnptc]|^gi(nh|ch|ng)$/.test(base)) {
    return { onset: "gi", rest: base.slice(1) };
  }
  if (base.startsWith("giê")) {
    return { onset: "gi", rest: base.slice(1) };
  }
  for (const candidate of ORDERED_ONSETS) {
    if (base.startsWith(candidate)) {
      return { onset: candidate, rest: base.slice(candidate.length) };
    }
  }
  return { onset: "", rest: base };
}

function splitMedialAndRime(onset: string, rest: string): { medialW: boolean; rime: string } {
  if (onset === "qu") {
    return { medialW: true, rime: rest.length === 0 ? "u" : rest };
  }
  if (rest.length >= 2) {
    const first = rest.slice(0, 1);
    const second = rest.slice(1, 2);
    if (first === "o" && (second === "a" || second === "ă" || second === "e")) {
      return { medialW: true, rime: rest.slice(1) };
    }
    if (first === "u" && (second === "y" || second === "ê" || second === "â" || second === "ơ")) {
      return { medialW: true, rime: rest.slice(1) };
    }
  }
  return { medialW: false, rime: rest };
}

function splitCoda(rime: string): { vowel: string; coda: string } {
  for (const candidate of ORDERED_CODAS) {
    if (rime.endsWith(candidate) && rime.length > candidate.length) {
      return { vowel: rime.slice(0, -candidate.length), coda: candidate };
    }
  }
  if (rime.length >= 2 && (rime.endsWith("i") || rime.endsWith("y"))) {
    const pre = rime.slice(0, -1);
    if (
      pre === "a" ||
      pre === "â" ||
      pre === "o" ||
      pre === "ô" ||
      pre === "ơ" ||
      pre === "u" ||
      pre === "ư" ||
      pre === "uô" ||
      pre === "ươ"
    ) {
      return { vowel: pre, coda: rime.slice(-1) };
    }
  }
  if (rime.length >= 2 && (rime.endsWith("u") || rime.endsWith("o"))) {
    const pre = rime.slice(0, -1);
    if (
      pre === "a" ||
      pre === "â" ||
      pre === "e" ||
      pre === "ê" ||
      pre === "i" ||
      pre === "ư" ||
      pre === "iê" ||
      pre === "yê" ||
      pre === "ươ"
    ) {
      return { vowel: pre, coda: rime.slice(-1) };
    }
  }
  return { vowel: rime, coda: "" };
}

function parseVietnameseSyllable(base: string): SyllableParts | null {
  const { onset, rest } = splitOnset(base);
  if (!rest && onset !== "qu") return null;
  const { medialW, rime } = splitMedialAndRime(onset, rest);
  const { vowel, coda } = splitCoda(rime);
  if (!vowel) return null;
  return { onset, medialW, vowel, coda };
}

function mapOnsetToIpa(onset: string, base: string, region: DialectRegion): string {
  switch (onset) {
    case "":
      return "";
    case "b":
      return "b";
    case "p":
      return "p";
    case "ph":
      return "f";
    case "m":
      return "m";
    case "n":
      return "n";
    case "nh":
      return "ɲ";
    case "ng":
    case "ngh":
      return "ŋ";
    case "c":
    case "k":
    case "qu":
      return "k";
    case "g":
    case "gh":
      return "ɣ";
    case "kh":
      return "x";
    case "h":
      return "h";
    case "l":
      return "l";
    case "t":
      return "t";
    case "th":
      return "θ";
    case "đ":
      return "d";
    case "ch":
      return "ʧ";
    case "x":
      return "s";
    case "tr":
      return region === "north" ? "ʧ" : "ʈʂ";
    case "s":
      return region === "north" ? "s" : "ʂ";
    case "r":
      return region === "north" ? "z" : "ɹ";
    case "d":
    case "gi":
    case "dz":
      return region === "north" ? "z" : "j";
    case "v":
      // Casual Southern speech softens initial v to a smooth 'y' glide, while formal Việt/viết keeps 'v'.
      if (region === "south" && !base.startsWith("viê")) {
        return "j";
      }
      return "v";
    default:
      return "";
  }
}

const SIMPLE_NUCLEUS_IPA: Record<string, string> = {
  ă: "a",
  e: "ɛ",
  ê: "e",
  i: "i",
  y: "i",
  o: "ɔ",
  ô: "o",
  ơ: "əː",
  u: "u",
  ia: "iə",
  ya: "iə",
  iê: "iɛ",
  yê: "iɛ",
  ua: "uə",
  uô: "uə",
  ưa: "yə",
  ươ: "yə",
};

function mapNucleusToIpa(vowel: string, coda: string): string | null {
  if (vowel === "a") {
    if (coda === "nh" || coda === "ch") return "æ";
    return coda === "y" || coda === "u" ? "a" : "aː";
  }
  if (vowel === "â") return coda === "y" ? "əɪ" : "ə";
  if (vowel === "ư") return coda === "u" ? "i" : "y";
  return SIMPLE_NUCLEUS_IPA[vowel] ?? null;
}

function mapCodaToIpa(coda: string, vowel: string, region: DialectRegion): string {
  switch (coda) {
    case "":
      return "";
    case "m":
      return "m";
    case "n":
      return "n";
    case "p":
      return "p";
    case "t":
      return "t";
    case "ng":
      return "ŋ";
    case "c":
      return vowel === "o" || vowel === "ô" ? "k" : "c";
    case "nh":
      if (region !== "north" && (vowel === "i" || vowel === "y")) {
        return "n";
      }
      return "ɲ";
    case "ch":
      if (region !== "north" && (vowel === "i" || vowel === "y")) {
        return "t";
      }
      return "c";
    case "i":
    case "y":
      // "ây" is already mapped to the diphthong nucleus "əɪ" in Kokoro-Vietnamese
      return vowel === "â" && coda === "y" ? "" : "j";
    case "u":
    case "o":
      return "w";
    default:
      return "";
  }
}

function spellFallbackLetters(word: string): string {
  return Array.from(word.toLowerCase(), (ch) => LETTER_SPELLING[ch] ?? "")
    .filter(Boolean)
    .join(" ");
}

export function phonemizeVietnameseWord(word: string, region: DialectRegion): string {
  const lower = word.toLowerCase().normalize("NFC");
  const loanword = LOANWORD_PHONEMES[lower];
  if (loanword !== undefined) {
    return loanword;
  }

  const { base, tone } = extractToneAndStripMark(lower);
  const parsed = parseVietnameseSyllable(base);
  if (!parsed) {
    return spellFallbackLetters(lower);
  }

  const nucleus = mapNucleusToIpa(parsed.vowel, parsed.coda);
  if (nucleus === null) {
    return spellFallbackLetters(lower);
  }

  const onset = mapOnsetToIpa(parsed.onset, base, region);
  const medial = parsed.medialW ? "w" : "";
  const toneMark = toneToSymbol(tone, region);
  const coda = mapCodaToIpa(parsed.coda, parsed.vowel, region);

  return `${onset}${medial}ˈ${nucleus}${toneMark}${coda}`;
}

function encodePhonemeString(phonemes: string): number[] {
  const ids: number[] = [0];
  for (const ch of phonemes) {
    const id = KOKORO_VOCAB[ch];
    if (id !== undefined) {
      ids.push(id);
    }
  }
  ids.push(0);
  return ids;
}

function findChunkSplitIndex(words: string[]): number {
  for (const boundary of [/[.!?]$/u, /[,;:]$/u]) {
    for (let i = words.length - 1; i > 0; i--) {
      if (boundary.test(words[i - 1] ?? "")) {
        return i;
      }
    }
  }
  return words.length;
}

export function phonemizeVietnameseForRegion(
  text: string,
  region: DialectRegion,
): { normalized: string; chunks: PhonemeChunk[] } {
  const normalized = normalizeVietnameseInput(text, region);
  if (!normalized) {
    return { normalized: "", chunks: [] };
  }

  const rawTokens = normalized.match(/[\p{L}\p{M}]+|[.,!?;:…]/gu) ?? [];
  const chunks: PhonemeChunk[] = [];
  let words: string[] = [];
  let phones: string[] = [];

  const flush = (count = words.length): void => {
    if (count <= 0) return;
    const chunkPhones = phones.slice(0, count).join(" ").trim();
    const chunkText = words.slice(0, count).join(" ").trim();
    words = words.slice(count);
    phones = phones.slice(count);
    if (!chunkPhones) return;
    chunks.push({
      text: chunkText,
      phonemes: chunkPhones,
      tokens: encodePhonemeString(chunkPhones),
    });
  };

  for (const token of rawTokens) {
    const isWord = /^\p{L}/u.test(token);
    const phoneme = isWord ? phonemizeVietnameseWord(token, region) : token;
    if (!phoneme) continue;

    const candidateLength = [...phones, phoneme].join(" ").length;
    if (words.length > 0 && candidateLength > MAX_CHUNK_TOKENS) {
      flush(findChunkSplitIndex(words));
    }
    words.push(token);
    phones.push(phoneme);
  }
  flush();

  return { normalized, chunks };
}
