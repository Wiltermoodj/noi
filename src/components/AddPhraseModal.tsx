import { ChevronDown, ChevronUp, Loader2, Star, Volume2, X } from "lucide-react";
import type { ChangeEvent, FC, SyntheticEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { useSpeakingStatus } from "../hooks/useSpeakingStatus";
import { audioService } from "../services/audioService";
import { registerBackHandler } from "../services/nativePlatform";
import { approximateVietnamesePhonetic } from "../services/toneAudioService";
import {
  type AppSettings,
  type DialectRegion,
  PHRASE_CATEGORIES,
  type Phrase,
  type PhraseCategory,
} from "../types/vietnamese";

interface AddPhraseModalProps {
  open: boolean;
  defaultStarred?: boolean;
  initialPhrase?: Phrase | null | undefined;
  settings?: AppSettings | undefined;
  onClose: () => void;
  onAddPhrase: (phrase: Omit<Phrase, "id" | "sortOrder">) => void;
  onUpdatePhrase?: ((id: string, patch: Omit<Phrase, "id" | "sortOrder">) => void) | undefined;
}

function getInitialRegionalToggle(initialPhrase?: Phrase | null): boolean {
  if (!initialPhrase) return false;
  return (
    initialPhrase.north !== initialPhrase.south || initialPhrase.central !== initialPhrase.south
  );
}

function getInitialVietnamese(
  initialPhrase: Phrase | null | undefined,
  region: DialectRegion,
): string {
  if (!initialPhrase) return "";
  if (region === "north") return initialPhrase.north;
  if (region === "central") return initialPhrase.central;
  return initialPhrase.south;
}

function getInitialPhonetic(
  initialPhrase: Phrase | null | undefined,
  region: DialectRegion,
): string {
  if (!initialPhrase) return "";
  if (region === "north") return initialPhrase.phoneticNorth;
  if (region === "central") return initialPhrase.phoneticCentral;
  return initialPhrase.phoneticSouth;
}

interface BuildPayloadArgs {
  english: string;
  baseVi: string;
  showRegional: boolean;
  northVi: string;
  centralVi: string;
  southVi: string;
  phonetic: string;
  note: string;
  category: PhraseCategory;
  starOnSave: boolean;
  initialPhrase: Phrase | null | undefined;
}

function buildCustomPhrasePayload(args: BuildPayloadArgs): Omit<Phrase, "id" | "sortOrder"> | null {
  const en = args.english.trim();
  const base = args.baseVi.trim();
  const nVi = (args.showRegional ? args.northVi.trim() : base) || base;
  const cVi = (args.showRegional ? args.centralVi.trim() : base) || base;
  const sVi = (args.showRegional ? args.southVi.trim() : base) || base;
  if (!en || (!base && !nVi && !cVi && !sVi)) return null;

  const manualPhonetic = args.phonetic.trim();
  const now = Date.now();
  return {
    category: args.category,
    english: en,
    north: nVi,
    central: cVi,
    south: sVi,
    phoneticNorth: manualPhonetic || approximateVietnamesePhonetic(nVi, "north"),
    phoneticCentral: manualPhonetic || approximateVietnamesePhonetic(cVi, "central"),
    phoneticSouth: manualPhonetic || approximateVietnamesePhonetic(sVi, "south"),
    textbook: args.initialPhrase?.textbook ?? "Custom saved phrase",
    streetNote: args.note.trim() || "Added to your offline phrasebook.",
    priority: args.initialPhrase?.priority ?? 3,
    isCustom: true,
    isStarred: args.starOnSave,
    starredAt: args.starOnSave ? (args.initialPhrase?.starredAt ?? now) : undefined,
  };
}

const AddPhraseModalContent: FC<Omit<AddPhraseModalProps, "open">> = ({
  defaultStarred = false,
  initialPhrase = null,
  settings,
  onClose,
  onAddPhrase,
  onUpdatePhrase,
}) => {
  const activeRegion = settings?.region ?? "south";
  const isEditing = Boolean(initialPhrase);

  const [newEnglish, setNewEnglish] = useState(initialPhrase?.english ?? "");
  const [newVietnamese, setNewVietnamese] = useState(() =>
    getInitialVietnamese(initialPhrase, activeRegion),
  );
  const [showRegional, setShowRegional] = useState(() => getInitialRegionalToggle(initialPhrase));
  const [northVi, setNorthVi] = useState(initialPhrase?.north ?? "");
  const [centralVi, setCentralVi] = useState(initialPhrase?.central ?? "");
  const [southVi, setSouthVi] = useState(initialPhrase?.south ?? "");
  const [newPhonetic, setNewPhonetic] = useState(() =>
    getInitialPhonetic(initialPhrase, activeRegion),
  );
  const [newNote, setNewNote] = useState(initialPhrase?.streetNote ?? "");
  const [newCategory, setNewCategory] = useState<PhraseCategory>(
    initialPhrase?.category ?? "Conversation",
  );
  const [starOnSave, setStarOnSave] = useState(initialPhrase?.isStarred ?? defaultStarred);
  const speakingState = useSpeakingStatus();

  const modalTitleId = useId();
  const englishInputId = useId();
  const vietnameseInputId = useId();
  const northInputId = useId();
  const centralInputId = useId();
  const southInputId = useId();
  const phoneticInputId = useId();
  const categorySelectId = useId();
  const noteInputId = useId();
  const starCheckboxId = useId();

  useEffect(() => {
    const unsubBack = registerBackHandler(() => {
      onClose();
      return true;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubBack();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const handleNewEnglishChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setNewEnglish(e.target.value);
  }, []);

  const handleNewVietnameseChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setNewVietnamese(val);
      if (!showRegional) {
        setNorthVi(val);
        setCentralVi(val);
        setSouthVi(val);
      }
    },
    [showRegional],
  );

  const handleToggleRegional = useCallback(() => {
    setShowRegional((prev) => {
      const next = !prev;
      if (next) {
        setNorthVi((cur) => cur || newVietnamese);
        setCentralVi((cur) => cur || newVietnamese);
        setSouthVi((cur) => cur || newVietnamese);
      } else {
        const activeRegionalText =
          activeRegion === "north" ? northVi : activeRegion === "central" ? centralVi : southVi;
        if (activeRegionalText.trim().length > 0 && !newVietnamese.trim()) {
          setNewVietnamese(activeRegionalText);
        }
      }
      return next;
    });
  }, [activeRegion, centralVi, newVietnamese, northVi, southVi]);

  const handleNorthChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setNorthVi(e.target.value);
  }, []);

  const handleCentralChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCentralVi(e.target.value);
  }, []);

  const handleSouthChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSouthVi(e.target.value);
  }, []);

  const handleNewPhoneticChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setNewPhonetic(e.target.value);
  }, []);

  const handleNewCategoryChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setNewCategory(e.target.value as PhraseCategory);
  }, []);

  const handleNewNoteChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setNewNote(e.target.value);
  }, []);

  const handleStarOnSaveChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setStarOnSave(e.target.checked);
  }, []);

  const handlePreviewAudio = useCallback(() => {
    const sampleText = showRegional
      ? (activeRegion === "north" ? northVi : activeRegion === "central" ? centralVi : southVi) ||
        newVietnamese
      : newVietnamese;
    if (!sampleText.trim()) return;
    if (settings) {
      void audioService.speakWithSettings(sampleText, activeRegion, settings);
    } else {
      void audioService.speakVietnamese(sampleText, activeRegion);
    }
  }, [activeRegion, centralVi, newVietnamese, northVi, settings, showRegional, southVi]);

  const handleCreate = useCallback(
    (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      const payload = buildCustomPhrasePayload({
        english: newEnglish,
        baseVi: newVietnamese,
        showRegional,
        northVi,
        centralVi,
        southVi,
        phonetic: newPhonetic,
        note: newNote,
        category: newCategory,
        starOnSave,
        initialPhrase,
      });
      if (!payload) return;

      if (initialPhrase && onUpdatePhrase) {
        onUpdatePhrase(initialPhrase.id, payload);
      } else {
        onAddPhrase(payload);
      }
      onClose();
    },
    [
      centralVi,
      initialPhrase,
      newCategory,
      newEnglish,
      newNote,
      newPhonetic,
      newVietnamese,
      northVi,
      onAddPhrase,
      onClose,
      onUpdatePhrase,
      showRegional,
      southVi,
      starOnSave,
    ],
  );

  const previewBusy = speakingState.isSpeaking || speakingState.isLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close modal backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-backdrop backdrop-blur-xs"
      />

      <form
        onSubmit={handleCreate}
        className="pb-safe-modal relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-xl sm:rounded-2xl sm:pb-6"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-center justify-between gap-4">
          <h2 id={modalTitleId} className="font-display text-lg font-semibold text-ink">
            {isEditing ? "Edit Custom Phrase" : "Add Custom Phrase"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor={englishInputId}
              className="block text-xs font-medium text-ink-secondary"
            >
              English meaning
            </label>
            <input
              id={englishInputId}
              type="text"
              required
              value={newEnglish}
              onChange={handleNewEnglishChange}
              placeholder="e.g., No ice, please."
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={vietnameseInputId}
                className="block text-xs font-medium text-ink-secondary"
              >
                Spoken Vietnamese
              </label>
              <button
                type="button"
                onClick={handlePreviewAudio}
                disabled={!newVietnamese.trim()}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                {previewBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Preview</span>
              </button>
            </div>
            <input
              id={vietnameseInputId}
              type="text"
              required={!showRegional}
              value={newVietnamese}
              onChange={handleNewVietnameseChange}
              placeholder="e.g., Không đá nha chị."
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />

            <button
              type="button"
              onClick={handleToggleRegional}
              aria-expanded={showRegional}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-accent"
            >
              {showRegional ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Customize North / Central / South variants</span>
            </button>

            {showRegional ? (
              <div className="mt-2.5 space-y-2.5 rounded-xl bg-surface-subtle p-3">
                <div>
                  <label
                    htmlFor={northInputId}
                    className="block text-[11px] font-medium text-ink-secondary"
                  >
                    North (Hanoi)
                  </label>
                  <input
                    id={northInputId}
                    type="text"
                    value={northVi}
                    onChange={handleNorthChange}
                    placeholder="Northern phrasing"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={centralInputId}
                    className="block text-[11px] font-medium text-ink-secondary"
                  >
                    Central (Hue · Da Nang)
                  </label>
                  <input
                    id={centralInputId}
                    type="text"
                    value={centralVi}
                    onChange={handleCentralChange}
                    placeholder="Central phrasing"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={southInputId}
                    className="block text-[11px] font-medium text-ink-secondary"
                  >
                    South (Saigon)
                  </label>
                  <input
                    id={southInputId}
                    type="text"
                    value={southVi}
                    onChange={handleSouthChange}
                    placeholder="Southern phrasing"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor={phoneticInputId}
              className="block text-xs font-medium text-ink-secondary"
            >
              Phonetic guide (optional)
            </label>
            <input
              id={phoneticInputId}
              type="text"
              value={newPhonetic}
              onChange={handleNewPhoneticChange}
              placeholder="e.g., khong dah nyah chee"
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor={categorySelectId}
              className="block text-xs font-medium text-ink-secondary"
            >
              Category
            </label>
            <select
              id={categorySelectId}
              value={newCategory}
              onChange={handleNewCategoryChange}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {PHRASE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={noteInputId} className="block text-xs font-medium text-ink-secondary">
              Personal note (optional)
            </label>
            <input
              id={noteInputId}
              type="text"
              value={newNote}
              onChange={handleNewNoteChange}
              placeholder="e.g., Coffee shop near Ben Thanh"
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>

          <label
            htmlFor={starCheckboxId}
            className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-subtle px-3.5 py-2"
          >
            <span className="flex items-center gap-2 text-xs font-medium text-ink">
              <Star
                className={`h-4 w-4 ${starOnSave ? "fill-star-fill text-star" : "text-ink-faint"}`}
                aria-hidden="true"
              />
              <span>Save to Personal Phrasebook</span>
            </span>
            <input
              id={starCheckboxId}
              type="checkbox"
              checked={starOnSave}
              onChange={handleStarOnSaveChange}
              className="h-4 w-4 accent-accent"
            />
          </label>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl border border-border text-sm font-medium text-ink-secondary hover:bg-surface-subtle"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-[48px] flex-1 rounded-xl bg-accent text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            {isEditing ? "Save Changes" : "Save Offline"}
          </button>
        </div>
      </form>
    </div>
  );
};

export const AddPhraseModal: FC<AddPhraseModalProps> = ({ open, ...rest }) => {
  if (!open) return null;
  return <AddPhraseModalContent key={rest.initialPhrase?.id ?? "new"} {...rest} />;
};
