import { Gauge } from "lucide-react";
import type { ChangeEvent, FC } from "react";
import { useCallback, useId } from "react";
import { audioService } from "../services/audioService";
import { getSmartPaceLabel } from "../services/playbackPacing";
import { MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from "../types/vietnamese";

interface PlaybackSpeedSliderProps {
  value: number;
  onChange: (speedPercent: number) => void;
  variant?: "compact" | "full" | undefined;
}

const SPEED_PRESETS = [10, 25, 50, 75, 100] as const;

interface SpeedPresetButtonProps {
  preset: number;
  active: boolean;
  onSelect: (preset: number) => void;
}

const SpeedPresetButton: FC<SpeedPresetButtonProps> = ({ preset, active, onSelect }) => {
  const handleClick = useCallback(() => {
    audioService.setLivePlaybackSpeed(preset);
    onSelect(preset);
  }, [onSelect, preset]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={`min-h-[30px] rounded-lg border px-2.5 text-xs font-medium tabular-nums transition-colors ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface text-ink-secondary hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      {preset}%
    </button>
  );
};

export const PlaybackSpeedSlider: FC<PlaybackSpeedSliderProps> = ({
  value,
  onChange,
  variant = "compact",
}) => {
  const sliderId = useId();

  const handleSliderChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, Math.round(next)));
      audioService.setLivePlaybackSpeed(clamped);
      onChange(clamped);
    },
    [onChange],
  );

  if (variant === "full") {
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor={sliderId} className="text-sm font-medium text-ink">
              Playback Speed
            </label>
            <p className="mt-0.5 text-xs text-ink-muted">
              Slows vowels gently while adding space between words so tones stay clear.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="inline-flex items-center rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent tabular-nums">
              {value}%
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              {getSmartPaceLabel(value)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-ink-muted tabular-nums">10%</span>
          <input
            id={sliderId}
            type="range"
            min={MIN_PLAYBACK_SPEED}
            max={MAX_PLAYBACK_SPEED}
            step={1}
            value={value}
            onChange={handleSliderChange}
            aria-label="Vietnamese playback speed percentage"
            aria-valuetext={`${String(value)}% (${getSmartPaceLabel(value)})`}
            className="h-2 w-full cursor-pointer accent-accent"
          />
          <span className="text-[11px] font-medium text-ink-muted tabular-nums">100%</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SPEED_PRESETS.map((preset) => (
            <SpeedPresetButton
              key={preset}
              preset={preset}
              active={value === preset}
              onSelect={onChange}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-subtle px-3 py-2">
      <label
        htmlFor={sliderId}
        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-secondary"
      >
        <Gauge className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
        <span>Speed</span>
      </label>

      <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">10%</span>
      <input
        id={sliderId}
        type="range"
        min={MIN_PLAYBACK_SPEED}
        max={MAX_PLAYBACK_SPEED}
        step={1}
        value={value}
        onChange={handleSliderChange}
        aria-label="Playback speed"
        aria-valuetext={`${String(value)}% (${getSmartPaceLabel(value)})`}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-accent"
      />
      <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">100%</span>

      <span className="min-w-[38px] shrink-0 text-right text-xs font-semibold text-accent tabular-nums">
        {value}%
      </span>
    </div>
  );
};
