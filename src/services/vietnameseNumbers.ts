import type { DialectRegion, NumericInterpretation } from "../types/vietnamese";

const ONES_VI = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

const EN_WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const VI_ONES_MAP: Record<string, number> = {
  khong: 0,
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
  muoi: 10,
};

const VI_NUMERIC_UNITS = new Set(["nghin", "ngan", "tram", "trieu", "chuc", "muoi", "ruoi"]);

export interface NumericTranslationOutput {
  primaryTranslation: string;
  regionalVariants?: {
    north: string;
    central: string;
    south: string;
  };
  streetNote: string;
  interpretation: NumericInterpretation;
}

function pickUnitSuffix(ones: number): string {
  if (ones === 1) return "mốt";
  if (ones === 4) return "tư";
  if (ones === 5) return "lăm";
  return ONES_VI[ones] ?? "";
}

function formatUnderHundred(n: number, casualShort: boolean): string {
  if (n < 10) return ONES_VI[n] ?? String(n);
  if (n === 10) return "mười";
  if (n < 20) {
    const unit = n % 10;
    return unit === 5 ? "mười lăm" : `mười ${ONES_VI[unit] ?? ""}`.trim();
  }

  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensWord = ONES_VI[tens] ?? "";

  if (ones === 0) {
    return casualShort ? `${tensWord} chục` : `${tensWord} mươi`;
  }

  const suffix = pickUnitSuffix(ones);
  return casualShort ? `${tensWord} ${suffix}` : `${tensWord} mươi ${suffix}`;
}

function formatUnderThousand(n: number, casualShort: boolean): string {
  if (n < 100) return formatUnderHundred(n, casualShort);
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const head = `${ONES_VI[hundreds] ?? ""} trăm`;
  if (rem === 0) return head;
  if (casualShort && rem === 50) return `${head} rưỡi`;
  if (rem < 10) return `${head} lẻ ${ONES_VI[rem] ?? ""}`;
  return `${head} ${formatUnderHundred(rem, casualShort)}`;
}

export function formatVietnameseNumber(
  value: number,
  region: DialectRegion,
  isVnd: boolean,
): string {
  if (!Number.isFinite(value) || value < 0 || value > 999_999_999) {
    return String(value);
  }

  const casual = region !== "north";
  const thousandUnit = region === "north" ? "nghìn" : "ngàn";

  if (value >= 1_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const remThousands = Math.floor((value % 1_000_000) / 1000);
    const head = `${formatUnderThousand(millions, false)} triệu`;
    if (remThousands === 0) return head;
    if (casual && remThousands === 500) return `${head} rưỡi`;
    return `${head} ${formatUnderThousand(remThousands, casual)} ${thousandUnit}`;
  }

  if (value >= 1000) {
    const thousands = Math.floor(value / 1000);
    const rem = value % 1000;
    if (casual && thousands === 150 && rem === 0) {
      return "một trăm rưỡi ngàn";
    }
    const base = `${formatUnderThousand(thousands, casual)} ${thousandUnit}`;
    if (rem === 0) return base;
    if (casual && rem === 500) return `${base} rưỡi`;
    return `${base} ${formatUnderThousand(rem, casual)}`;
  }

  const spoken = formatUnderThousand(value, casual);
  return isVnd ? `${spoken} đồng` : spoken;
}

function parseEnglishDigitQuery(compact: string): { value: number; isVnd: boolean } | null {
  const digitMatch = /^(\d{1,9})\s*(k|thousand|vnd|dong)?$/.exec(compact);
  if (!digitMatch?.[1]) return null;
  const raw = Number(digitMatch[1]);
  const unit = digitMatch[2];
  if (unit === "k" || unit === "thousand") {
    return { value: raw * 1000, isVnd: true };
  }
  return { value: raw, isVnd: Boolean(unit) || raw >= 1000 };
}

function applyEnglishMultiplier(word: string, state: { current: number; total: number }): boolean {
  if (word === "hundred" && state.current > 0) {
    state.current *= 100;
    return true;
  }
  if (word === "thousand") {
    state.total += (state.current > 0 ? state.current : 1) * 1000;
    state.current = 0;
    return true;
  }
  if (word === "million") {
    state.total += (state.current > 0 ? state.current : 1) * 1_000_000;
    state.current = 0;
    return true;
  }
  return false;
}

function parseEnglishWordQuery(
  compact: string,
  isVndHint: boolean,
): { value: number; isVnd: boolean } | null {
  const words = compact
    .replace(/\b(vnd|dong)\b/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;

  const state = { current: 0, total: 0 };
  for (const word of words) {
    const val = EN_WORD_NUMBERS[word];
    if (val !== undefined) {
      state.current += val;
    } else if (!applyEnglishMultiplier(word, state)) {
      return null;
    }
  }

  const value = state.total + state.current;
  return { value, isVnd: isVndHint || value >= 1000 };
}

function parseEnglishNumberQuery(normQuery: string): { value: number; isVnd: boolean } | null {
  const compact = normQuery.replace(/\s+/g, " ").trim();
  const digitResult = parseEnglishDigitQuery(compact);
  if (digitResult) return digitResult;

  const isVndHint = /\b(vnd|dong|k)\b/.test(compact) || /^\d+\s*k$/.test(compact);
  return parseEnglishWordQuery(compact, isVndHint);
}

function parseSingleDigitValue(token: string): number | null {
  const val = VI_ONES_MAP[token];
  return val !== undefined && val < 10 ? val : null;
}

function parseCompoundTens(rest: string[]): number | null {
  const t0 = rest[0] ?? "";
  const t1 = rest[1] ?? "";
  const t2 = rest[2];

  const tensDigit = VI_ONES_MAP[t0];
  if (tensDigit === undefined || tensDigit < 2 || tensDigit > 9) return null;

  const hasTenMarker = t1 === "muoi" || t1 === "chuc";
  if (hasTenMarker && rest.length === 2) return tensDigit * 10;

  if (hasTenMarker && t2 !== undefined && rest.length === 3) {
    const ones = parseSingleDigitValue(t2);
    return ones !== null ? tensDigit * 10 + ones : null;
  }

  if (rest.length === 2) {
    const ones = parseSingleDigitValue(t1);
    return ones !== null && ones >= 1 ? tensDigit * 10 + ones : null;
  }

  return null;
}

function parseTensTokens(rest: string[]): number | null {
  if (rest.length === 1) {
    return VI_ONES_MAP[rest[0] ?? ""] ?? null;
  }
  if (rest[0] === "muoi" && rest.length === 2) {
    const ones = parseSingleDigitValue(rest[1] ?? "");
    return ones !== null ? 10 + ones : null;
  }
  return parseCompoundTens(rest);
}

function parseUnderThousandTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    const t0 = tokens[0] ?? "";
    return /^\d+$/.test(t0) ? Number(t0) : (VI_ONES_MAP[t0] ?? null);
  }

  let total = 0;
  let idx = 0;

  if (tokens[1] === "tram") {
    const h = VI_ONES_MAP[tokens[0] ?? ""];
    if (h === undefined) return null;
    total += h * 100;
    idx = 2;
    if (idx === tokens.length) return total;
    if (tokens[idx] === "ruoi") return total + 50;
    if (tokens[idx] === "le" || tokens[idx] === "linh") idx++;
  }

  const rest = tokens.slice(idx);
  if (rest.length === 0) return total;
  const tensVal = parseTensTokens(rest);
  return tensVal === null ? null : total + tensVal;
}

function parseWithMillionMarker(
  tokens: string[],
  trieuIdx: number,
): { value: number; isVnd: boolean } | null {
  const mill = parseUnderThousandTokens(tokens.slice(0, trieuIdx));
  if (mill === null) return null;

  const afterTrieu = tokens.slice(trieuIdx + 1);
  if (afterTrieu.length === 0) return { value: mill * 1_000_000, isVnd: true };
  if (afterTrieu.length === 1 && afterTrieu[0] === "ruoi") {
    return { value: mill * 1_000_000 + 500_000, isVnd: true };
  }

  const rem = parseVietnameseNumberQuery(afterTrieu.join(" "));
  if (!rem) return null;
  const tail = rem.value < 1000 ? rem.value * 1000 : rem.value;
  return { value: mill * 1_000_000 + tail, isVnd: true };
}

function parseWithThousandMarker(
  tokens: string[],
  kIdx: number,
): { value: number; isVnd: boolean } | null {
  const thousands = parseUnderThousandTokens(tokens.slice(0, kIdx));
  if (thousands === null) return null;

  const afterK = tokens.slice(kIdx + 1);
  if (afterK.length === 0) return { value: thousands * 1000, isVnd: true };
  if (afterK.length === 1 && afterK[0] === "ruoi") {
    return { value: thousands * 1000 + 500, isVnd: true };
  }

  const rem = parseUnderThousandTokens(afterK);
  return rem === null ? null : { value: thousands * 1000 + rem, isVnd: true };
}

function parseVietnameseNumberQuery(normQuery: string): { value: number; isVnd: boolean } | null {
  const cleaned = normQuery.replace(/\b(dong|vnd)\b/g, "").trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.some((t) => VI_NUMERIC_UNITS.has(t))) {
    return null;
  }

  const trieuIdx = tokens.indexOf("trieu");
  if (trieuIdx > 0) return parseWithMillionMarker(tokens, trieuIdx);

  const kIdx = tokens.findIndex((t) => t === "nghin" || t === "ngan");
  if (kIdx > 0) return parseWithThousandMarker(tokens, kIdx);

  const base = parseUnderThousandTokens(tokens);
  if (base === null) return null;

  const isChucPrice = tokens.includes("chuc") && base >= 10 && base <= 90;
  return {
    value: isChucPrice ? base * 1000 : base,
    isVnd: isChucPrice,
  };
}

function formatVndLabel(value: number, isVnd: boolean): string {
  const formatted = value.toLocaleString("en-US");
  if (!isVnd) return formatted;
  if (value >= 1000 && value % 1000 === 0) {
    return `${formatted} VND (${String(value / 1000)}k)`;
  }
  return `${formatted} VND`;
}

export function translateNumericQuery(
  normQuery: string,
  direction: "en-vi" | "vi-en",
  region: DialectRegion,
): NumericTranslationOutput | null {
  if (direction === "en-vi") {
    const parsed = parseEnglishNumberQuery(normQuery);
    if (!parsed) return null;
    const north = formatVietnameseNumber(parsed.value, "north", parsed.isVnd);
    const central = formatVietnameseNumber(parsed.value, "central", parsed.isVnd);
    const south = formatVietnameseNumber(parsed.value, "south", parsed.isVnd);
    const primary = region === "north" ? north : region === "central" ? central : south;
    const label = formatVndLabel(parsed.value, parsed.isVnd);

    return {
      primaryTranslation: primary,
      regionalVariants: { north, central, south },
      streetNote: parsed.isVnd
        ? `Price (${label}): North uses "mươi / nghìn", while Central & South say "chục / ngàn" and often drop "đồng" aloud.`
        : `Number (${label}): Regional pronunciation and tens/thousands wording adapted automatically.`,
      interpretation: {
        value: parsed.value,
        kind: parsed.isVnd ? "vnd" : "number",
        displayLabel: label,
      },
    };
  }

  const parsed = parseVietnameseNumberQuery(normQuery);
  if (!parsed) return null;
  const label = formatVndLabel(parsed.value, parsed.isVnd);
  return {
    primaryTranslation: label,
    streetNote: parsed.isVnd
      ? `Spoken Vietnamese price equivalent. Note that market vendors often say "chục" (tens of thousands) without adding "ngàn".`
      : `Numeric value parsed from spoken Vietnamese.`,
    interpretation: {
      value: parsed.value,
      kind: parsed.isVnd ? "vnd" : "number",
      displayLabel: label,
    },
  };
}
