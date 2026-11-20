import { Search, X } from "lucide-react";
import type { ChangeEvent, FC, KeyboardEvent, RefObject, TransitionEvent } from "react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type { AppSettings, Phrase } from "../types/vietnamese";
import type { ShowBigPayload } from "./ShowBigModal";

const HeaderSearchDropdownLazy = lazy(async () => ({
  default: (await import("./HeaderSearchDropdown")).HeaderSearchDropdown,
}));

interface HeaderSearchProps {
  headerContainerRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  isElevated: boolean;
  onOpen: () => void;
  onClose: () => void;
  onElevationEnd: () => void;
  phrases: Phrase[];
  starredWordIds: Set<string>;
  settings: AppSettings;
  onTogglePhraseStar: (id: string) => void;
  onToggleWordStar: (entryId: string) => void;
  onShowBig: (payload: ShowBigPayload) => void;
  onOpenInTranslate: (query: string) => void;
}

export const HeaderSearch: FC<HeaderSearchProps> = ({
  headerContainerRef,
  isOpen,
  isElevated,
  onOpen,
  onClose,
  onElevationEnd,
  phrases,
  starredWordIds,
  settings,
  onTogglePhraseStar,
  onToggleWordStar,
  onShowBig,
  onOpenInTranslate,
}) => {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [expandedWidth, setExpandedWidth] = useState(320);

  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMatchesRef = useRef(true);

  const computeExpandedWidth = useCallback((): number => {
    const headerEl = headerContainerRef.current;
    const anchorEl = anchorRef.current;
    if (!headerEl || !anchorEl) {
      return 320;
    }
    const headerRect = headerEl.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    const parsedPaddingRight = Number.parseFloat(window.getComputedStyle(headerEl).paddingRight);
    const paddingRight =
      Number.isFinite(parsedPaddingRight) && parsedPaddingRight > 0 ? parsedPaddingRight : 16;
    const available = Math.floor(headerRect.right - paddingRight - anchorRect.left);
    return Math.max(200, available);
  }, [headerContainerRef]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updateWidth = () => {
      setExpandedWidth(computeExpandedWidth());
    };
    updateWidth();

    const headerEl = headerContainerRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && headerEl
        ? new ResizeObserver(updateWidth)
        : undefined;
    if (observer && headerEl) {
      observer.observe(headerEl);
    }
    window.addEventListener("resize", updateWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [computeExpandedWidth, headerContainerRef, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen || !isElevated) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onElevationEnd();
      return undefined;
    }
    const fallbackTimer = window.setTimeout(() => {
      onElevationEnd();
    }, 1200);
    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [isElevated, isOpen, onElevationEnd]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleOpenClick = useCallback(() => {
    setExpandedWidth(computeExpandedWidth());
    onOpen();
  }, [computeExpandedWidth, onOpen]);

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClearQuery = useCallback(() => {
    setQuery("");
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  const handleHasMatchesChange = useCallback((hasMatches: boolean) => {
    hasMatchesRef.current = hasMatches;
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && query.trim().length > 0 && !hasMatchesRef.current) {
        event.preventDefault();
        onOpenInTranslate(query.trim());
        onClose();
      }
    },
    [onClose, onOpenInTranslate, query],
  );

  const handleBarTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && event.propertyName === "width" && !isOpen) {
        onElevationEnd();
      }
    },
    [isOpen, onElevationEnd],
  );

  const handleOpenTranslator = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    onOpenInTranslate(trimmed);
    onClose();
  }, [onClose, onOpenInTranslate, query]);

  const handleSelectChip = useCallback((value: string) => {
    setQuery(value);
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <div ref={anchorRef} className="relative h-11 w-11 shrink-0">
      <div
        role={isOpen ? "search" : undefined}
        onTransitionEnd={handleBarTransitionEnd}
        style={{ width: isOpen ? `${String(expandedWidth)}px` : "44px" }}
        className={`absolute left-0 top-0 flex h-11 items-center overflow-hidden rounded-xl transition-[width,background-color,border-color,box-shadow] duration-[1120ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen
            ? "z-[9999] border border-accent-border bg-surface shadow-lg ring-2 ring-accent-soft"
            : isElevated
              ? "z-[9999] border border-border bg-surface-nav shadow-sm"
              : "border border-transparent bg-transparent"
        }`}
      >
        {isOpen ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center text-accent">
            <Search className="h-5 w-5" aria-hidden="true" />
          </div>
        ) : (
          <button
            type="button"
            onClick={handleOpenClick}
            aria-label="Open search"
            aria-expanded={false}
            title="Search phrases and vocabulary"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          tabIndex={isOpen ? 0 : -1}
          aria-hidden={!isOpen}
          aria-label="Search phrases, vocabulary, or VND prices"
          placeholder="Search phrases, words, or prices (e.g. 50k)..."
          className={`h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
            isOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />

        {isOpen ? (
          <div className="flex shrink-0 items-center gap-0.5 pr-1">
            {hasQuery ? (
              <button
                type="button"
                onClick={handleClearQuery}
                aria-label="Clear search query"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink-secondary"
              >
                <span className="text-[11px] font-medium">Clear</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCloseClick}
              aria-label="Close search"
              title="Close search"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <Suspense
          fallback={
            <div
              style={{ width: `${String(expandedWidth)}px` }}
              className="absolute left-0 top-full z-[9999] mt-2 rounded-2xl border border-border bg-surface p-4 text-xs text-ink-muted shadow-2xl"
            >
              Loading search…
            </div>
          }
        >
          <HeaderSearchDropdownLazy
            expandedWidth={expandedWidth}
            trimmedQuery={trimmedQuery}
            deferredQuery={deferredQuery}
            phrases={phrases}
            starredWordIds={starredWordIds}
            settings={settings}
            onSelectChip={handleSelectChip}
            onOpenTranslator={handleOpenTranslator}
            onTogglePhraseStar={onTogglePhraseStar}
            onToggleWordStar={onToggleWordStar}
            onShowBig={onShowBig}
            onClose={onClose}
            onHasMatchesChange={handleHasMatchesChange}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
