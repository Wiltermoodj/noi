import type { DialectRegion, TtsVoiceProfile } from "../../types/vietnamese";

export interface SpeechVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  quality?: number | undefined;
}

export interface VoiceInventory {
  vi: SpeechVoiceInfo[];
  en: SpeechVoiceInfo[];
}

const SOUTH_VOICE_REGEX =
  /\bsouth|\bmiền nam\b|\bsaigon|\bsài gòn|\bhồ chí minh|\bho chi minh|\bhoaimy\b|\bhoài mỹ\b|\bmai\b|\blan\b/i;
const CENTRAL_VOICE_REGEX = /\bcentral|\bmiền trung\b|\bhuế\b|\bhue\b|\bđà nẵng|\bda nang/i;
const NORTH_VOICE_REGEX =
  /\bnorth|\bmiền bắc\b|\bhanoi|\bhà nội|\bnamminh\b|\bnam minh\b|\blinh\b|\ban\b|\bminh\b/i;
const FEMALE_VOICE_REGEX =
  /\bhoaimy\b|\bhoài mỹ\b|\blinh\b|\bmai\b|\blan\b|\bmy\b|\bthu\b|\bchi\b|\bngọc\b|\bngoc\b|\bfemale\b|\bnữ\b|vie-f|vi-vn-x-vic|vi-vn-x-vie/i;
const MALE_VOICE_REGEX =
  /\bnamminh\b|\bnam minh\b|\bminh\b|\ban\b|\btuấn\b|\btuan\b|\bhùng\b|\bhung\b|\bnam\b|\bmale\b|vi-vn-x-vid|vi-vn-x-vif|vi-vn-x-gft/i;
const NATURAL_VOICE_REGEX = /natural|neural|enhanced|premium|wavenet|online|google|siri|high/i;
const LOW_QUALITY_VOICE_REGEX = /\bespeak\b|\bcompact\b|\blegacy\b/i;

function matchVoiceByProfile<T extends { name: string; voiceURI?: string }>(
  candidates: T[],
  voiceProfile: TtsVoiceProfile | undefined,
): T[] {
  if (!voiceProfile || voiceProfile === "auto") return candidates;
  const regex = voiceProfile === "female" ? FEMALE_VOICE_REGEX : MALE_VOICE_REGEX;
  const matched = candidates.filter((v) => regex.test(`${v.name} ${v.voiceURI ?? ""}`));
  return matched.length > 0 ? matched : candidates;
}

function getRegionRegex(region: DialectRegion): RegExp {
  if (region === "south") return SOUTH_VOICE_REGEX;
  if (region === "central") return CENTRAL_VOICE_REGEX;
  return NORTH_VOICE_REGEX;
}

function matchRegionalVoiceByName<
  T extends {
    name: string;
    voiceURI?: string;
    localService?: boolean;
    quality?: number | undefined;
  },
>(candidates: T[], region: DialectRegion, preferLocal = false): T | null {
  const regex = getRegionRegex(region);
  const regionalMatches = candidates.filter((v) => regex.test(`${v.name} ${v.voiceURI ?? ""}`));
  if (regionalMatches.length === 0) return null;
  if (regionalMatches.length === 1) return regionalMatches[0] ?? null;
  const ranked = [...regionalMatches].sort(
    (a, b) => scoreVoiceFidelity(b, preferLocal) - scoreVoiceFidelity(a, preferLocal),
  );
  return ranked[0] ?? null;
}

function scoreVoiceFidelity(
  voice: {
    name: string;
    voiceURI?: string;
    localService?: boolean;
    quality?: number | undefined;
  },
  preferLocal: boolean,
): number {
  const descriptor = `${voice.name} ${voice.voiceURI ?? ""}`;
  let score = 0;
  if (preferLocal && voice.localService) {
    score += 40;
  } else if (voice.localService) {
    score += 10;
  }
  if (NATURAL_VOICE_REGEX.test(descriptor)) {
    score += 25;
  }
  if (typeof voice.quality === "number" && Number.isFinite(voice.quality)) {
    if (voice.quality >= 500) {
      score += 35;
    } else if (voice.quality >= 400) {
      score += 20;
    } else if (voice.quality < 300) {
      score -= 15;
    }
  }
  if (LOW_QUALITY_VOICE_REGEX.test(descriptor)) {
    score -= 30;
  }
  return score;
}

export function getBrowserSpeechPitch(
  region: DialectRegion | undefined,
  voiceProfile: TtsVoiceProfile | undefined,
  selectedVoiceName?: string,
): number {
  const name = selectedVoiceName ?? "";
  if (voiceProfile === "male" && !MALE_VOICE_REGEX.test(name)) {
    return 0.92;
  }
  if (voiceProfile === "female" && !FEMALE_VOICE_REGEX.test(name)) {
    return 1.06;
  }
  if (region === "central") {
    return 0.98;
  }
  return 1.0;
}

export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  langPrefix: "vi" | "en",
  isOffline: boolean,
  preferredURI?: string,
  region?: DialectRegion,
  voiceProfile?: TtsVoiceProfile,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  if (preferredURI) {
    const exact = voices.find(
      (v) => v.voiceURI === preferredURI && v.lang.toLowerCase().startsWith(langPrefix),
    );
    if (exact) return exact;
  }

  const allCandidates = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  if (allCandidates.length === 0) return null;

  const candidates =
    langPrefix === "vi" ? matchVoiceByProfile(allCandidates, voiceProfile) : allCandidates;

  if (langPrefix === "vi" && region) {
    const matched = matchRegionalVoiceByName(candidates, region, isOffline);
    if (matched) return matched;
  }

  if (isOffline) {
    const localCandidates = candidates.filter((v) => v.localService);
    const pool = localCandidates.length > 0 ? localCandidates : candidates;
    const ranked = [...pool].sort(
      (a, b) => scoreVoiceFidelity(b, true) - scoreVoiceFidelity(a, true),
    );
    return ranked[0] ?? null;
  }

  const naturalVoice = candidates.find(
    (v) => NATURAL_VOICE_REGEX.test(v.name) && !LOW_QUALITY_VOICE_REGEX.test(v.name),
  );
  if (naturalVoice) return naturalVoice;

  const localFirst = candidates.find(
    (v) => v.localService && !LOW_QUALITY_VOICE_REGEX.test(v.name),
  );
  return localFirst ?? candidates.find((v) => v.localService) ?? candidates[0] ?? null;
}

export function pickNativeAndroidVoice(
  voices: SpeechVoiceInfo[],
  langPrefix: "vi" | "en",
  preferredURI?: string,
  region?: DialectRegion,
  voiceProfile?: TtsVoiceProfile,
): SpeechVoiceInfo | null {
  const allCandidates = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  if (allCandidates.length === 0) return null;
  if (preferredURI) {
    const exact = allCandidates.find((v) => v.voiceURI === preferredURI);
    if (exact) return exact;
  }
  const candidates =
    langPrefix === "vi" ? matchVoiceByProfile(allCandidates, voiceProfile) : allCandidates;
  if (langPrefix === "vi" && region) {
    const regional = matchRegionalVoiceByName(candidates, region, true);
    if (regional) return regional;
  }
  const ranked = [...candidates].sort(
    (a, b) => scoreVoiceFidelity(b, true) - scoreVoiceFidelity(a, true),
  );
  return ranked[0] ?? null;
}
