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
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
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
        className={`min-h-[44px] w-full rounded-xl border border-stone-200 bg-white pl-10 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#0F766E] focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
          hasValue && !disabled ? "pr-11" : "pr-4"
        }`}
      />
      {hasValue && !disabled ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search"
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};
