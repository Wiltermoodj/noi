import type { DialectRegion } from "../types/vietnamese";
import { abandonAndroidAudioFocus, requestAndroidAudioFocus } from "./noiAndroidBridge";
import { computePlaybackPacing } from "./playbackPacing";
import {
  getOrCreateSharedAudioContext,
  getSharedAudioContextConstructor,
  resumeSharedAudioContext,
} from "./sharedAudioContext";

export type ViToneName = "ngang" | "huyen" | "sac" | "hoi" | "nga" | "nang";

export interface ToneSyllableInfo {
  id: string;
  syllable: string;
  tone: ViToneName;
  toneLabel: string;
  contour: number[]; // Normalized 0..1 pitch height points (low..high)
}

const COMBINING_TONES: Record<string, ViToneName> = {
  "\u0300": "huyen",
  "\u0301": "sac",
  "\u0309": "hoi",
  "\u0303": "nga",
  "\u0323": "nang",
};

const TONE_LABELS: Record<ViToneName, string> = {
  ngang: "Flat (ngang)",
  huyen: "Low falling (huyền)",
  sac: "High rising (sắc)",
  hoi: "Dipping (hỏi)",
  nga: "Creaky rising (ngã)",
  nang: "Heavy drop (nặng)",
};

const LOANWORD_PHONETICS: Record<string, string> = {
  wifi: "wai-fai",
  pass: "pass",
  size: "sai",
  menu: "meh-noo",
  bill: "bill",
  taxi: "tak-see",
  toilet: "toy-let",
  bye: "bai",
  grab: "grab",
};

const VOWEL_PATTERNS: [RegExp, string][] = [
  [/^uyê$/, "wee-e"],
  [/^ươi$/, "uh-uhy"],
  [/^ươu$/, "uh-oo"],
  [/^ươ$/, "uh-uh"],
  [/^[iy]êu$/, "ee-ew"],
  [/^uôi$/, "oo-oy"],
  [/^uô$/, "oo-o"],
  [/^[iy]ê$/, "ee-e"],
  [/^oa[iy]$/, "wai"],
  [/^uây$/, "way"],
  [/^ưa$/, "uh-uh"],
  [/^ia$/, "ee-ah"],
  [/^ua$/, "oo-ah"],
  [/^âu$/, "oh"],
  [/^êu$/, "eh-oo"],
  [/^a[uo]$/, "ow"],
  [/^eo$/, "eh-o"],
  [/^ây$/, "uhy"],
  [/^a[iy]$/, "ai"],
  [/^[oô]i$/, "oy"],
  [/^ơi$/, "uhy"],
  [/^ui$/, "oo-ee"],
  [/^ưi$/, "uh-ee"],
  [/^iu$/, "ee-oo"],
  [/^oa$/, "wah"],
  [/^oe$/, "weh"],
  [/^uy$/, "wee"],
];

let activePlayTimer: number | null = null;
const activeSyllableTimers: number[] = [];
const activeOscillators: OscillatorNode[] = [];
let activePlayToken = 0;
let ownsAndroidAudioFocus = false;

export function detectSyllableTone(syllable: string): ViToneName {
  const nfd = syllable.normalize("NFD");
  for (const ch of nfd) {
    const tone = COMBINING_TONES[ch];
    if (tone) return tone;
  }
  return "ngang";
}

export function getRegionalToneContour(tone: ViToneName, region: DialectRegion): number[] {
  switch (tone) {
    case "ngang":
      return [0.58, 0.57, 0.56, 0.55];
    case "huyen":
      return [0.44, 0.36, 0.28, 0.22];
    case "sac":
      return [0.52, 0.62, 0.78, 0.94];
    case "hoi":
      return region === "north" ? [0.42, 0.24, 0.18, 0.3] : [0.4, 0.24, 0.36, 0.62];
    case "nga":
      return region === "north" ? [0.56, 0.32, 0.72, 0.96] : [0.4, 0.24, 0.36, 0.62];
    case "nang":
      return region === "central" ? [0.36, 0.2, 0.14, 0.12] : [0.38, 0.2, 0.1, 0.08];
  }
}

export function getRegionalToneLabel(tone: ViToneName, region: DialectRegion): string {
  if (region !== "north" && (tone === "hoi" || tone === "nga")) {
    return "Dipping-rising (merged hỏi/ngã)";
  }
  return TONE_LABELS[tone];
}

export function getPhraseToneSyllables(text: string, region: DialectRegion): ToneSyllableInfo[] {
  const rawWords = text
    .split("/")[0]
    ?.trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  if (!rawWords || rawWords.length === 0) return [];

  return rawWords.map((syllable, idx) => {
    const tone = detectSyllableTone(syllable);
    return {
      id: `${syllable}-${String(idx)}`,
      syllable,
      tone,
      toneLabel: getRegionalToneLabel(tone, region),
      contour: getRegionalToneContour(tone, region),
    };
  });
}

function stripToneMarksOnly(word: string): string {
  const nfd = word.toLowerCase().normalize("NFD");
  let out = "";
  for (const ch of nfd) {
    if (!COMBINING_TONES[ch]) {
      out += ch;
    }
  }
  return out.normalize("NFC");
}

function resolveSimpleOnset(ch: string, region: DialectRegion): string {
  if (ch === "d") return region === "north" ? "z" : "y";
  if (ch === "r") return region === "north" ? "z" : "r";
  if (ch === "v") return region === "south" ? "y" : "v";
  if (ch === "x") return "s";
  if (ch === "c") return "k";
  if (ch === "đ") return "d";
  return ch;
}

const STATIC_ONSETS: readonly [string, string][] = [
  ["ngh", "ng"],
  ["nh", "ny"],
  ["ng", "ng"],
  ["kh", "kh"],
  ["ph", "f"],
  ["th", "t"],
  ["gh", "g"],
  ["qu", "kw"],
  ["ch", "ch"],
];

function extractOnset(toneFree: string, region: DialectRegion): { onset: string; rest: string } {
  for (const [prefix, mapped] of STATIC_ONSETS) {
    if (toneFree.startsWith(prefix)) {
      return { onset: mapped, rest: toneFree.slice(prefix.length) };
    }
  }
  if (toneFree.startsWith("tr")) {
    return { onset: region === "north" ? "ch" : "tr", rest: toneFree.slice(2) };
  }
  if (toneFree.startsWith("dz")) {
    return { onset: region === "north" ? "z" : "y", rest: toneFree.slice(2) };
  }
  if (toneFree.startsWith("gi")) {
    const rawRest = toneFree.slice(2);
    const keepVowelI = rawRest.length === 0 || /^[mnptcê]|^(nh|ch|ng)/.test(rawRest);
    return {
      onset: region === "north" ? "z" : "y",
      rest: keepVowelI ? `i${rawRest}` : rawRest,
    };
  }

  if (toneFree.startsWith("viê")) {
    return { onset: "v", rest: toneFree.slice(1) };
  }

  const first = toneFree[0] ?? "";
  if ("bdfghklmnprstvxđc".includes(first)) {
    return { onset: resolveSimpleOnset(first, region), rest: toneFree.slice(1) };
  }
  return { onset: "", rest: toneFree };
}

function extractCoda(rest: string, region: DialectRegion): { nucleus: string; coda: string } {
  if (rest.endsWith("nh")) {
    return { nucleus: rest.slice(0, -2), coda: region === "north" ? "ng" : "n" };
  }
  if (rest.endsWith("ch")) {
    return { nucleus: rest.slice(0, -2), coda: region === "north" ? "k" : "t" };
  }
  if (rest.endsWith("ng")) {
    return { nucleus: rest.slice(0, -2), coda: "ng" };
  }
  const last = rest.at(-1) ?? "";
  if ("cmnpt".includes(last) && rest.length > 1) {
    return { nucleus: rest.slice(0, -1), coda: last === "c" ? "k" : last };
  }
  return { nucleus: rest, coda: "" };
}

function mapSingleVowel(ch: string, hasCoda: boolean, coda: string): string {
  switch (ch) {
    case "a":
      return hasCoda ? "a" : "ah";
    case "ă":
      return "a";
    case "â":
      return "uh";
    case "e":
      return "eh";
    case "ê":
      return hasCoda ? "e" : "eh";
    case "i":
    case "y":
      return coda === "n" || coda === "ng" || coda === "t" || coda === "k" ? "i" : "ee";
    case "o":
      return coda === "ng" || coda === "k" ? "o" : "aw";
    case "ô":
      return "oh";
    case "ơ":
    case "ư":
      return "uh";
    case "u":
      return "oo";
    default:
      return ch;
  }
}

function mapVowelNucleus(nucleus: string, coda: string): string {
  if (!nucleus) return "";
  for (const [pattern, replacement] of VOWEL_PATTERNS) {
    if (pattern.test(nucleus)) {
      return replacement;
    }
  }
  const hasCoda = coda.length > 0;
  let result = "";
  for (const ch of nucleus) {
    result += mapSingleVowel(ch, hasCoda, coda);
  }
  return result;
}

function approximateWord(word: string, region: DialectRegion): string {
  const lower = word.toLowerCase().normalize("NFC");
  const loanword = LOANWORD_PHONETICS[lower];
  if (loanword) return loanword;

  const toneFree = stripToneMarksOnly(lower);
  const { onset, rest } = extractOnset(toneFree, region);
  const { nucleus, coda } = extractCoda(rest, region);
  return `${onset}${mapVowelNucleus(nucleus, coda)}${coda}`;
}

export function approximateVietnamesePhonetic(text: string, region: DialectRegion): string {
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  return words.map((word) => approximateWord(word, region)).join(" ");
}

export function isToneAudioSupported(): boolean {
  return getSharedAudioContextConstructor() !== null;
}

export function stopToneContour(): void {
  activePlayToken++;
  if (typeof window !== "undefined") {
    if (activePlayTimer !== null) {
      window.clearTimeout(activePlayTimer);
      activePlayTimer = null;
    }
    while (activeSyllableTimers.length > 0) {
      const id = activeSyllableTimers.pop();
      if (id !== undefined) {
        window.clearTimeout(id);
      }
    }
  }
  while (activeOscillators.length > 0) {
    const osc = activeOscillators.pop();
    if (!osc) continue;
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // Ignore already-stopped oscillators
    }
  }
  if (ownsAndroidAudioFocus) {
    ownsAndroidAudioFocus = false;
    void abandonAndroidAudioFocus();
  }
}

function scheduleSyllableTone(
  ctx: AudioContext,
  syllable: ToneSyllableInfo,
  startTime: number,
  durationSec: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";

  const baseLowHz = 165;
  const spanHz = 145;
  const points = syllable.contour;
  const stepSec = durationSec / Math.max(1, points.length - 1);

  points.forEach((p, idx) => {
    const freq = baseLowHz + p * spanHz;
    if (idx === 0) {
      osc.frequency.setValueAtTime(freq, startTime);
    } else {
      osc.frequency.linearRampToValueAtTime(freq, startTime + idx * stepSec);
    }
  });

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(0.14, startTime + Math.min(0.05, durationSec * 0.12));
  if (syllable.tone === "nang") {
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec * 0.72);
  } else {
    gain.gain.linearRampToValueAtTime(0.12, startTime + durationSec * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
  }

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.onended = () => {
    const idx = activeOscillators.indexOf(osc);
    if (idx >= 0) {
      activeOscillators.splice(idx, 1);
    }
    try {
      gain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  };
  activeOscillators.push(osc);
  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.02);
}

export async function playVietnameseToneContour(
  text: string,
  region: DialectRegion,
  speedOrSlow: boolean | number = false,
  onSyllableIndex?: (index: number | null) => void,
): Promise<boolean> {
  const syllables = getPhraseToneSyllables(text, region);
  if (syllables.length === 0) {
    return false;
  }

  stopToneContour();
  const ctx = getOrCreateSharedAudioContext();
  if (!ctx) {
    return false;
  }
  const token = activePlayToken;

  ownsAndroidAudioFocus = true;
  void requestAndroidAudioFocus();
  await resumeSharedAudioContext(ctx);
  if (activePlayToken !== token) {
    return false;
  }
  if (ctx.state === "suspended") {
    stopToneContour();
    return false;
  }

  const speedPercent = typeof speedOrSlow === "number" ? speedOrSlow : speedOrSlow ? 70 : 100;
  const pacing = computePlaybackPacing(speedPercent);
  const noteSec = pacing.toneNoteSec;
  const gapSec = pacing.toneGapSec;
  const stepMs = (noteSec + gapSec) * 1000;
  const baseTime = ctx.currentTime + 0.03;

  syllables.forEach((syl, idx) => {
    scheduleSyllableTone(ctx, syl, baseTime + idx * (noteSec + gapSec), noteSec);
    if (onSyllableIndex && typeof window !== "undefined") {
      const timerId = window.setTimeout(() => {
        if (activePlayToken === token) {
          onSyllableIndex(idx);
        }
      }, idx * stepMs);
      activeSyllableTimers.push(timerId);
    }
  });

  const totalMs = Math.ceil(syllables.length * stepMs + 120);
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(true);
      return;
    }
    activePlayTimer = window.setTimeout(() => {
      if (activePlayToken === token) {
        onSyllableIndex?.(null);
        stopToneContour();
      }
      resolve(true);
    }, totalMs);
  });
}
