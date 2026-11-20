import { Search, X } from "lucide-react";
import type { ChangeEvent, FC, KeyboardEvent } from "react";
import { useCallback, useRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const SearchBar: FC<SearchBarProps> = ({
  value,
  onChange,
  ariaLabel,
  placeholder = "Search...",
  disabled = false,
  className = "",
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape" && value.length > 0) {
        e.preventDefault();
        onChange("");
      }
    },
    [onChange, value.length],
  );

  const hasValue = value.length > 0;

  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={`min-h-[44px] w-full rounded-xl border border-border bg-surface pl-10 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
          hasValue && !disabled ? "pr-11" : "pr-4"
        }`}
      />
      {hasValue && !disabled ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search"
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink-secondary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};
