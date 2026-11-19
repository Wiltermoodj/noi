import type { FC } from "react";
import { useCallback, useState } from "react";
import { DIALECT_META, type DialectRegion } from "../types/vietnamese";

const REGION_ICON_SRC: Record<DialectRegion, string> = {
  north: "/northern-vietnam-icon-96.png",
  central: "/central-vietnam-icon-96.png",
  south: "/southern-vietnam-icon-96.png",
};

const REGION_FALLBACK_STYLE: Record<DialectRegion, { bg: string; letter: string }> = {
  north: { bg: "bg-rose-700 text-white", letter: "N" },
  central: { bg: "bg-fuchsia-700 text-white", letter: "C" },
  south: { bg: "bg-emerald-800 text-white", letter: "S" },
};

interface RegionIconProps {
  region: DialectRegion;
  className?: string | undefined;
  alt?: string | undefined;
}

export const RegionIcon: FC<RegionIconProps> = ({ region, className = "h-6 w-6", alt = "" }) => {
  const [failedRegion, setFailedRegion] = useState<DialectRegion | null>(null);

  const handleError = useCallback(() => {
    setFailedRegion(region);
  }, [region]);

  if (failedRegion === region) {
    const fallback = REGION_FALLBACK_STYLE[region];
    if (alt === "") {
      return (
        <span
          aria-hidden="true"
          className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${fallback.bg} ${className}`}
        >
          {fallback.letter}
        </span>
      );
    }
    return (
      <span
        role="img"
        aria-label={alt}
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${fallback.bg} ${className}`}
      >
        {fallback.letter}
      </span>
    );
  }

  return (
    <img
      src={REGION_ICON_SRC[region]}
      alt={alt}
      title={alt === "" ? undefined : DIALECT_META[region].regionName}
      width={96}
      height={96}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
      className={`shrink-0 rounded-full object-contain ${className}`}
    />
  );
};
