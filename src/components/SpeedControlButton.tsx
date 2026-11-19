import { ChevronDown, Gauge } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackSpeedSlider } from "./PlaybackSpeedSlider";

interface SpeedControlButtonProps {
  value: number;
  onChange: (speedPercent: number) => void;
}

export const SpeedControlButton: FC<SpeedControlButtonProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label={`Speech speed ${String(value)}%`}
        className={`inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-xs font-medium tabular-nums transition-colors ${
          value < 100 || open
            ? "border-[#0F766E]/40 bg-[#0F766E]/10 text-[#0F766E]"
            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
        }`}
      >
        <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{value}%</span>
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl sm:w-80">
          <PlaybackSpeedSlider variant="full" value={value} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
};
