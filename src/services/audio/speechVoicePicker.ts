import type { DialectRegion, TtsVoiceProfile } from "../../types/vietnamese";

export interface SpeechVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
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
const NATURAL_VOICE_REGEX = /natural|neural|enhanced|premium|wavenet|online|google/i;

function matchVoiceByProfile<T extends { name: string; voiceURI?: string }>(
  candidates: T[],
  voiceProfile: TtsVoiceProfile | undefined,
): T[] {
  if (!voiceProfile || voiceProfile === "auto") return candidates;
  const regex = voiceProfile === "female" ? FEMALE_VOICE_REGEX : MALE_VOICE_REGEX;
  const matched = candidates.filter((v) => regex.test(`${v.name} ${v.voiceURI ?? ""}`));
  return matched.length > 0 ? matched : candidates;
}

function matchRegionalVoiceByName<T extends { name: string }>(
  candidates: T[],
  region: DialectRegion,
): T | null {
  if (region === "south") {
    return candidates.find((v) => SOUTH_VOICE_REGEX.test(v.name)) ?? null;
  }
  if (region === "central") {
    return candidates.find((v) => CENTRAL_VOICE_REGEX.test(v.name)) ?? null;
  }
  return candidates.find((v) => NORTH_VOICE_REGEX.test(v.name)) ?? null;
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
    const matched = matchRegionalVoiceByName(candidates, region);
    if (matched) return matched;
  }

  if (isOffline) {
    const localFirst = candidates.find((v) => v.localService);
    return localFirst ?? candidates[0] ?? null;
  }

  const naturalVoice = candidates.find((v) => NATURAL_VOICE_REGEX.test(v.name));
  if (naturalVoice) return naturalVoice;

  const localFirst = candidates.find((v) => v.localService);
  return localFirst ?? candidates[0] ?? null;
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
    const regional = matchRegionalVoiceByName(candidates, region);
    if (regional) return regional;
  }
  return candidates.find((v) => v.localService) ?? candidates[0] ?? null;
}
