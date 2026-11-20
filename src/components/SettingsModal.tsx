import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type { ChangeEvent, FC, MouseEvent } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import {
  audioService,
  type OfflineAudioBudgetStats,
  type OfflinePackProgress,
  type SpeechVoiceInfo,
} from "../services/audioService";
import { isNativeAndroid, registerBackHandler } from "../services/nativePlatform";
import { openAndroidTtsSettings } from "../services/noiAndroidBridge";
import { type ImportAppStateResult, importSavedAppStateJson } from "../services/storageService";
import {
  type AppSettings,
  DIALECT_META,
  DIALECT_REGIONS,
  type DialectRegion,
  type Phrase,
  type ThemePreference,
  type TtsVoiceProfile,
} from "../types/vietnamese";
import { downloadAppBackupJson } from "../utils/backupDownload";
import { PWAInstallButton } from "./PWAInstallButton";

interface SettingsModalProps {
  open: boolean;
  phrases: Phrase[];
  settings: AppSettings;
  initialSection?: "general" | "audio-pack" | undefined;
  onClose: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onResetPhrases: () => void;
  onImportBackup?: ((rawJson: string) => ImportAppStateResult) | undefined;
  onNotify?: ((message: string) => void) | undefined;
}

const VOICE_PROFILES: { id: TtsVoiceProfile; label: string }[] = [
  { id: "auto", label: "Auto by Region" },
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
];

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const WIDTH_STEPS: Record<number, string> = {
  0: "w-0",
  10: "w-[10%]",
  20: "w-[20%]",
  30: "w-[30%]",
  40: "w-[40%]",
  50: "w-[50%]",
  60: "w-[60%]",
  70: "w-[70%]",
  80: "w-[80%]",
  90: "w-[90%]",
  100: "w-full",
};

function getProgressWidthClass(completed: number, total: number): string {
  if (total <= 0) return "w-0";
  const pct = Math.round(((completed / total) * 100) / 10) * 10;
  return WIDTH_STEPS[Math.min(100, Math.max(0, pct))] ?? "w-0";
}

function getRegionalSampleText(region: DialectRegion): string {
  if (region === "north") return "Xin chào, hôm nay thế nào nhé?";
  if (region === "central") return "Xin chào, bữa ni rứa răng rồi?";
  return "Xin chào, hôm nay sao rồi nha?";
}

interface ThemeOptionButtonProps {
  id: ThemePreference;
  label: string;
  active: boolean;
  onSelect: (theme: ThemePreference) => void;
}

const ThemeOptionButton: FC<ThemeOptionButtonProps> = ({ id, label, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={`flex min-h-[38px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink"
      }`}
    >
      {id === "light" ? (
        <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : id === "dark" ? (
        <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
};

interface RegionOptionButtonProps {
  region: DialectRegion;
  active: boolean;
  isBusy: boolean;
  onSelect: (region: DialectRegion) => void;
  onPreview: (region: DialectRegion) => void;
}

const RegionOptionButton: FC<RegionOptionButtonProps> = ({
  region,
  active,
  isBusy,
  onSelect,
  onPreview,
}) => {
  const meta = DIALECT_META[region];

  const handleSelect = useCallback(() => {
    onSelect(region);
  }, [onSelect, region]);

  const handlePreview = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onSelect(region);
      onPreview(region);
    },
    [onPreview, onSelect, region],
  );

  return (
    <div
      className={`flex min-h-[60px] flex-col justify-between rounded-xl border p-3 transition-colors ${
        active
          ? "border-accent bg-accent-muted text-ink"
          : "border-border bg-surface text-ink-secondary hover:bg-surface-subtle"
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <button type="button" onClick={handleSelect} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{meta.label}</span>
            {active ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> : null}
          </div>
          <span className="mt-0.5 block text-xs text-ink-muted">{meta.cities}</span>
        </button>

        <button
          type="button"
          onClick={handlePreview}
          aria-label={`Hear ${meta.fullRegionLabel} sample`}
          title={`Hear ${meta.label} pronunciation`}
          className={`flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-lg transition-colors ${
            isBusy
              ? "bg-accent text-accent-fg"
              : "text-ink-muted hover:bg-accent-soft hover:text-accent"
          }`}
        >
          {isBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};

interface VoiceProfileButtonProps {
  profile: { id: TtsVoiceProfile; label: string };
  active: boolean;
  onSelect: (id: TtsVoiceProfile) => void;
}

const VoiceProfileButton: FC<VoiceProfileButtonProps> = ({ profile, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(profile.id);
  }, [onSelect, profile.id]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface text-ink-muted hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {profile.label}
    </button>
  );
};

interface VoiceFallbackSectionProps {
  voiceSelectId: string;
  preferredViVoiceURI: string;
  viVoices: SpeechVoiceInfo[];
  onVoiceChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}

const VoiceFallbackSection: FC<VoiceFallbackSectionProps> = ({
  voiceSelectId,
  preferredViVoiceURI,
  viVoices,
  onVoiceChange,
}) => {
  const handleOpenAndroidTts = useCallback(() => {
    void openAndroidTtsSettings();
  }, []);

  return (
    <div>
      <label htmlFor={voiceSelectId} className="text-sm font-medium text-ink">
        Browser &amp; On-Device Vietnamese Voice
      </label>

      {viVoices.length > 0 ? (
        <div className="mt-2">
          <select
            id={voiceSelectId}
            value={preferredViVoiceURI}
            onChange={onVoiceChange}
            className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="">Automatic (match selected region &amp; speaker)</option>
            {viVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang}){v.localService ? " · Offline ready" : " · Browser voice"}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-muted">
            {viVoices.length} Vietnamese voice{viVoices.length > 1 ? "s" : ""} available in this
            browser/device.
          </p>
        </div>
      ) : (
        <div className="mt-1.5 space-y-2">
          <p className="text-xs leading-relaxed text-ink-muted">
            No OS Vietnamese voice detected. Regional Vietnamese Voice plays directly in your
            browser and caches phrases locally; to add an offline OS voice, install Vietnamese under
            iOS Spoken Content or Android Text-to-Speech.
          </p>
          {isNativeAndroid() ? (
            <button
              type="button"
              onClick={handleOpenAndroidTts}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-subtle"
            >
              Open Android Text-to-Speech Settings
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

type OfflinePackScope = "essential" | "all";

interface PackCooldownBannerProps {
  cooldownSeconds: number;
  cachedCount: number;
  totalCount: number;
  isOnline: boolean;
  onResumeNow: () => void;
  onCancelAutoResume: () => void;
}

const PackCooldownBanner: FC<PackCooldownBannerProps> = ({
  cooldownSeconds,
  cachedCount,
  totalCount,
  isOnline,
  onResumeNow,
  onCancelAutoResume,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-ink">
    <span className="tabular-nums">
      {isOnline
        ? `Paused at ${String(cachedCount)}/${String(totalCount)} clips · resuming in ${String(cooldownSeconds)}s`
        : `Paused at ${String(cachedCount)}/${String(totalCount)} clips · waiting for connection`}
    </span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onResumeNow}
        disabled={!isOnline}
        className="font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        Resume Now
      </button>
      <button
        type="button"
        onClick={onCancelAutoResume}
        className="font-medium text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  </div>
);

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb <= 0) return "0 MB";
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${String(Math.round(mb))} MB`;
}

function formatAudioBudgetSummary(budget: OfflineAudioBudgetStats | null): string | null {
  if (!budget) return null;
  const cachedMb = formatMegabytes(budget.storage.cachedBytes);
  const storageBudgetMb = formatMegabytes(budget.storage.storageBudgetBytes);
  const ramBudgetBytes =
    budget.memoryBlobs.maxBytes + budget.decodedBuffers.maxBytes + budget.stretchedBuffers.maxBytes;
  const ramUsedBytes =
    budget.memoryBlobs.bytes + budget.decodedBuffers.bytes + budget.stretchedBuffers.bytes;
  const ramSummary =
    ramUsedBytes > 0
      ? `${formatMegabytes(ramUsedBytes)}/${formatMegabytes(ramBudgetBytes)} RAM cache`
      : `${formatMegabytes(ramBudgetBytes)} RAM budget`;
  const persistLabel = budget.storage.persisted ? " · Persistent storage active" : "";
  return `Offline audio budget: ${cachedMb} / ${storageBudgetMb} storage · ${ramSummary}${persistLabel}`;
}

function formatPackSummary(
  region: DialectRegion,
  regionCacheStats: { cachedCount: number; totalCount: number } | null,
  allCacheStats: { cachedCount: number; totalCount: number } | null,
  serverCachedClips: number | null,
): string {
  if (!regionCacheStats || !allCacheStats) {
    return "Checking offline audio cache…";
  }
  const serverNote =
    serverCachedClips !== null && serverCachedClips > 0
      ? ` · ${String(serverCachedClips)} shared on server`
      : "";
  return `${String(regionCacheStats.cachedCount)}/${String(regionCacheStats.totalCount)} ${DIALECT_META[region].label} cached · ${String(allCacheStats.cachedCount)}/${String(allCacheStats.totalCount)} all dialects${serverNote}`;
}

interface PackActionSectionProps {
  region: DialectRegion;
  isDownloadingPack: boolean;
  packProgress: OfflinePackProgress | null;
  cooldownSeconds: number;
  cooldownSummary: { cached: number; total: number } | null;
  isOnline: boolean;
  cloudTtsAvailable: boolean | null;
  onCancelDownload: () => void;
  onResumeNow: () => void;
  onCancelAutoResume: () => void;
  onDownloadCurrentRegion: () => void;
  onDownloadAllRegions: () => void;
}

const PackActionSection: FC<PackActionSectionProps> = ({
  region,
  isDownloadingPack,
  packProgress,
  cooldownSeconds,
  cooldownSummary,
  isOnline,
  cloudTtsAvailable,
  onCancelDownload,
  onResumeNow,
  onCancelAutoResume,
  onDownloadCurrentRegion,
  onDownloadAllRegions,
}) => {
  if (isDownloadingPack && packProgress) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-secondary">
          <span className="tabular-nums">
            Caching offline voice clips ({String(packProgress.completed)}/
            {String(packProgress.total)})…
          </span>
          <button
            type="button"
            onClick={onCancelDownload}
            className="font-medium text-ink-secondary hover:text-ink"
          >
            Stop
          </button>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={`h-full rounded-full bg-accent transition-all duration-200 ${getProgressWidthClass(
              packProgress.completed,
              packProgress.total,
            )}`}
          />
        </div>
      </div>
    );
  }

  if (cooldownSeconds > 0 && cooldownSummary !== null) {
    return (
      <PackCooldownBanner
        cooldownSeconds={cooldownSeconds}
        cachedCount={cooldownSummary.cached}
        totalCount={cooldownSummary.total}
        isOnline={isOnline}
        onResumeNow={onResumeNow}
        onCancelAutoResume={onCancelAutoResume}
      />
    );
  }

  if (isOnline && cloudTtsAvailable === true) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onDownloadCurrentRegion}
          className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
        >
          <Download className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span>Download {DIALECT_META[region].label}</span>
        </button>
        <button
          type="button"
          onClick={onDownloadAllRegions}
          className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Download All 3 Dialects</span>
        </button>
      </div>
    );
  }

  return (
    <p className="text-xs leading-relaxed text-ink-muted">
      {!isOnline
        ? "Currently offline — cached clips, OS Vietnamese voices, and tone melodies play without internet."
        : "Phrasebook, study deck, translator, tone coach, and on-device voices all work offline."}
    </p>
  );
};

interface OfflineAudioPackCardProps {
  phrases: Phrase[];
  region: DialectRegion;
  ttsVoiceProfile: TtsVoiceProfile;
  isOnline: boolean;
  cloudTtsAvailable: boolean | null;
  serverCachedClips: number | null;
}

const OfflineAudioPackCard: FC<OfflineAudioPackCardProps> = ({
  phrases,
  region,
  ttsVoiceProfile,
  isOnline,
  cloudTtsAvailable,
  serverCachedClips,
}) => {
  const [packScope, setPackScope] = useState<OfflinePackScope>("essential");
  const [includeSlowClips, setIncludeSlowClips] = useState(false);
  const [regionCacheStats, setRegionCacheStats] = useState<{
    cachedCount: number;
    totalCount: number;
  } | null>(null);
  const [allCacheStats, setAllCacheStats] = useState<{
    cachedCount: number;
    totalCount: number;
  } | null>(null);
  const [budgetStats, setBudgetStats] = useState<OfflineAudioBudgetStats | null>(null);
  const [packProgress, setPackProgress] = useState<OfflinePackProgress | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const [isDownloadingPack, setIsDownloadingPack] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [pendingResumeRegions, setPendingResumeRegions] = useState<DialectRegion[] | null>(null);
  const [cooldownSummary, setCooldownSummary] = useState<{ cached: number; total: number } | null>(
    null,
  );
  const packAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const essentialPhrases = useMemo(() => {
    const subset = phrases.filter((p) => p.priority === 3 || Boolean(p.isStarred));
    return subset.length > 0 ? subset : phrases;
  }, [phrases]);

  const targetPhrases = packScope === "essential" ? essentialPhrases : phrases;

  const refreshCacheStats = useCallback(async () => {
    const opts = {
      slow: false,
      includeSlow: includeSlowClips,
      ttsVoiceProfile,
    };
    const [regStats, fullStats, nextBudget] = await Promise.all([
      audioService.getPhraseAudioCacheStats(targetPhrases, [region], opts),
      audioService.getPhraseAudioCacheStats(targetPhrases, [...DIALECT_REGIONS], opts),
      audioService.getOfflineAudioBudgetStats(),
    ]);
    if (!isMountedRef.current) return;
    setRegionCacheStats(regStats);
    setAllCacheStats(fullStats);
    setBudgetStats(nextBudget);
  }, [includeSlowClips, region, targetPhrases, ttsVoiceProfile]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      packAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const opts = {
      slow: false,
      includeSlow: includeSlowClips,
      ttsVoiceProfile,
    };
    void Promise.all([
      audioService.getPhraseAudioCacheStats(targetPhrases, [region], opts),
      audioService.getPhraseAudioCacheStats(targetPhrases, [...DIALECT_REGIONS], opts),
      audioService.getOfflineAudioBudgetStats(),
    ]).then(([regStats, fullStats, nextBudget]) => {
      if (!cancelled) {
        setRegionCacheStats(regStats);
        setAllCacheStats(fullStats);
        setBudgetStats(nextBudget);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [includeSlowClips, region, targetPhrases, ttsVoiceProfile]);

  const handlePackDownloadResult = useCallback(
    (result: OfflinePackProgress, targetRegions: DialectRegion[], aborted: boolean) => {
      if (aborted) return;
      if (result.quotaExceeded) {
        setPackNotice(
          "Device storage is full — free up space or switch to Essential phrases to cache audio.",
        );
        return;
      }
      if (result.cloudUnavailableMessage) {
        setPackNotice(result.cloudUnavailableMessage);
        return;
      }
      if (result.rateLimited) {
        setCooldownSeconds(result.retryAfterSeconds ?? 60);
        setPendingResumeRegions(targetRegions);
        setCooldownSummary({ cached: result.cachedCount, total: result.total });
        return;
      }
      const failed = result.failedCount ?? 0;
      if (failed > 0) {
        setPackNotice(
          `${String(failed)} clip${failed === 1 ? "" : "s"} could not be cached. Check your connection and tap Download to retry.`,
        );
      }
    },
    [],
  );

  const startPackDownload = useCallback(
    async (targetRegions: DialectRegion[]) => {
      if (isDownloadingPack || !isOnline) return;
      const controller = new AbortController();
      packAbortRef.current = controller;
      setIsDownloadingPack(true);
      setPackNotice(null);
      setCooldownSeconds(0);
      setPendingResumeRegions(null);
      setCooldownSummary(null);
      const speedMultiplier = includeSlowClips ? 2 : 1;
      setPackProgress({
        completed: 0,
        total: targetPhrases.length * targetRegions.length * speedMultiplier,
        cachedCount: 0,
      });
      try {
        const result = await audioService.downloadOfflineAudioPack(
          targetPhrases,
          targetRegions,
          { slow: false, includeSlow: includeSlowClips, ttsVoiceProfile },
          (progress) => {
            if (isMountedRef.current) {
              setPackProgress(progress);
            }
          },
          controller.signal,
        );
        if (isMountedRef.current) {
          handlePackDownloadResult(result, targetRegions, controller.signal.aborted);
        }
      } finally {
        if (packAbortRef.current === controller) {
          packAbortRef.current = null;
        }
        if (isMountedRef.current) {
          setIsDownloadingPack(false);
          await refreshCacheStats();
        }
      }
    },
    [
      handlePackDownloadResult,
      includeSlowClips,
      isDownloadingPack,
      isOnline,
      refreshCacheStats,
      targetPhrases,
      ttsVoiceProfile,
    ],
  );

  useEffect(() => {
    if (!isOnline || cooldownSeconds <= 0 || !pendingResumeRegions) return;
    const timer = window.setTimeout(() => {
      if (cooldownSeconds <= 1) {
        const nextRegions = pendingResumeRegions;
        setCooldownSeconds(0);
        setPendingResumeRegions(null);
        setCooldownSummary(null);
        audioService.resetCloudCooldown();
        void startPackDownload(nextRegions);
      } else {
        setCooldownSeconds((prev) => prev - 1);
      }
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [cooldownSeconds, isOnline, pendingResumeRegions, startPackDownload]);

  const selectEssentialScope = useCallback(() => {
    setPackScope("essential");
    setPackNotice(null);
  }, []);

  const selectAllScope = useCallback(() => {
    setPackScope("all");
    setPackNotice(null);
  }, []);

  const handleToggleIncludeSlow = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setIncludeSlowClips(e.target.checked);
    setPackNotice(null);
  }, []);

  const handleDownloadCurrentRegion = useCallback(() => {
    void startPackDownload([region]);
  }, [region, startPackDownload]);

  const handleDownloadAllRegions = useCallback(() => {
    void startPackDownload([...DIALECT_REGIONS]);
  }, [startPackDownload]);

  const handleCancelDownload = useCallback(() => {
    packAbortRef.current?.abort();
  }, []);

  const handleResumeNow = useCallback(() => {
    if (!pendingResumeRegions) return;
    const nextRegions = pendingResumeRegions;
    setCooldownSeconds(0);
    setPendingResumeRegions(null);
    setCooldownSummary(null);
    audioService.resetCloudCooldown();
    void startPackDownload(nextRegions);
  }, [pendingResumeRegions, startPackDownload]);

  const handleCancelAutoResume = useCallback(() => {
    setCooldownSeconds(0);
    setPendingResumeRegions(null);
    setCooldownSummary(null);
    setPackNotice("Offline pack download paused. Tap Download anytime to resume.");
  }, []);

  const isRegionReady =
    regionCacheStats !== null &&
    regionCacheStats.totalCount > 0 &&
    regionCacheStats.cachedCount === regionCacheStats.totalCount;

  const summaryText = formatPackSummary(region, regionCacheStats, allCacheStats, serverCachedClips);
  const budgetSummaryText = formatAudioBudgetSummary(budgetStats);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-subtle p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">Offline Audio Pack</p>
          <p className="mt-0.5 text-xs text-ink-muted tabular-nums">{summaryText}</p>
          {budgetSummaryText ? (
            <p className="mt-0.5 text-[11px] text-ink-faint tabular-nums">{budgetSummaryText}</p>
          ) : null}
        </div>
        {isRegionReady ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Ready</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-surface-muted p-0.5">
          <button
            type="button"
            onClick={selectEssentialScope}
            disabled={isDownloadingPack}
            className={`min-h-[32px] whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
              packScope === "essential"
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            Essential ({essentialPhrases.length})
          </button>
          <button
            type="button"
            onClick={selectAllScope}
            disabled={isDownloadingPack}
            className={`min-h-[32px] whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
              packScope === "all"
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            All ({phrases.length})
          </button>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={includeSlowClips}
            disabled={isDownloadingPack}
            onChange={handleToggleIncludeSlow}
            className="h-3.5 w-3.5 accent-accent"
          />
          <span>Include slow study clips</span>
        </label>
      </div>

      <PackActionSection
        region={region}
        isDownloadingPack={isDownloadingPack}
        packProgress={packProgress}
        cooldownSeconds={cooldownSeconds}
        cooldownSummary={pendingResumeRegions !== null ? cooldownSummary : null}
        isOnline={isOnline}
        cloudTtsAvailable={cloudTtsAvailable}
        onCancelDownload={handleCancelDownload}
        onResumeNow={handleResumeNow}
        onCancelAutoResume={handleCancelAutoResume}
        onDownloadCurrentRegion={handleDownloadCurrentRegion}
        onDownloadAllRegions={handleDownloadAllRegions}
      />

      {packNotice ? <p className="text-xs text-warning">{packNotice}</p> : null}
    </div>
  );
};

interface BackupDataSectionProps {
  onImportBackup?: ((rawJson: string) => ImportAppStateResult) | undefined;
  onNotify?: ((message: string) => void) | undefined;
}

const BackupDataSection: FC<BackupDataSectionProps> = ({ onImportBackup, onNotify }) => {
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = useCallback(() => {
    if (downloadAppBackupJson()) {
      setStatus({ kind: "ok", message: "Backup file exported." });
      onNotify?.("Backup file downloaded.");
    } else {
      setStatus({ kind: "error", message: "Unable to export backup in this environment." });
    }
  }, [onNotify]);

  const handleTriggerRestore = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const restoreFile = useCallback(
    async (file: File) => {
      try {
        const rawJson = await file.text();
        const result = onImportBackup ? onImportBackup(rawJson) : importSavedAppStateJson(rawJson);
        if (!result.ok) {
          setStatus({ kind: "error", message: result.error });
          return;
        }
        setStatus({
          kind: "ok",
          message: `Restored ${String(result.phrases.length)} phrases and ${String(result.starredWords.length)} starred words.`,
        });
        onNotify?.("Study backup restored.");
      } catch {
        setStatus({ kind: "error", message: "Could not read selected backup file." });
      }
    },
    [onImportBackup, onNotify],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      void restoreFile(file);
    },
    [restoreFile],
  );

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-subtle p-3.5">
      <div>
        <p className="text-sm font-medium text-ink">Backup &amp; Restore Progress</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          Save custom phrases, saved items, and dialect settings to a JSON file.
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Choose Nói backup JSON file"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleExport}
          className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
        >
          <Download className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span>Export Backup</span>
        </button>
        <button
          type="button"
          onClick={handleTriggerRestore}
          className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
        >
          <Upload className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span>Restore Backup</span>
        </button>
      </div>
      {status ? (
        <p className={`text-xs ${status.kind === "error" ? "text-danger" : "text-accent"}`}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
};

interface ResetPhrasesSectionProps {
  onResetPhrases: () => void;
}

const ResetPhrasesSection: FC<ResetPhrasesSectionProps> = ({ onResetPhrases }) => {
  const [confirmReset, setConfirmReset] = useState(false);

  const startResetConfirm = useCallback(() => {
    setConfirmReset(true);
  }, []);

  const cancelResetConfirm = useCallback(() => {
    setConfirmReset(false);
  }, []);

  const performReset = useCallback(() => {
    onResetPhrases();
    setConfirmReset(false);
  }, [onResetPhrases]);

  return !confirmReset ? (
    <button
      type="button"
      onClick={startResetConfirm}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
    >
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      <span>Reset phrase deck &amp; custom phrases</span>
    </button>
  ) : (
    <div className="rounded-xl border border-danger-border bg-danger-soft p-3">
      <p className="text-xs font-medium text-danger-ink">
        Restore the default phrase deck and remove custom phrases?
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={performReset}
          className="min-h-[40px] flex-1 rounded-lg bg-danger px-3 text-xs font-medium text-accent-fg hover:bg-danger-hover"
        >
          Confirm Reset
        </button>
        <button
          type="button"
          onClick={cancelResetConfirm}
          className="min-h-[40px] flex-1 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:bg-surface-subtle"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

type SettingsModalContentProps = Omit<SettingsModalProps, "open">;

const SettingsModalContent: FC<SettingsModalContentProps> = ({
  phrases,
  settings,
  initialSection = "general",
  onClose,
  onUpdateSettings,
  onResetPhrases,
  onImportBackup,
  onNotify,
}) => {
  const isOnline = useOnlineStatus();
  const [viVoices, setViVoices] = useState<SpeechVoiceInfo[]>(() =>
    audioService.getVietnameseVoices(),
  );
  const [cloudTtsAvailable, setCloudTtsAvailable] = useState<boolean | null>(null);
  const [serverCachedClips, setServerCachedClips] = useState<number | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const speakingState = useSpeakingStatus();

  const audioPackRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const privacyTitleId = useId();
  const voiceSelectId = useId();

  useEffect(() => {
    if (initialSection === "audio-pack") {
      audioPackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [initialSection]);

  useEffect(() => {
    const unsubBack = registerBackHandler(() => {
      if (showPrivacyModal) {
        setShowPrivacyModal(false);
        return true;
      }
      onClose();
      return true;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (showPrivacyModal) {
        setShowPrivacyModal(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubBack();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, showPrivacyModal]);

  useEffect(() => {
    return audioService.subscribeVoices((inventory) => {
      setViVoices(inventory.vi);
    });
  }, []);

  useEffect(() => {
    if (!isOnline) {
      return;
    }
    let cancelled = false;
    void audioService.checkCloudTtsStatus().then((status) => {
      if (!cancelled) {
        setCloudTtsAvailable(status.available);
        setServerCachedClips(status.cachedClips);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOnline]);

  const handleSelectRegion = useCallback(
    (region: DialectRegion) => {
      onUpdateSettings({ region });
    },
    [onUpdateSettings],
  );

  const handleSelectTheme = useCallback(
    (theme: ThemePreference) => {
      onUpdateSettings({ theme });
    },
    [onUpdateSettings],
  );

  const handlePreviewRegion = useCallback(
    (region: DialectRegion) => {
      void audioService.speakWithSettings(getRegionalSampleText(region), region, settings);
    },
    [settings],
  );

  const selectCloudSource = useCallback(() => {
    onUpdateSettings({ ttsSource: "cloud-first" });
  }, [onUpdateSettings]);

  const selectDeviceSource = useCallback(() => {
    onUpdateSettings({ ttsSource: "device-only" });
  }, [onUpdateSettings]);

  const handleSelectVoiceProfile = useCallback(
    (ttsVoiceProfile: TtsVoiceProfile) => {
      onUpdateSettings({ ttsVoiceProfile });
    },
    [onUpdateSettings],
  );

  const handleAutoPlayChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onUpdateSettings({ autoPlayBoth: e.target.checked });
    },
    [onUpdateSettings],
  );

  const handleVoiceChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onUpdateSettings({ preferredViVoiceURI: e.target.value });
    },
    [onUpdateSettings],
  );

  const handleTestVoice = useCallback(() => {
    void audioService.speakWithSettings(
      getRegionalSampleText(settings.region),
      settings.region,
      settings,
    );
  }, [settings]);

  const openPrivacyModal = useCallback(() => {
    setShowPrivacyModal(true);
  }, []);

  const closePrivacyModal = useCallback(() => {
    setShowPrivacyModal(false);
  }, []);

  const effectiveCloudTtsAvailable = isOnline ? cloudTtsAvailable : false;

  const voiceStatusCopy =
    effectiveCloudTtsAvailable === true
      ? "Browser regional Vietnamese voice ready (caches clips for offline playback)."
      : effectiveCloudTtsAvailable === false
        ? "Using browser / on-device Vietnamese voice."
        : "Checking regional Vietnamese voice availability…";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close settings backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-backdrop backdrop-blur-xs"
      />

      <div className="pb-safe-modal relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-xl sm:rounded-2xl sm:pb-6">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />

        <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-4">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            Dialect &amp; Vietnamese Audio
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          <div>
            <p className="text-sm font-medium text-ink">Appearance</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Choose light, dark, or match your device&apos;s system color scheme.
            </p>
            <div className="mt-2.5 flex items-center gap-1 rounded-xl bg-surface-subtle p-1">
              {THEME_OPTIONS.map((option) => (
                <ThemeOptionButton
                  key={option.id}
                  id={option.id}
                  label={option.label}
                  active={settings.theme === option.id}
                  onSelect={handleSelectTheme}
                />
              ))}
            </div>
          </div>

          <hr className="border-border-subtle" />

          <div>
            <p className="text-sm font-medium text-ink">Vietnamese Dialect Region</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Tap a speaker icon to compare Northern, Central, and Southern pronunciation.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {DIALECT_REGIONS.map((region) => (
                <RegionOptionButton
                  key={region}
                  region={region}
                  active={settings.region === region}
                  isBusy={
                    speakingState.activeRegion === region &&
                    (speakingState.isSpeaking || speakingState.isLoading)
                  }
                  onSelect={handleSelectRegion}
                  onPreview={handlePreviewRegion}
                />
              ))}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-ink-secondary">
              {DIALECT_META[settings.region].accentHint}
            </p>
          </div>

          <hr className="border-border-subtle" />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">Vietnamese Speech Voice</p>
                <p className="text-xs text-ink-muted">{voiceStatusCopy}</p>
              </div>
              <button
                type="button"
                onClick={handleTestVoice}
                className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-accent hover:bg-accent-soft"
              >
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Test {DIALECT_META[settings.region].label}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={selectCloudSource}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  settings.ttsSource === "cloud-first"
                    ? "border-accent bg-accent-muted"
                    : "border-border bg-surface hover:bg-surface-subtle"
                }`}
              >
                <p className="text-xs font-semibold text-ink">Regional Vietnamese Voice</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Browser-ready Hanoi, Da Nang, and HCMC accents with automatic offline caching.
                </p>
              </button>

              <button
                type="button"
                onClick={selectDeviceSource}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  settings.ttsSource === "device-only"
                    ? "border-accent bg-accent-muted"
                    : "border-border bg-surface hover:bg-surface-subtle"
                }`}
              >
                <p className="text-xs font-semibold text-ink">On-Device Vietnamese Only</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Uses only installed browser/OS Vietnamese voices (no TTS server requests).
                </p>
              </button>
            </div>

            <div>
              <p className="text-xs font-medium text-ink-secondary">Speaker Style</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VOICE_PROFILES.map((profile) => (
                  <VoiceProfileButton
                    key={profile.id}
                    profile={profile}
                    active={settings.ttsVoiceProfile === profile.id}
                    onSelect={handleSelectVoiceProfile}
                  />
                ))}
              </div>
            </div>

            {speakingState.audioError ? (
              <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span>{speakingState.audioError}</span>
              </div>
            ) : null}
          </div>

          <hr className="border-border-subtle" />

          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">Auto-read English → Vietnamese</p>
              <p className="text-xs text-ink-muted">
                Speaks English then Vietnamese automatically when moving to the next card.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPlayBoth}
              onChange={handleAutoPlayChange}
              className="h-5 w-5 accent-accent"
            />
          </label>

          <hr className="border-border-subtle" />

          <VoiceFallbackSection
            voiceSelectId={voiceSelectId}
            preferredViVoiceURI={settings.preferredViVoiceURI}
            viVoices={viVoices}
            onVoiceChange={handleVoiceChange}
          />

          <hr className="border-border-subtle" />

          <div ref={audioPackRef}>
            <OfflineAudioPackCard
              phrases={phrases}
              region={settings.region}
              ttsVoiceProfile={settings.ttsVoiceProfile}
              isOnline={isOnline}
              cloudTtsAvailable={effectiveCloudTtsAvailable}
              serverCachedClips={serverCachedClips}
            />
          </div>

          <hr className="border-border-subtle" />

          <div className="space-y-3">
            <PWAInstallButton variant="full" />
            <BackupDataSection onImportBackup={onImportBackup} onNotify={onNotify} />
            <ResetPhrasesSection onResetPhrases={onResetPhrases} />
            <div className="space-y-1 pt-1 text-center">
              <button
                type="button"
                onClick={openPrivacyModal}
                className="text-xs text-ink-muted underline decoration-border-strong underline-offset-4 hover:text-accent"
              >
                Privacy Policy &amp; Offline Data
              </button>
              <p className="text-[11px] text-ink-faint">Nói v1.0.0 · Spoken Vietnamese</p>
            </div>
          </div>
        </div>
      </div>

      {showPrivacyModal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-backdrop p-0 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={privacyTitleId}
        >
          <div className="pb-safe-modal max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-xl sm:rounded-2xl sm:pb-6">
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-3">
              <h3 id={privacyTitleId} className="font-display text-base font-semibold text-ink">
                Privacy Policy &amp; Offline Data
              </h3>
              <button
                type="button"
                onClick={closePrivacyModal}
                aria-label="Close privacy policy"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-ink-muted hover:bg-surface-subtle"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-secondary">
              <p>
                Nói stores your saved phrases, starred words, custom phrases, dialect settings, and
                downloaded offline audio clips locally on your device. No account is required, and
                Nói contains no ads or third-party tracking.
              </p>
              <p>
                <strong className="text-ink">Microphone permission:</strong> Only used when you tap
                Tap to Speak in Pronunciation Practice. Offline Tone Coach analyzes audio locally on
                your device and never uploads recordings. Optional Online Speech Recognition uses
                your device&apos;s built-in speech service.
              </p>
              <p>
                <strong className="text-ink">Regional Voice TTS:</strong> When Regional Vietnamese
                Voice is enabled and a clip is not yet cached, only the phrase text, dialect region,
                and speaker style are sent to synthesize audio. Switch to On-Device Vietnamese Only
                in Settings to disable all TTS network requests.
              </p>
              <p>
                <strong className="text-ink">Data deletion &amp; contact:</strong> Reset your deck
                anytime in Settings or clear app storage in Android Settings. Privacy questions:
                wiltermoodj@gmail.com.
              </p>
            </div>
            <button
              type="button"
              onClick={closePrivacyModal}
              className="mt-5 min-h-[44px] w-full rounded-xl bg-surface-inverse text-xs font-medium text-ink-inverse hover:opacity-90"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const SettingsModal: FC<SettingsModalProps> = ({ open, ...rest }) => {
  if (!open) return null;
  return <SettingsModalContent {...rest} />;
};
