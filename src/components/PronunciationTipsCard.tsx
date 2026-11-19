import { BookOpen, Sparkles, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useCallback, useMemo } from "react";
import { audioService } from "../services/audioService";
import {
  getPhrasePronunciationTips,
  type PhrasePronunciationTip,
  type PronunciationTipCategory,
} from "../services/pronunciationTipsService";
import { type AppSettings, DIALECT_META } from "../types/vietnamese";

interface PronunciationTipsCardProps {
  phraseText: string;
  settings: AppSettings;
  maxTips?: number | undefined;
  compact?: boolean | undefined;
  onOpenGuide?: (() => void) | undefined;
  className?: string | undefined;
}

const CATEGORY_LABELS: Record<PronunciationTipCategory, string> = {
  dialect: "Dialect",
  tone: "Tone",
  sound: "Sound",
  vowel: "Vowel",
  ending: "Ending",
};

function getCategoryClass(category: PronunciationTipCategory): string {
  switch (category) {
    case "dialect":
      return "bg-[#0F766E]/10 text-[#0F766E]";
    case "tone":
      return "bg-amber-50 text-amber-800";
    case "sound":
      return "bg-stone-200/70 text-stone-700";
    case "vowel":
      return "bg-sky-50 text-sky-800";
    case "ending":
      return "bg-stone-200/70 text-stone-700";
  }
}

interface TipWordButtonProps {
  word: string;
  regionLabel: string;
  onSpeakWord: (word: string) => void;
}

const TipWordButton: FC<TipWordButtonProps> = ({ word, regionLabel, onSpeakWord }) => {
  const handleClick = useCallback(() => {
    onSpeakWord(word);
  }, [onSpeakWord, word]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Hear ${regionLabel} pronunciation of ${word}`}
      title={`Tap to hear "${word}"`}
      className="inline-flex min-h-[26px] items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-xs font-semibold text-stone-800 transition-colors hover:border-[#0F766E]/50 hover:text-[#0F766E]"
    >
      <span>{word}</span>
      <Volume2 className="h-3 w-3 text-[#0F766E]" aria-hidden="true" />
    </button>
  );
};

interface TipItemRowProps {
  tip: PhrasePronunciationTip;
  regionLabel: string;
  compact: boolean;
  onSpeakWord: (word: string) => void;
}

const TipItemRow: FC<TipItemRowProps> = ({ tip, regionLabel, compact, onSpeakWord }) => (
  <li
    className={`rounded-xl border border-stone-200/80 bg-stone-50/70 ${
      compact ? "px-3 py-2" : "px-3.5 py-2.5"
    }`}
  >
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getCategoryClass(tip.category)}`}
        >
          {CATEGORY_LABELS[tip.category]}
        </span>
        <span className="text-xs font-semibold text-stone-900">{tip.title}</span>
      </div>

      {tip.words.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {tip.words.map((word) => (
            <TipWordButton
              key={`${tip.id}-${word}`}
              word={word}
              regionLabel={regionLabel}
              onSpeakWord={onSpeakWord}
            />
          ))}
        </div>
      ) : null}
    </div>
    <p className="mt-1 text-xs leading-relaxed text-stone-600">{tip.detail}</p>
  </li>
);

export const PronunciationTipsCard: FC<PronunciationTipsCardProps> = ({
  phraseText,
  settings,
  maxTips = 3,
  compact = false,
  onOpenGuide,
  className = "",
}) => {
  const tips = useMemo(
    () => getPhrasePronunciationTips(phraseText, settings.region, maxTips),
    [maxTips, phraseText, settings.region],
  );

  const handleSpeakWord = useCallback(
    (word: string) => {
      void audioService.speakWithSettings(word, settings.region, settings);
    },
    [settings],
  );

  if (tips.length === 0) return null;

  const regionMeta = DIALECT_META[settings.region];

  return (
    <div className={`text-left ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[#0F766E]" aria-hidden="true" />
          <span className="text-xs font-semibold text-stone-900">
            Pronunciation Tips ·{" "}
            <span className="font-medium text-[#0F766E]">{regionMeta.label}</span>
          </span>
        </div>

        {onOpenGuide ? (
          <button
            type="button"
            onClick={onOpenGuide}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#0F766E] transition-colors hover:bg-[#0F766E]/10"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sound &amp; Tone Guide</span>
          </button>
        ) : null}
      </div>

      <ul className="mt-2 space-y-2">
        {tips.map((tip) => (
          <TipItemRow
            key={tip.id}
            tip={tip}
            regionLabel={regionMeta.label}
            compact={compact}
            onSpeakWord={handleSpeakWord}
          />
        ))}
      </ul>
    </div>
  );
};
