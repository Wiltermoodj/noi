import { AlertCircle, Check, Mic, Play, Square, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { audioService, getSlowPlaybackSpeed } from "../services/audioService";
import { isNativeAndroid } from "../services/nativePlatform";
import {
  abandonAndroidAudioFocus,
  openAndroidAppSettings,
  requestAndroidAudioFocus,
} from "../services/noiAndroidBridge";
import {
  isOfflineAcousticPracticeSupported,
  startOfflineAcousticSession,
} from "../services/offlineAcousticPractice";
import {
  evaluatePronunciation,
  type PronunciationEvaluation,
  type WordMatchStatus,
  type WordPronunciationFeedback,
} from "../services/pronunciationService";
import {
  getPhrasePronunciationTips,
  type PhrasePronunciationTip,
} from "../services/pronunciationTipsService";
import {
  checkSpeechRecognitionAvailability,
  isSpeechRecognitionSupported,
  startVietnameseRecognition,
} from "../services/speechRecognitionService";
import {
  getPhraseToneSyllables,
  isToneAudioSupported,
  playVietnameseToneContour,
  stopToneContour,
  type ToneSyllableInfo,
} from "../services/toneAudioService";
import { DIALECT_META, type DialectRegion } from "../types/vietnamese";

interface PracticePanelProps {
  phraseText: string;
  region: DialectRegion;
  playbackSpeed: number;
  bestAccuracy?: number | undefined;
  onChangeRegion: (region: DialectRegion) => void;
  onPlayNormal: () => void;
  onPlaySlow: () => void;
  onPracticeEvaluated?: ((accuracy: number) => void) | undefined;
}

type PracticeEngine = "offline-tone" | "web-speech";

const REGION_CITY_BUTTONS: { region: DialectRegion; label: string }[] = [
  { region: "north", label: "North · Hanoi" },
  { region: "central", label: "Central · Da Nang" },
  { region: "south", label: "South · Saigon" },
];

const SHORT_TONE_HINTS: Record<string, string> = {
  ngang: "flat",
  huyen: "fall",
  sac: "rise",
  hoi: "dip",
  nga: "creak",
  nang: "drop",
};

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

function getAccuracyBarClass(accuracy: number): string {
  if (accuracy >= 80) return "bg-accent";
  if (accuracy >= 55) return "bg-warning";
  return "bg-danger";
}

function getBucketWidthClass(percent: number): string {
  const bucket = Math.min(100, Math.max(0, Math.round(percent / 10) * 10));
  return WIDTH_STEPS[bucket] ?? "w-0";
}

function getAccuracyTextClass(accuracy: number): string {
  if (accuracy >= 80) return "text-accent";
  if (accuracy >= 55) return "text-warning-ink";
  return "text-danger-ink";
}

function getWordChipClass(status: WordPronunciationFeedback["status"]): string {
  switch (status) {
    case "exact":
      return "border-success-border bg-success-soft text-success-ink";
    case "dialect":
      return "border-accent-border bg-accent-soft text-accent";
    case "tone":
      return "border-warning-border bg-warning-soft text-warning-ink";
    case "close":
      return "border-border-strong bg-surface-muted text-ink";
    case "missed":
      return "border-danger-border bg-danger-soft text-danger-ink";
  }
}

function buildContourPolyline(points: number[]): string {
  if (points.length === 0) return "0,12 28,12";
  const maxIdx = Math.max(1, points.length - 1);
  return points
    .map((p, idx) => {
      const x = Math.round((idx / maxIdx) * 28);
      const y = Math.round(20 - p * 16);
      return `${String(x)},${String(y)}`;
    })
    .join(" ");
}

interface RegionSelectorButtonProps {
  region: DialectRegion;
  label: string;
  active: boolean;
  onSelect: (region: DialectRegion) => void;
}

const RegionSelectorButton: FC<RegionSelectorButtonProps> = ({
  region,
  label,
  active,
  onSelect,
}) => {
  const handleClick = useCallback(() => {
    onSelect(region);
  }, [onSelect, region]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active
          ? "bg-surface text-ink shadow-xs"
          : "text-ink-secondary hover:bg-surface/60 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
};

function getMeasuredContourStroke(status?: WordMatchStatus): string {
  if (status === "exact" || status === "dialect") return "var(--theme-accent)";
  if (status === "tone" || status === "close") return "var(--theme-warning)";
  return "var(--theme-danger)";
}

interface ToneSyllableChipProps {
  info: ToneSyllableInfo;
  isHighlighted: boolean;
  measuredContour?: number[] | undefined;
  measuredStatus?: WordMatchStatus | undefined;
  onPlaySyllable: (syllable: string) => void;
}

const ToneSyllableChip: FC<ToneSyllableChipProps> = ({
  info,
  isHighlighted,
  measuredContour,
  measuredStatus,
  onPlaySyllable,
}) => {
  const handleClick = useCallback(() => {
    onPlaySyllable(info.syllable);
  }, [info.syllable, onPlaySyllable]);

  const hasMeasured = Boolean(measuredContour && measuredContour.length > 0);
  const shortToneHint = SHORT_TONE_HINTS[info.tone] ?? "";

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${info.syllable}: ${info.toneLabel} (tap to hear tone)`}
      className={`inline-flex min-w-[54px] flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
        isHighlighted
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface-subtle text-ink-secondary hover:border-accent-border hover:bg-surface"
      }`}
    >
      <span className="font-semibold">{info.syllable}</span>
      <svg
        width="40"
        height="24"
        viewBox="0 0 28 22"
        className="overflow-visible"
        aria-hidden="true"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={hasMeasured ? "1.6" : "2"}
          strokeOpacity={hasMeasured ? 0.38 : 1}
          strokeDasharray={hasMeasured ? "2.5 2" : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={buildContourPolyline(info.contour)}
        />
        {measuredContour && measuredContour.length > 0 ? (
          <polyline
            fill="none"
            stroke={getMeasuredContourStroke(measuredStatus)}
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={buildContourPolyline(measuredContour)}
          />
        ) : null}
      </svg>
      <span className="text-[10px] text-ink-faint">{shortToneHint}</span>
    </button>
  );
};

const WordFeedbackChip: FC<{ word: WordPronunciationFeedback }> = ({ word }) => {
  const showCheck = word.status === "exact" || word.status === "dialect";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium ${getWordChipClass(word.status)}`}
    >
      {showCheck ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      <span>{word.expected}</span>
      {word.status === "dialect" && word.dialectNote ? (
        <span className="text-[10px] font-normal">({word.dialectNote})</span>
      ) : null}
      {word.status === "tone" ? (
        <span className="text-[10px] font-normal text-warning-ink">
          {word.spoken ? `(${word.spoken})` : "(tone)"}
        </span>
      ) : null}
      {word.status === "close" && word.spoken ? (
        <span className="text-[10px] font-normal text-ink-muted">({word.spoken})</span>
      ) : null}
    </span>
  );
};

interface EvaluationFeedbackCardProps {
  evaluation: PronunciationEvaluation;
  recordingUrl: string | null;
  isPlayingMine: boolean;
  slowerSpeed: number;
  onPlayMine: () => void;
  onPlaySlow: () => void;
}

const EvaluationFeedbackCard: FC<EvaluationFeedbackCardProps> = ({
  evaluation,
  recordingUrl,
  isPlayingMine,
  slowerSpeed,
  onPlayMine,
  onPlaySlow,
}) => {
  const hasNonExactWords = evaluation.words.some((w) => w.status !== "exact");

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-secondary">{evaluation.feedbackMessage}</span>
        <span
          className={`shrink-0 text-sm font-bold tabular-nums ${getAccuracyTextClass(evaluation.accuracy)}`}
        >
          {evaluation.accuracy}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Pronunciation accuracy"
        aria-valuenow={evaluation.accuracy}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${getAccuracyBarClass(evaluation.accuracy)} ${getBucketWidthClass(evaluation.accuracy)}`}
        />
      </div>

      {evaluation.words.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {evaluation.words.map((word) => (
            <WordFeedbackChip key={word.id} word={word} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2.5 text-xs text-ink-muted">
        <span>{evaluation.bestTranscript ? evaluation.bestTranscript : "No words recognized"}</span>

        <div className="flex items-center gap-1.5">
          {recordingUrl ? (
            <button
              type="button"
              onClick={onPlayMine}
              className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg border px-2.5 font-medium transition-colors ${
                isPlayingMine
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border bg-surface-subtle text-ink-secondary hover:bg-surface-muted"
              }`}
            >
              <Play className="h-3 w-3 fill-current" aria-hidden="true" />
              <span>{isPlayingMine ? "Playing…" : "Play My Voice"}</span>
            </button>
          ) : null}

          {evaluation.accuracy < 80 ? (
            <button
              type="button"
              onClick={onPlaySlow}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 font-medium text-accent hover:bg-accent-soft"
            >
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Hear {slowerSpeed}%</span>
            </button>
          ) : null}
        </div>
      </div>

      {hasNonExactWords ? (
        <p className="text-[11px] text-ink-faint">
          Green/Teal: exact or regional match · Amber: tone check · Gray: close · Red: missed
        </p>
      ) : null}
    </div>
  );
};

interface PracticeHeaderProps {
  region: DialectRegion;
  activeEngine: PracticeEngine;
  micAvailable: boolean;
  isListening: boolean;
  hasEvaluation: boolean;
  bestAccuracy?: number | undefined;
  onToggleMic: () => void;
}

const PracticeHeader: FC<PracticeHeaderProps> = ({
  region,
  activeEngine,
  micAvailable,
  isListening,
  hasEvaluation,
  bestAccuracy,
  onToggleMic,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p className="text-xs font-semibold text-ink">
        Pronunciation Practice · {DIALECT_META[region].fullRegionLabel}
        {bestAccuracy !== undefined ? (
          <span className="ml-1.5 font-medium text-accent tabular-nums">
            · Best {bestAccuracy}%
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {activeEngine === "offline-tone"
          ? "Offline Tone Coach · Records locally & analyzes Vietnamese pitch contours."
          : "Speech Recognition · Evaluates words, tones, and regional sound shifts."}
      </p>
    </div>

    {micAvailable ? (
      <button
        type="button"
        onClick={onToggleMic}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-colors ${
          isListening
            ? "bg-danger text-accent-fg hover:bg-danger-hover"
            : "bg-accent text-accent-fg hover:bg-accent-hover"
        }`}
      >
        {isListening ? (
          <>
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            <span>{activeEngine === "offline-tone" ? "Finish & Score" : "Listening… Stop"}</span>
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" aria-hidden="true" />
            <span>{hasEvaluation ? "Try Again" : "Tap to Speak"}</span>
          </>
        )}
      </button>
    ) : null}
  </div>
);

interface PracticeEngineSwitcherProps {
  activeEngine: PracticeEngine;
  autoStopOnSilence: boolean;
  onSelectOffline: () => void;
  onSelectWebSpeech: () => void;
  onToggleAutoStop: () => void;
}

const PracticeEngineSwitcher: FC<PracticeEngineSwitcherProps> = ({
  activeEngine,
  autoStopOnSilence,
  onSelectOffline,
  onSelectWebSpeech,
  onToggleAutoStop,
}) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    <div className="flex flex-1 items-center gap-1 rounded-lg bg-surface-muted p-1">
      <button
        type="button"
        onClick={onSelectOffline}
        className={`min-h-[32px] flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
          activeEngine === "offline-tone"
            ? "bg-surface text-accent shadow-xs"
            : "text-ink-secondary hover:text-ink"
        }`}
      >
        Offline Tone Coach
      </button>
      <button
        type="button"
        onClick={onSelectWebSpeech}
        className={`min-h-[32px] flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
          activeEngine === "web-speech"
            ? "bg-surface text-accent shadow-xs"
            : "text-ink-secondary hover:text-ink"
        }`}
      >
        Online Speech
      </button>
    </div>

    {activeEngine === "offline-tone" ? (
      <button
        type="button"
        onClick={onToggleAutoStop}
        aria-pressed={autoStopOnSilence}
        className={`min-h-[36px] whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          autoStopOnSilence
            ? "border-accent-border bg-accent-soft text-accent"
            : "border-border bg-surface text-ink-secondary hover:text-ink"
        }`}
      >
        {autoStopOnSilence ? "Auto-stop: On" : "Auto-stop: Off"}
      </button>
    ) : null}
  </div>
);

interface PronunciationFocusCardProps {
  region: DialectRegion;
  regionTitle: string;
  tips: PhrasePronunciationTip[];
  toneSyllables: ToneSyllableInfo[];
  evaluatedWords?: WordPronunciationFeedback[] | undefined;
  activeToneIdx: number | null;
  toneAudioSupported: boolean;
  slowerSpeed: number;
  onPlayNormal: () => void;
  onPlaySlow: () => void;
  onPlayToneGuide: () => void;
  onPlaySingleSyllable: (syllable: string) => void;
}

const PronunciationFocusCard: FC<PronunciationFocusCardProps> = ({
  region,
  regionTitle,
  tips,
  toneSyllables,
  evaluatedWords,
  activeToneIdx,
  toneAudioSupported,
  slowerSpeed,
  onPlayNormal,
  onPlaySlow,
  onPlayToneGuide,
  onPlaySingleSyllable,
}) => {
  const hasAnyMeasuredContour = Boolean(
    evaluatedWords?.some((word) => word.measuredContour && word.measuredContour.length > 0),
  );

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-accent">{regionTitle} Pronunciation Tips</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onPlayNormal}
            className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-border bg-surface-subtle px-2 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Volume2 className="h-3 w-3 text-accent" aria-hidden="true" />
            <span>Hear {DIALECT_META[region].label}</span>
          </button>
          <button
            type="button"
            onClick={onPlaySlow}
            className="inline-flex min-h-[30px] items-center rounded-lg border border-border bg-surface-subtle px-2 text-[11px] font-medium tabular-nums text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {slowerSpeed}%
          </button>
          {toneAudioSupported ? (
            <button
              type="button"
              onClick={onPlayToneGuide}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-border bg-surface-subtle px-2 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <Play className="h-3 w-3 text-accent" aria-hidden="true" />
              <span>Tone Melody</span>
            </button>
          ) : null}
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-secondary">
        {tips.map((tip) => (
          <li key={tip.id} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-ink">{tip.title}</span>
              {tip.words.length > 0 ? (
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-accent">
                  {tip.words.join(" · ")}
                </span>
              ) : null}
            </div>
            <span>{tip.detail}</span>
          </li>
        ))}
      </ul>

      {toneSyllables.length > 0 ? (
        <div className="mt-2.5 border-t border-border-subtle pt-2.5">
          <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
            {hasAnyMeasuredContour
              ? "Dashed: target tone · Solid: your voice pitch (tap any syllable to hear target):"
              : `Tap any syllable to hear its ${DIALECT_META[region].label} pitch contour (dashed = target):`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {toneSyllables.map((info, idx) => {
              const feedback = evaluatedWords?.[idx];
              return (
                <ToneSyllableChip
                  key={info.id}
                  info={info}
                  isHighlighted={activeToneIdx === idx}
                  measuredContour={feedback?.measuredContour}
                  measuredStatus={feedback?.status}
                  onPlaySyllable={onPlaySingleSyllable}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface LiveListeningBannerProps {
  activeEngine: PracticeEngine;
  autoStopOnSilence: boolean;
  interimText: string;
  livePitchHz: number | null;
  liveLevel: number;
}

const LiveListeningBanner: FC<LiveListeningBannerProps> = ({
  activeEngine,
  autoStopOnSilence,
  interimText,
  livePitchHz,
  liveLevel,
}) => {
  const statusText =
    activeEngine === "offline-tone"
      ? autoStopOnSilence
        ? "Recording locally… auto-stops after you finish speaking."
        : "Recording locally… speak then tap Finish & Score."
      : interimText
        ? `Hearing: “${interimText}”`
        : "Listening for Vietnamese…";

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-accent-border bg-surface px-3 py-2.5 text-xs text-ink-secondary">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          <span>{statusText}</span>
        </div>
        {livePitchHz !== null ? (
          <span className="shrink-0 font-mono text-[11px] text-accent tabular-nums">
            {Math.round(livePitchHz)} Hz
          </span>
        ) : null}
      </div>
      {activeEngine === "offline-tone" ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={`h-full rounded-full bg-accent transition-all duration-75 ${getBucketWidthClass(liveLevel * 100)}`}
          />
        </div>
      ) : null}
    </div>
  );
};

interface PracticeControlsRowProps {
  showEngineSwitcher: boolean;
  activeEngine: PracticeEngine;
  micAvailable: boolean;
  autoStopOnSilence: boolean;
  onSelectOffline: () => void;
  onSelectWebSpeech: () => void;
  onToggleAutoStop: () => void;
}

const PracticeControlsRow: FC<PracticeControlsRowProps> = ({
  showEngineSwitcher,
  activeEngine,
  micAvailable,
  autoStopOnSilence,
  onSelectOffline,
  onSelectWebSpeech,
  onToggleAutoStop,
}) => {
  if (showEngineSwitcher) {
    return (
      <PracticeEngineSwitcher
        activeEngine={activeEngine}
        autoStopOnSilence={autoStopOnSilence}
        onSelectOffline={onSelectOffline}
        onSelectWebSpeech={onSelectWebSpeech}
        onToggleAutoStop={onToggleAutoStop}
      />
    );
  }
  if (activeEngine === "offline-tone" && micAvailable) {
    return (
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          onClick={onToggleAutoStop}
          aria-pressed={autoStopOnSilence}
          className={`min-h-[32px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
            autoStopOnSilence
              ? "border-accent-border bg-accent-soft text-accent"
              : "border-border bg-surface text-ink-secondary hover:text-ink"
          }`}
        >
          {autoStopOnSilence ? "Auto-stop on silence: On" : "Auto-stop on silence: Off"}
        </button>
      </div>
    );
  }
  return null;
};

interface PracticeErrorBannerProps {
  errorMessage: string;
  micPermissionBlocked: boolean;
  onOpenAppSettings: () => void;
}

const PracticeErrorBanner: FC<PracticeErrorBannerProps> = ({
  errorMessage,
  micPermissionBlocked,
  onOpenAppSettings,
}) => (
  <div className="mt-3 space-y-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-ink">
    <div className="flex items-start gap-2">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span>{errorMessage}</span>
    </div>
    {micPermissionBlocked && isNativeAndroid() ? (
      <button
        type="button"
        onClick={onOpenAppSettings}
        className="inline-flex min-h-[32px] items-center rounded-lg border border-warning-border bg-surface px-2.5 text-[11px] font-semibold text-warning-ink hover:bg-warning-soft"
      >
        Open Android App Settings
      </button>
    ) : null}
  </div>
);

export const PracticePanel: FC<PracticePanelProps> = ({
  phraseText,
  region,
  playbackSpeed,
  bestAccuracy,
  onChangeRegion,
  onPlayNormal,
  onPlaySlow,
  onPracticeEvaluated,
}) => {
  const isOnline = useOnlineStatus();
  const [webSpeechSupported, setWebSpeechSupported] = useState(() =>
    isSpeechRecognitionSupported(),
  );
  const offlineAcousticSupported = isOfflineAcousticPracticeSupported();
  const toneAudioSupported = isToneAudioSupported();

  const [preferredEngine, setPreferredEngine] = useState<PracticeEngine>(() =>
    isOnline && isSpeechRecognitionSupported() ? "web-speech" : "offline-tone",
  );
  const activeEngine: PracticeEngine =
    !isOnline || !webSpeechSupported ? "offline-tone" : preferredEngine;

  const [isListening, setIsListening] = useState(false);
  const [autoStopOnSilence, setAutoStopOnSilence] = useState(true);
  const [interimText, setInterimText] = useState("");
  const [liveLevel, setLiveLevel] = useState(0);
  const [livePitchHz, setLivePitchHz] = useState<number | null>(null);
  const [evaluation, setEvaluation] = useState<PronunciationEvaluation | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [isPlayingMine, setIsPlayingMine] = useState(false);
  const [activeToneIdx, setActiveToneIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micPermissionBlocked, setMicPermissionBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    void checkSpeechRecognitionAvailability().then((available) => {
      if (active && available) {
        setWebSpeechSupported(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const stopSessionRef = useRef<(() => void) | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const discardNextResultRef = useRef(false);

  const tips = useMemo(
    () => getPhrasePronunciationTips(phraseText, region, 3),
    [phraseText, region],
  );
  const regionTitle = DIALECT_META[region].fullRegionLabel;
  const toneSyllables = useMemo(
    () => getPhraseToneSyllables(phraseText, region),
    [phraseText, region],
  );

  const replaceRecordingUrl = useCallback((nextUrl: string | null) => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
    }
    recordingUrlRef.current = nextUrl;
    setRecordingUrl(nextUrl);
  }, []);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const stopMyVoicePlayback = useCallback(() => {
    clearPlaybackTimer();
    if (playbackAudioRef.current) {
      playbackAudioRef.current.onloadedmetadata = null;
      playbackAudioRef.current.onended = null;
      playbackAudioRef.current.onerror = null;
      playbackAudioRef.current.pause();
      playbackAudioRef.current.src = "";
      playbackAudioRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPlayingMine(false);
    }
  }, [clearPlaybackTimer]);

  const stopActiveSession = useCallback(() => {
    if (stopSessionRef.current) {
      stopSessionRef.current();
      stopSessionRef.current = null;
    }
    setIsListening(false);
    setLiveLevel(0);
    setLivePitchHz(null);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const unregisterExternal = audioService.registerExternalStopper(() => {
      stopMyVoicePlayback();
      if (isMountedRef.current) {
        setActiveToneIdx(null);
      }
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (stopSessionRef.current) {
          discardNextResultRef.current = true;
          stopSessionRef.current();
          stopSessionRef.current = null;
        }
        stopMyVoicePlayback();
        setIsListening(false);
        setLiveLevel(0);
        setLivePitchHz(null);
        setActiveToneIdx(null);
        stopToneContour();
        void abandonAndroidAudioFocus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isMountedRef.current = false;
      discardNextResultRef.current = true;
      unregisterExternal();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopSessionRef.current?.();
      stopSessionRef.current = null;
      stopMyVoicePlayback();
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = null;
      }
      stopToneContour();
      void abandonAndroidAudioFocus();
    };
  }, [stopMyVoicePlayback]);

  const startOfflinePractice = useCallback(() => {
    discardNextResultRef.current = false;
    setIsListening(true);
    setMicPermissionBlocked(false);
    stopSessionRef.current = startOfflineAcousticSession(
      phraseText,
      region,
      {
        onLiveLevel: (level, hz) => {
          if (!isMountedRef.current || discardNextResultRef.current) return;
          setLiveLevel(level);
          setLivePitchHz(hz);
        },
        onComplete: (result) => {
          if (!isMountedRef.current || discardNextResultRef.current) {
            discardNextResultRef.current = false;
            if (result.recordingUrl) {
              URL.revokeObjectURL(result.recordingUrl);
            }
            return;
          }
          stopSessionRef.current = null;
          setIsListening(false);
          setLiveLevel(0);
          setLivePitchHz(null);
          replaceRecordingUrl(result.recordingUrl);
          setEvaluation(result.evaluation);
          onPracticeEvaluated?.(result.evaluation.accuracy);
        },
        onError: (message, permissionDenied) => {
          if (!isMountedRef.current || discardNextResultRef.current) {
            discardNextResultRef.current = false;
            return;
          }
          stopSessionRef.current = null;
          setIsListening(false);
          setLiveLevel(0);
          setLivePitchHz(null);
          setErrorMessage(message);
          setMicPermissionBlocked(permissionDenied === true);
        },
      },
      { autoStopOnSilence },
    );
  }, [autoStopOnSilence, onPracticeEvaluated, phraseText, region, replaceRecordingUrl]);

  const startWebSpeechPractice = useCallback(() => {
    discardNextResultRef.current = false;
    setIsListening(true);
    setMicPermissionBlocked(false);
    stopSessionRef.current = startVietnameseRecognition({
      onInterim: (transcript) => {
        if (!isMountedRef.current || discardNextResultRef.current) return;
        setInterimText(transcript);
      },
      onResult: (candidates) => {
        if (!isMountedRef.current || discardNextResultRef.current) {
          discardNextResultRef.current = false;
          return;
        }
        setInterimText("");
        const evaluated = evaluatePronunciation(phraseText, candidates, region);
        setEvaluation(evaluated);
        onPracticeEvaluated?.(evaluated.accuracy);
      },
      onError: (reason, message) => {
        if (!isMountedRef.current || discardNextResultRef.current) {
          discardNextResultRef.current = false;
          return;
        }
        if (reason === "network" || reason === "unsupported") {
          setPreferredEngine("offline-tone");
          setErrorMessage(
            "Speech recognition is offline — switched to Offline Tone Coach automatically.",
          );
          return;
        }
        if (reason === "permission-denied") {
          setMicPermissionBlocked(true);
        }
        setErrorMessage(message);
      },
      onEnd: () => {
        stopSessionRef.current = null;
        if (isMountedRef.current) {
          setIsListening(false);
        }
      },
    });
  }, [onPracticeEvaluated, phraseText, region]);

  const handleToggleMic = useCallback(() => {
    if (isListening) {
      stopActiveSession();
      return;
    }

    audioService.stop();
    stopToneContour();
    stopMyVoicePlayback();
    setErrorMessage(null);
    setMicPermissionBlocked(false);
    setInterimText("");

    if (activeEngine === "offline-tone") {
      startOfflinePractice();
      return;
    }
    startWebSpeechPractice();
  }, [
    activeEngine,
    isListening,
    startOfflinePractice,
    startWebSpeechPractice,
    stopActiveSession,
    stopMyVoicePlayback,
  ]);

  const handleOpenAppSettings = useCallback(() => {
    void openAndroidAppSettings();
  }, []);

  const handlePlayMyVoice = useCallback(() => {
    if (!recordingUrl) return;
    if (isPlayingMine) {
      stopMyVoicePlayback();
      void abandonAndroidAudioFocus();
      return;
    }
    audioService.stop();
    stopToneContour();
    stopMyVoicePlayback();
    const audio = new Audio(recordingUrl);
    playbackAudioRef.current = audio;
    setIsPlayingMine(true);

    const clearPlayback = () => {
      clearPlaybackTimer();
      audio.onloadedmetadata = null;
      audio.onended = null;
      audio.onerror = null;
      audio.src = "";
      if (playbackAudioRef.current === audio) {
        playbackAudioRef.current = null;
      }
      if (isMountedRef.current) {
        setIsPlayingMine(false);
      }
      void abandonAndroidAudioFocus();
    };

    const armWatchdog = (durationSec?: number) => {
      if (typeof window === "undefined") return;
      clearPlaybackTimer();
      const waitMs =
        durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0
          ? Math.max(3000, Math.ceil(durationSec * 1000) + 3000)
          : 25_000;
      playbackTimerRef.current = window.setTimeout(() => {
        try {
          audio.pause();
        } catch {
          // Ignore pause failure on stalled audio
        }
        clearPlayback();
      }, waitMs);
    };

    audio.onloadedmetadata = () => {
      if (
        playbackAudioRef.current === audio &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        armWatchdog(audio.duration);
      }
    };
    audio.onended = clearPlayback;
    audio.onerror = clearPlayback;
    armWatchdog();
    void requestAndroidAudioFocus();
    void audio.play().catch(() => {
      clearPlayback();
    });
  }, [clearPlaybackTimer, isPlayingMine, recordingUrl, stopMyVoicePlayback]);

  const slowerSpeed = getSlowPlaybackSpeed(playbackSpeed);

  const handlePlayToneGuide = useCallback(() => {
    audioService.stop();
    void playVietnameseToneContour(phraseText, region, playbackSpeed, (idx) => {
      setActiveToneIdx(idx);
    });
  }, [phraseText, playbackSpeed, region]);

  const handlePlaySingleSyllable = useCallback(
    (syllable: string) => {
      audioService.stop();
      void playVietnameseToneContour(syllable, region, playbackSpeed);
    },
    [playbackSpeed, region],
  );

  const selectOfflineEngine = useCallback(() => {
    if (isListening) stopActiveSession();
    setPreferredEngine("offline-tone");
    setErrorMessage(null);
  }, [isListening, stopActiveSession]);

  const selectWebSpeechEngine = useCallback(() => {
    if (isListening) stopActiveSession();
    setPreferredEngine("web-speech");
    setErrorMessage(null);
  }, [isListening, stopActiveSession]);

  const toggleAutoStop = useCallback(() => {
    setAutoStopOnSilence((prev) => !prev);
  }, []);

  const micAvailable =
    activeEngine === "offline-tone" ? offlineAcousticSupported : webSpeechSupported;
  const showEngineSwitcher = isOnline && webSpeechSupported && offlineAcousticSupported;

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface-subtle p-4 text-left">
      <PracticeHeader
        region={region}
        activeEngine={activeEngine}
        micAvailable={micAvailable}
        isListening={isListening}
        hasEvaluation={evaluation !== null}
        bestAccuracy={bestAccuracy}
        onToggleMic={handleToggleMic}
      />

      <PracticeControlsRow
        showEngineSwitcher={showEngineSwitcher}
        activeEngine={activeEngine}
        micAvailable={micAvailable}
        autoStopOnSilence={autoStopOnSilence}
        onSelectOffline={selectOfflineEngine}
        onSelectWebSpeech={selectWebSpeechEngine}
        onToggleAutoStop={toggleAutoStop}
      />

      <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
        {REGION_CITY_BUTTONS.map((item) => (
          <RegionSelectorButton
            key={item.region}
            region={item.region}
            label={item.label}
            active={region === item.region}
            onSelect={onChangeRegion}
          />
        ))}
      </div>

      <PronunciationFocusCard
        region={region}
        regionTitle={regionTitle}
        tips={tips}
        toneSyllables={toneSyllables}
        evaluatedWords={evaluation?.words}
        activeToneIdx={activeToneIdx}
        toneAudioSupported={toneAudioSupported}
        slowerSpeed={slowerSpeed}
        onPlayNormal={onPlayNormal}
        onPlaySlow={onPlaySlow}
        onPlayToneGuide={handlePlayToneGuide}
        onPlaySingleSyllable={handlePlaySingleSyllable}
      />

      {!micAvailable ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-border bg-surface p-3 text-xs text-ink-secondary">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <p className="leading-relaxed">
            Microphone recording is unavailable in this browser. Use the interactive syllable tone
            chips above to drill tones offline.
          </p>
        </div>
      ) : null}

      {isListening ? (
        <LiveListeningBanner
          activeEngine={activeEngine}
          autoStopOnSilence={autoStopOnSilence}
          interimText={interimText}
          livePitchHz={livePitchHz}
          liveLevel={liveLevel}
        />
      ) : null}

      {errorMessage ? (
        <PracticeErrorBanner
          errorMessage={errorMessage}
          micPermissionBlocked={micPermissionBlocked}
          onOpenAppSettings={handleOpenAppSettings}
        />
      ) : null}

      {evaluation ? (
        <EvaluationFeedbackCard
          evaluation={evaluation}
          recordingUrl={recordingUrl}
          isPlayingMine={isPlayingMine}
          slowerSpeed={slowerSpeed}
          onPlayMine={handlePlayMyVoice}
          onPlaySlow={onPlaySlow}
        />
      ) : null}
    </div>
  );
};
