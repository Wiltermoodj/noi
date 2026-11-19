import { DIALECT_META, type DialectRegion } from "../types/vietnamese";
import { normalizeText } from "./translationService";

export type WordMatchStatus = "exact" | "dialect" | "tone" | "close" | "missed";

export interface WordPronunciationFeedback {
  id: string;
  expected: string;
  spoken: string | null;
  status: WordMatchStatus;
  dialectNote?: string | undefined;
  measuredContour?: number[] | undefined;
}

export interface PronunciationEvaluation {
  accuracy: number;
  region: DialectRegion;
  bestTranscript: string;
  words: WordPronunciationFeedback[];
  feedbackMessage: string;
  hasToneHints: boolean;
  dialectMatchCount: number;
}

export interface RegionalPronunciationGuide {
  regionTitle: string;
  summary: string;
  cues: string[];
}

type ViTone = "ngang" | "huyen" | "sac" | "hoi" | "nga" | "nang";

interface SyllableFeatures {
  exact: string;
  baseWithVowels: string;
  ascii: string;
  tone: ViTone;
}

const TONE_MARKS: Record<string, ViTone> = {
  "\u0300": "huyen",
  "\u0301": "sac",
  "\u0309": "hoi",
  "\u0303": "nga",
  "\u0323": "nang",
};

const SPOKEN_DIGIT_WORDS: Record<string, string[]> = {
  "0": ["không"],
  "1": ["một"],
  "2": ["hai"],
  "3": ["ba"],
  "4": ["bốn"],
  "5": ["năm"],
  "6": ["sáu"],
  "7": ["bảy"],
  "8": ["tám"],
  "9": ["chín"],
  "10": ["mười"],
};

const SLANG_EQUIVALENTS: Record<string, string> = {
  dzô: "vô",
  dô: "vô",
  vô: "vô",
  tý: "tí",
  tí: "tí",
};

const STATUS_WEIGHTS: Record<WordMatchStatus, number> = {
  exact: 1,
  dialect: 0.95,
  tone: 0.65,
  close: 0.45,
  missed: 0,
};

function tokenizeDisplayWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

function expandSpokenTokens(transcript: string, region: DialectRegion): string[] {
  const raw = tokenizeDisplayWords(transcript);
  const expanded: string[] = [];
  for (const token of raw) {
    const lower = token.toLocaleLowerCase("vi");
    const digitWords = SPOKEN_DIGIT_WORDS[lower];
    if (digitWords) {
      expanded.push(...digitWords);
    } else if (lower === "50k") {
      expanded.push(
        "năm",
        region === "north" ? "mươi" : "chục",
        region === "north" ? "nghìn" : "ngàn",
      );
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

function extractSyllableFeatures(word: string): SyllableFeatures {
  const lowered = word.toLocaleLowerCase("vi").normalize("NFC");
  const canonical = SLANG_EQUIVALENTS[lowered] ?? lowered;
  const nfd = canonical.normalize("NFD");

  let tone: ViTone = "ngang";
  let stripped = "";
  for (const ch of nfd) {
    const mappedTone = TONE_MARKS[ch];
    if (mappedTone) {
      tone = mappedTone;
    } else {
      stripped += ch;
    }
  }

  return {
    exact: canonical,
    baseWithVowels: stripped.normalize("NFC"),
    ascii: normalizeText(canonical),
    tone,
  };
}

function normalizeRegionalBase(base: string, region: DialectRegion): string {
  let out = base;
  if (region === "north") {
    out = out.replace(/^(gi|r|d)/, "z");
    out = out.replace(/^tr/, "ch");
    out = out.replace(/^s/, "x");
    return out;
  }

  // Central & Southern shared coda & onset patterns
  if (region === "south") {
    out = out.replace(/^(gi|v|d|r)/, "y");
  } else {
    out = out.replace(/^(gi|d)/, "y");
  }
  out = out.replace(/nh$/, "n").replace(/ch$/, "t");
  return out;
}

function normalizeRegionalTone(tone: ViTone, region: DialectRegion): string {
  if (region !== "north" && (tone === "hoi" || tone === "nga")) {
    return "hoi_nga";
  }
  return tone;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    const chA = a[i - 1] ?? "";
    for (let j = 1; j <= n; j++) {
      const chB = b[j - 1] ?? "";
      const cost = chA === chB ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr.push(Math.min(del, ins, sub));
    }
    prev = curr;
  }
  return prev[n] ?? m;
}

function canonicalizePhoneticAscii(ascii: string): string {
  return ascii
    .replace(/ngh/g, "ng")
    .replace(/gh/g, "g")
    .replace(/c(?!h)/g, "k")
    .replace(/q/g, "k");
}

function isClosePhoneticMatch(exp: SyllableFeatures, spk: SyllableFeatures): boolean {
  const expCanon = canonicalizePhoneticAscii(exp.ascii);
  const spkCanon = canonicalizePhoneticAscii(spk.ascii);
  const maxLen = Math.max(expCanon.length, spkCanon.length);
  if (maxLen < 3) return false;

  const dist = levenshtein(expCanon, spkCanon);
  if (1 - dist / maxLen >= 0.7) return true;
  return dist === 1 && exp.tone === spk.tone;
}

function classifyPair(
  expectedWord: string,
  spokenWord: string,
  region: DialectRegion,
): { status: WordMatchStatus; score: number; dialectNote?: string } {
  const exp = extractSyllableFeatures(expectedWord);
  const spk = extractSyllableFeatures(spokenWord);

  if (exp.exact === spk.exact || exp.exact.replace(/y$/, "i") === spk.exact.replace(/y$/, "i")) {
    return { status: "exact", score: STATUS_WEIGHTS.exact };
  }

  const expRegBase = normalizeRegionalBase(exp.baseWithVowels, region);
  const spkRegBase = normalizeRegionalBase(spk.baseWithVowels, region);
  const expRegTone = normalizeRegionalTone(exp.tone, region);
  const spkRegTone = normalizeRegionalTone(spk.tone, region);

  if (expRegBase === spkRegBase && expRegTone === spkRegTone) {
    const label =
      region === "north" ? "Hanoi sound" : region === "central" ? "Da Nang sound" : "HCMC sound";
    return { status: "dialect", score: STATUS_WEIGHTS.dialect, dialectNote: label };
  }

  if (
    exp.baseWithVowels === spk.baseWithVowels ||
    (exp.ascii.length > 0 && exp.ascii === spk.ascii)
  ) {
    return { status: "tone", score: STATUS_WEIGHTS.tone };
  }

  if (isClosePhoneticMatch(exp, spk)) {
    return { status: "close", score: STATUS_WEIGHTS.close };
  }

  return { status: "missed", score: 0 };
}

interface AlignmentCell {
  score: number;
  op: "match" | "skipExp" | "skipSpk";
  matchStatus: WordMatchStatus;
  dialectNote?: string | undefined;
}

function pickBestCell(
  prevRow: AlignmentCell[],
  row: AlignmentCell[],
  expW: string,
  spkW: string,
  j: number,
  region: DialectRegion,
): AlignmentCell {
  const skipExpScore = prevRow[j]?.score ?? 0;
  const skipSpkScore = (row[j - 1]?.score ?? 0) - 0.05;
  let best: AlignmentCell =
    skipExpScore >= skipSpkScore
      ? { score: skipExpScore, op: "skipExp", matchStatus: "missed" }
      : { score: skipSpkScore, op: "skipSpk", matchStatus: "missed" };

  const pair = classifyPair(expW, spkW, region);
  if (pair.status !== "missed") {
    const matchScore = (prevRow[j - 1]?.score ?? 0) + pair.score;
    if (matchScore > best.score) {
      best = {
        score: matchScore,
        op: "match",
        matchStatus: pair.status,
        dialectNote: pair.dialectNote,
      };
    }
  }
  return best;
}

function buildAlignmentTable(
  expectedWords: string[],
  spokenTokens: string[],
  region: DialectRegion,
): AlignmentCell[][] {
  const m = expectedWords.length;
  const n = spokenTokens.length;
  const dp: AlignmentCell[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => ({
      score: 0,
      op: "skipExp" as const,
      matchStatus: "missed" as const,
    })),
  );

  const row0 = dp[0];
  if (row0) {
    for (let j = 1; j <= n; j++) {
      row0[j] = { score: -0.05 * j, op: "skipSpk", matchStatus: "missed" };
    }
  }

  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) continue;
    const expW = expectedWords[i - 1] ?? "";
    for (let j = 1; j <= n; j++) {
      row[j] = pickBestCell(prevRow, row, expW, spokenTokens[j - 1] ?? "", j, region);
    }
  }

  return dp;
}

function backtrackAlignment(
  dp: AlignmentCell[][],
  expectedWords: string[],
  spokenTokens: string[],
): WordPronunciationFeedback[] {
  const result: WordPronunciationFeedback[] = [];
  let i = expectedWords.length;
  let j = spokenTokens.length;

  while (i > 0) {
    const cell = dp[i]?.[j];
    const expW = expectedWords[i - 1] ?? "";
    const wordId = `${expW}-${String(i - 1)}`;

    if (cell?.op === "match") {
      result.push({
        id: wordId,
        expected: expW,
        spoken: spokenTokens[j - 1] ?? null,
        status: cell.matchStatus,
        dialectNote: cell.dialectNote,
      });
      i--;
      j--;
    } else if (cell?.op === "skipSpk" && j > 0) {
      j--;
    } else {
      result.push({ id: wordId, expected: expW, spoken: null, status: "missed" });
      i--;
    }
  }

  return result.reverse();
}

function alignTokens(
  expectedWords: string[],
  spokenTokens: string[],
  region: DialectRegion,
): WordPronunciationFeedback[] {
  const dp = buildAlignmentTable(expectedWords, spokenTokens, region);
  return backtrackAlignment(dp, expectedWords, spokenTokens);
}

function buildFeedbackMessage(
  accuracy: number,
  hasToneHints: boolean,
  region: DialectRegion,
): string {
  const city = region === "north" ? "Hanoi" : region === "central" ? "Da Nang" : "Ho Chi Minh City";
  if (accuracy >= 90) {
    return hasToneHints
      ? `Great ${city} clarity! Fine-tune the highlighted tone.`
      : `Spot-on ${city} pronunciation!`;
  }
  if (accuracy >= 70) {
    return hasToneHints
      ? "Good match — watch the amber tone words."
      : "Close! Try speaking the highlighted words more clearly.";
  }
  if (accuracy >= 40) {
    return "Getting there. Play 0.7x speed once, then repeat.";
  }
  return "Hard to match — listen at 0.7x speed and speak close to the mic.";
}

function evaluateSingleTarget(
  target: string,
  transcript: string,
  region: DialectRegion,
): PronunciationEvaluation {
  const expectedWords = tokenizeDisplayWords(target);
  const spokenTokens = expandSpokenTokens(transcript, region);

  if (expectedWords.length === 0) {
    return {
      accuracy: 0,
      region,
      bestTranscript: transcript.trim(),
      words: [],
      feedbackMessage: "Tap the mic and try speaking the phrase.",
      hasToneHints: false,
      dialectMatchCount: 0,
    };
  }

  const words = alignTokens(expectedWords, spokenTokens, region);
  let earnedPoints = 0;
  let hasToneHints = false;
  let dialectMatchCount = 0;

  for (const word of words) {
    earnedPoints += STATUS_WEIGHTS[word.status];
    if (word.status === "tone") hasToneHints = true;
    if (word.status === "dialect") dialectMatchCount++;
  }

  const accuracy = Math.min(100, Math.round((earnedPoints / expectedWords.length) * 100));
  return {
    accuracy,
    region,
    bestTranscript: transcript.trim(),
    words,
    feedbackMessage: buildFeedbackMessage(accuracy, hasToneHints, region),
    hasToneHints,
    dialectMatchCount,
  };
}

export function evaluatePronunciation(
  expectedPhrase: string,
  transcriptCandidates: string[],
  region: DialectRegion = "south",
): PronunciationEvaluation {
  const targets = expectedPhrase
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const targetList = targets.length > 0 ? targets : [expectedPhrase];
  const candidates = transcriptCandidates.map((t) => t.trim()).filter(Boolean);

  if (candidates.length === 0) {
    return evaluateSingleTarget(targetList[0] ?? expectedPhrase, "", region);
  }

  let best: PronunciationEvaluation | null = null;
  for (const target of targetList) {
    for (const candidate of candidates) {
      const current = evaluateSingleTarget(target, candidate, region);
      if (!best || current.accuracy > best.accuracy) {
        best = current;
      }
    }
  }

  return best ?? evaluateSingleTarget(targetList[0] ?? expectedPhrase, candidates[0] ?? "", region);
}

interface PhrasePhoneticFlags {
  hasDGi: boolean;
  hasR: boolean;
  hasV: boolean;
  hasTr: boolean;
  hasHoiOrNga: boolean;
  hasNhChEnding: boolean;
  hasCentralLexicon: boolean;
}

function inspectPhraseFlags(phraseText: string): PhrasePhoneticFlags {
  const words = tokenizeDisplayWords(phraseText);
  return {
    hasDGi: words.some((w) => /^(d|g[iìíỉĩị])/i.test(w.normalize("NFC"))),
    hasR: words.some((w) => /^r/i.test(w)),
    hasV: words.some((w) => /^v/i.test(w)),
    hasTr: words.some((w) => /^tr/i.test(w)),
    hasHoiOrNga: words.some((w) => {
      const tone = extractSyllableFeatures(w).tone;
      return tone === "hoi" || tone === "nga";
    }),
    hasNhChEnding: words.some((w) => /(nh|ch)$/i.test(normalizeText(w))),
    hasCentralLexicon: /\b(ni|rứa|mô|chi|nỏ)\b/i.test(phraseText),
  };
}

function collectNorthCues(flags: PhrasePhoneticFlags): string[] {
  const cues: string[] = [];
  if (flags.hasDGi || flags.hasR) cues.push('Say initial d, gi, and r as a crisp "z" sound.');
  if (flags.hasTr) cues.push('Pronounce "tr" close to "ch" in casual Hanoi speech.');
  if (flags.hasHoiOrNga) {
    cues.push("Keep hỏi (dipping) and ngã (creaky rising) tones clearly separated.");
  }
  return cues;
}

function collectCentralCues(flags: PhrasePhoneticFlags): string[] {
  const cues: string[] = [];
  if (flags.hasHoiOrNga) cues.push("Hỏi and ngã tones naturally merge in Da Nang / Hue speech.");
  if (flags.hasCentralLexicon) {
    cues.push("Uses authentic Central words (ni, rứa, mô, chi, nỏ) — lean into the rhythm.");
  }
  if (flags.hasDGi) {
    cues.push('Pronounce initial d and gi as a smooth "y" (never "z"), while keeping r tapped.');
  } else if (flags.hasR) {
    cues.push('Keep initial r as a clear tapped "r" rather than Northern "z".');
  }
  if (flags.hasNhChEnding) cues.push("Final -nh / -ch often soften slightly toward -n / -t.");
  return cues;
}

function collectSouthCues(flags: PhrasePhoneticFlags): string[] {
  const cues: string[] = [];
  if (flags.hasDGi) {
    cues.push('Pronounce initial d and gi smoothly like "y" (e.g., gì → "yee"), never "z".');
  } else if (flags.hasV) {
    cues.push('Casual Southern speech often softens initial v toward a gentle "y" glide.');
  }
  if (flags.hasHoiOrNga) {
    cues.push("Hỏi and ngã merge into one smooth dipping-rising tone in Ho Chi Minh City.");
  }
  if (flags.hasNhChEnding) cues.push("Final -nh / -ch soften toward -n / -t (e.g., tính → tín).");
  if (flags.hasR) cues.push('Keep initial r as a light tapped "r" rather than Northern "z".');
  return cues;
}

export function getRegionalPronunciationGuide(
  phraseText: string,
  region: DialectRegion,
): RegionalPronunciationGuide {
  const meta = DIALECT_META[region];
  const flags = inspectPhraseFlags(phraseText);
  const cues =
    region === "north"
      ? collectNorthCues(flags)
      : region === "central"
        ? collectCentralCues(flags)
        : collectSouthCues(flags);

  return {
    regionTitle: meta.fullRegionLabel,
    summary: meta.pronunciationFocus,
    cues: cues.length > 0 ? cues.slice(0, 2) : [meta.pronunciationFocus],
  };
}
