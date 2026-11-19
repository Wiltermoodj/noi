import type { DialectRegion, TtsVoiceProfile } from "../types/vietnamese";

export interface RegionalVoiceSpec {
  region: DialectRegion;
  voiceName: string;
  styleDirective: string;
  normalizedText: string;
  spokenText: string;
  tonalSummary: string;
}

interface PhrasePhonologyProfile {
  hoiWords: string[];
  ngaWords: string[];
  nangWords: string[];
  dGiWords: string[];
  rWords: string[];
  vWords: string[];
  trWords: string[];
  sWords: string[];
  nhChWords: string[];
  hasCentralParticles: boolean;
  hasSouthernParticles: boolean;
}

const COMBINING_TONE_MARKS: Record<string, "huyen" | "sac" | "hoi" | "nga" | "nang"> = {
  "\u0300": "huyen",
  "\u0301": "sac",
  "\u0309": "hoi",
  "\u0303": "nga",
  "\u0323": "nang",
};

const LOANWORD_ALLOWLIST = new Set([
  "wifi",
  "pass",
  "size",
  "toilet",
  "bye",
  "menu",
  "bill",
  "taxi",
  "grab",
]);

function detectWordTone(word: string): "ngang" | "huyen" | "sac" | "hoi" | "nga" | "nang" {
  const nfd = word.normalize("NFD");
  for (const ch of nfd) {
    const mapped = COMBINING_TONE_MARKS[ch];
    if (mapped) return mapped;
  }
  return "ngang";
}

function tokenizeWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").normalize("NFC"))
    .filter(Boolean);
}

function stripToneToAsciiLower(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export function normalizeTextForSpeech(text: string): string {
  return text
    .replace(/\s*\/\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPalatalOrCodaAfterGi(lower: string): boolean {
  return /^g[iìíỉĩị]($|[mnptc]|nh|ch|ng)/.test(lower);
}

function isViePrefix(lower: string): boolean {
  return /^v[iìíỉĩị][êềếểễệ]/.test(lower);
}

function toSouthernYForm(word: string): string {
  const lower = word.toLowerCase().normalize("NFC");
  if (lower.startsWith("dz")) return `y${lower.slice(2)}`;
  if (isPalatalOrCodaAfterGi(lower)) {
    return `y${lower.slice(1)}`;
  }
  if (lower.startsWith("gi")) return `y${lower.slice(2)}`;
  if (lower.startsWith("d")) return `y${lower.slice(1)}`;
  if (lower.startsWith("v") && !isViePrefix(lower)) return `y${lower.slice(1)}`;
  return lower;
}

function toNorthernZForm(word: string): string {
  const lower = word.toLowerCase().normalize("NFC");
  if (lower.startsWith("dz")) return `z${lower.slice(2)}`;
  if (/^g[iìíỉĩị]($|[mnptcêềếểễệ]|nh|ch|ng)/.test(lower)) {
    return `z${lower.slice(1)}`;
  }
  if (lower.startsWith("gi")) return `z${lower.slice(2)}`;
  if (lower.startsWith("d") || lower.startsWith("r")) return `z${lower.slice(1)}`;
  return lower;
}

function matchTokenCase(original: string, adaptedLower: string): string {
  if (!adaptedLower) return original;
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return adaptedLower.toUpperCase();
  }
  const first = original.slice(0, 1);
  if (first.length > 0 && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return `${adaptedLower.slice(0, 1).toUpperCase()}${adaptedLower.slice(1)}`;
  }
  return adaptedLower;
}

function replaceOnsetForNorth(lower: string): string {
  if (lower.startsWith("dz")) return `d${lower.slice(2)}`;
  if (lower.startsWith("tr")) return `ch${lower.slice(2)}`;
  if (lower.startsWith("r")) return `d${lower.slice(1)}`;
  return lower;
}

function replaceOnsetForCentralOrSouth(lower: string, softenV: boolean): string {
  if (lower.startsWith("dz")) return `y${lower.slice(2)}`;
  if (isPalatalOrCodaAfterGi(lower)) return `y${lower.slice(1)}`;
  if (lower.startsWith("gi")) return `y${lower.slice(2)}`;
  if (lower.startsWith("d")) return `y${lower.slice(1)}`;
  if (softenV && lower.startsWith("v") && !isViePrefix(lower)) return `y${lower.slice(1)}`;
  return lower;
}

function softenCentralSouthCoda(lower: string): string {
  if (lower.length >= 4 && /[iìíỉĩị]nh$/.test(lower)) {
    return lower.slice(0, -1);
  }
  if (lower.length >= 4 && /[iìíỉĩị]ch$/.test(lower)) {
    return `${lower.slice(0, -2)}t`;
  }
  return lower;
}

function adaptWordForRegion(token: string, region: DialectRegion): string {
  const lower = token.toLowerCase().normalize("NFC");
  if (LOANWORD_ALLOWLIST.has(lower)) return token;

  const adapted =
    region === "north"
      ? replaceOnsetForNorth(lower)
      : softenCentralSouthCoda(replaceOnsetForCentralOrSouth(lower, region === "south"));

  if (adapted === lower) return token;
  return matchTokenCase(token, adapted);
}

export function adaptTextForRegionalSpeech(text: string, region: DialectRegion): string {
  const normalized = normalizeTextForSpeech(text);
  return normalized.replace(/\p{L}+/gu, (token) => adaptWordForRegion(token, region));
}

function formatExamples(words: string[], transform?: (word: string) => string): string {
  const seen = new Set<string>();
  const formatted: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (transform) {
      formatted.push(`${lower} as '${transform(lower)}'`);
    } else {
      formatted.push(`'${lower}'`);
    }
    if (formatted.length >= 3) break;
  }
  return formatted.join(", ");
}

interface PhonologyBuckets {
  hoiWords: string[];
  ngaWords: string[];
  nangWords: string[];
  dGiWords: string[];
  rWords: string[];
  vWords: string[];
  trWords: string[];
  sWords: string[];
  nhChWords: string[];
}

function classifyWordIntoBuckets(word: string, buckets: PhonologyBuckets): void {
  const lower = word.toLowerCase();
  const ascii = stripToneToAsciiLower(lower);
  if (LOANWORD_ALLOWLIST.has(ascii)) return;

  const tone = detectWordTone(word);
  if (tone === "hoi") buckets.hoiWords.push(word);
  else if (tone === "nga") buckets.ngaWords.push(word);
  else if (tone === "nang") buckets.nangWords.push(word);

  if ((ascii.startsWith("d") || ascii.startsWith("gi")) && !lower.startsWith("đ")) {
    buckets.dGiWords.push(word);
  }
  if (ascii.startsWith("r")) buckets.rWords.push(word);
  if (ascii.startsWith("v")) buckets.vWords.push(word);
  if (ascii.startsWith("tr")) buckets.trWords.push(word);
  if (ascii.startsWith("s")) buckets.sWords.push(word);
  if (ascii.endsWith("nh") || ascii.endsWith("ch")) buckets.nhChWords.push(word);
}

export function analyzeVietnamesePhrasePhonology(text: string): PhrasePhonologyProfile {
  const buckets: PhonologyBuckets = {
    hoiWords: [],
    ngaWords: [],
    nangWords: [],
    dGiWords: [],
    rWords: [],
    vWords: [],
    trWords: [],
    sWords: [],
    nhChWords: [],
  };

  for (const word of tokenizeWords(text)) {
    classifyWordIntoBuckets(word, buckets);
  }

  const asciiLower = stripToneToAsciiLower(text);

  return {
    hoiWords: buckets.hoiWords.slice(0, 4),
    ngaWords: buckets.ngaWords.slice(0, 4),
    nangWords: buckets.nangWords.slice(0, 4),
    dGiWords: buckets.dGiWords.slice(0, 4),
    rWords: buckets.rWords.slice(0, 4),
    vWords: buckets.vWords.slice(0, 4),
    trWords: buckets.trWords.slice(0, 4),
    sWords: buckets.sWords.slice(0, 4),
    nhChWords: buckets.nhChWords.slice(0, 4),
    hasCentralParticles: /\b(ni|rua|mo|chi|no|rang|bay chu)\b/i.test(asciiLower),
    hasSouthernParticles: /\b(nha|hong|hen|dz?o|queo|mac|dem)\b/i.test(asciiLower),
  };
}

export function selectDialectVoiceName(
  region: DialectRegion,
  voiceProfile: TtsVoiceProfile,
): string {
  if (voiceProfile === "female") {
    if (region === "north") return "Kore";
    if (region === "central") return "Kore";
    return "Zephyr";
  }
  if (voiceProfile === "male") {
    if (region === "north") return "Charon";
    if (region === "central") return "Charon";
    return "Puck";
  }
  if (region === "north") return "Kore";
  if (region === "central") return "Puck";
  return "Zephyr";
}

function buildNorthDirectives(profile: PhrasePhonologyProfile): string[] {
  const cues = [
    "Warm, studio-clear native Northern Vietnamese (Hanoi) speaker with smooth conversational phrasing.",
  ];
  if (profile.ngaWords.length > 0 || profile.hoiWords.length > 0) {
    cues.push(
      "Use natural Hanoi 6-tone clarity, keeping hỏi dipping-low and ngã rising cleanly without strained vocal fry.",
    );
  }
  const zOnsets = [...profile.dGiWords, ...profile.rWords];
  if (zOnsets.length > 0) {
    const examples = formatExamples(zOnsets, toNorthernZForm);
    cues.push(`Pronounce initial d, gi, and r as a crisp voiced 'z' sound (${examples}).`);
  }
  if (profile.trWords.length > 0 || profile.sWords.length > 0) {
    cues.push("Soften initial tr toward 'ch' and s toward 'x' in natural Hanoi speech.");
  }
  if (profile.vWords.length > 0) {
    cues.push("Keep initial v as a crisp 'v'.");
  }
  return cues;
}

function buildCentralDirectives(profile: PhrasePhonologyProfile): string[] {
  const cues = [
    "Warm, studio-clear native Central Vietnamese (Da Nang / Hue) speaker with natural regional melody and resonant vowels.",
  ];
  if (profile.hoiWords.length > 0 || profile.ngaWords.length > 0) {
    cues.push("Use the natural Central 5-tone melody where hỏi and ngã merge smoothly.");
  }
  if (profile.nangWords.length > 0) {
    cues.push("Keep nặng tones grounded and natural.");
  }
  if (profile.dGiWords.length > 0) {
    const examples = formatExamples(profile.dGiWords, toSouthernYForm);
    cues.push(
      `Pronounce initial d and gi with a smooth 'y' glide like 'y' in 'yes', never 'z' (${examples}).`,
    );
  }
  if (profile.rWords.length > 0) {
    const examples = formatExamples(profile.rWords);
    cues.push(`Pronounce initial r as a clear tapped 'r', never 'z' (${examples}).`);
  }
  if (profile.vWords.length > 0) {
    cues.push("Keep initial v as a clear 'v'.");
  }
  if (profile.trWords.length > 0 || profile.sWords.length > 0) {
    cues.push("Keep retroflex tr and s crisp and distinct from ch and x.");
  }
  if (profile.nhChWords.length > 0) {
    cues.push("Soften final -nh and -ch slightly toward -n and -t.");
  }
  if (profile.hasCentralParticles) {
    cues.push(
      "Deliver Central expressions (ni, rứa, mô, chi, nỏ, răng) with authentic local cadence.",
    );
  }
  return cues;
}

function buildSouthDirectives(profile: PhrasePhonologyProfile): string[] {
  const cues = [
    "Warm, studio-clear native Southern Vietnamese (Ho Chi Minh City / Saigon) speaker with relaxed, natural Southern phrasing.",
  ];
  if (profile.hoiWords.length > 0 || profile.ngaWords.length > 0) {
    cues.push("Merge hỏi and ngã smoothly into a gentle Southern dipping-rising contour.");
  }
  if (profile.dGiWords.length > 0) {
    const examples = formatExamples(profile.dGiWords, toSouthernYForm);
    cues.push(
      `Pronounce initial d and gi strictly with a smooth 'y' glide like 'y' in 'yes', never 'z' (${examples}).`,
    );
  }
  const casualVWords = profile.vWords.filter(
    (word) => !isViePrefix(word.toLowerCase().normalize("NFC")),
  );
  if (casualVWords.length > 0) {
    const examples = formatExamples(casualVWords, toSouthernYForm);
    cues.push(`Soften casual Southern initial v toward a gentle 'y' glide (${examples}).`);
  }
  if (profile.rWords.length > 0) {
    const examples = formatExamples(profile.rWords);
    cues.push(`Pronounce initial r as a light tapped 'r', never Northern 'z' (${examples}).`);
  }
  if (profile.trWords.length > 0 || profile.sWords.length > 0) {
    cues.push("Keep retroflex tr and s distinct rather than flattening to ch and x.");
  }
  if (profile.nhChWords.length > 0) {
    cues.push(
      "Use natural Southern final -nh and -ch pronunciation, softening forward toward -n and -t.",
    );
  }
  if (profile.hasSouthernParticles) {
    cues.push("Keep Southern particles relaxed and conversational.");
  }
  return cues;
}

export function buildRegionalVoiceSpec(
  text: string,
  region: DialectRegion,
  slow: boolean,
  voiceProfile: TtsVoiceProfile,
): RegionalVoiceSpec {
  const normalizedText = normalizeTextForSpeech(text);
  const spokenText = adaptTextForRegionalSpeech(normalizedText, region);
  const profile = analyzeVietnamesePhrasePhonology(normalizedText);
  const voiceName = selectDialectVoiceName(region, voiceProfile);

  const cues =
    region === "north"
      ? buildNorthDirectives(profile)
      : region === "central"
        ? buildCentralDirectives(profile)
        : buildSouthDirectives(profile);

  const paceCue = slow
    ? "Speak slowly and clearly like a warm, patient native Vietnamese teacher helping a listener understand every word — keep vowels unhurried and resonant, articulate every tone and consonant cleanly with natural phrasing and gentle pauses between words, never rushed and never robotic."
    : "Speak at a clear, natural native pace.";

  const tonalSummary =
    region === "north"
      ? "Hanoi 6-tone (distinct hỏi/ngã)"
      : region === "central"
        ? "Da Nang / Hue Central tonal contour"
        : "Ho Chi Minh City 5-tone (smooth hỏi/ngã merge)";

  return {
    region,
    voiceName,
    styleDirective: [...cues, paceCue].join(" "),
    normalizedText,
    spokenText,
    tonalSummary,
  };
}
