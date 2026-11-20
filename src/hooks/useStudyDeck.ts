import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INITIAL_PHRASES } from "../data/phrases";
import {
  createCustomPhraseInDeck,
  deletePhraseFromDeck,
  getStudyStats,
  type ImportAppStateResult,
  importSavedAppStateJson,
  loadPhrases,
  loadSettings,
  loadStarredWords,
  mergePhrasesFromStorage,
  mergeStarredWordsFromStorage,
  movePhraseInDeck,
  normalizePlaybackSpeed,
  PHRASES_KEY,
  parsePhrasesFromRaw,
  parseSettingsFromRaw,
  parseStarredWordsFromRaw,
  recordPhrasePractice,
  recordPhraseReview,
  SETTINGS_KEY,
  STARRED_WORDS_KEY,
  savePhrases,
  saveSettings,
  saveStarredWords,
  sortPhrasesForStudy,
  togglePhraseStarInDeck,
  toggleWordStarInList,
  updateCustomPhraseInDeck,
  updatePhrasePriorityInDeck,
} from "../services/storageService";
import type {
  AppSettings,
  DialectRegion,
  Phrase,
  PhrasePriority,
  ReviewOutcome,
  StarredWordRecord,
} from "../types/vietnamese";

export interface UseStudyDeckOptions {
  onStorageError?: (message: string) => void;
}

function areMergedEntriesIdentical<T>(merged: T[], incoming: T[]): boolean {
  if (merged.length !== incoming.length) return false;
  return JSON.stringify(merged) === JSON.stringify(incoming);
}

interface DirtyFlags {
  settings: boolean;
  phrases: boolean;
  starredWords: boolean;
}

function flushDirtySlice<T>(
  dirtyFlags: DirtyFlags,
  key: keyof DirtyFlags,
  value: T,
  saver: (data: T) => boolean,
): void {
  if (dirtyFlags[key] && saver(value)) {
    dirtyFlags[key] = false;
  }
}

export function useStudyDeck(options?: UseStudyDeckOptions) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [phrases, setPhrases] = useState<Phrase[]>(() => loadPhrases());
  const [starredWords, setStarredWords] = useState<StarredWordRecord[]>(() => loadStarredWords());
  const onStorageErrorRef = useRef(options?.onStorageError);
  const storageWarnedRef = useRef(false);

  const latestSettingsRef = useRef(settings);
  const latestPhrasesRef = useRef(phrases);
  const latestStarredWordsRef = useRef(starredWords);

  const syncedFromExternalRef = useRef<{
    settings: AppSettings | null;
    phrases: Phrase[] | null;
    starredWords: StarredWordRecord[] | null;
  }>({
    settings: settings,
    phrases: phrases,
    starredWords: starredWords,
  });

  const dirtyFlagsRef = useRef({
    settings: false,
    phrases: false,
    starredWords: false,
  });

  useEffect(() => {
    onStorageErrorRef.current = options?.onStorageError;
  }, [options?.onStorageError]);

  const notifyWriteResult = useCallback((saved: boolean) => {
    if (saved) {
      storageWarnedRef.current = false;
      return;
    }
    if (!storageWarnedRef.current) {
      storageWarnedRef.current = true;
      onStorageErrorRef.current?.(
        "Browser storage is full — recent changes may not persist after reload.",
      );
    }
  }, []);

  useEffect(() => {
    latestSettingsRef.current = settings;
    if (syncedFromExternalRef.current.settings === settings) {
      syncedFromExternalRef.current.settings = null;
      dirtyFlagsRef.current.settings = false;
      return undefined;
    }
    syncedFromExternalRef.current.settings = null;
    dirtyFlagsRef.current.settings = true;

    const timerId = window.setTimeout(() => {
      const saved = saveSettings(latestSettingsRef.current);
      dirtyFlagsRef.current.settings = !saved;
      notifyWriteResult(saved);
    }, 250);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [notifyWriteResult, settings]);

  useEffect(() => {
    latestPhrasesRef.current = phrases;
    if (syncedFromExternalRef.current.phrases === phrases) {
      syncedFromExternalRef.current.phrases = null;
      dirtyFlagsRef.current.phrases = false;
      return undefined;
    }
    syncedFromExternalRef.current.phrases = null;
    dirtyFlagsRef.current.phrases = true;

    const timerId = window.setTimeout(() => {
      const saved = savePhrases(latestPhrasesRef.current);
      dirtyFlagsRef.current.phrases = !saved;
      notifyWriteResult(saved);
    }, 180);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [notifyWriteResult, phrases]);

  useEffect(() => {
    latestStarredWordsRef.current = starredWords;
    if (syncedFromExternalRef.current.starredWords === starredWords) {
      syncedFromExternalRef.current.starredWords = null;
      dirtyFlagsRef.current.starredWords = false;
      return undefined;
    }
    syncedFromExternalRef.current.starredWords = null;
    dirtyFlagsRef.current.starredWords = true;

    const timerId = window.setTimeout(() => {
      const saved = saveStarredWords(latestStarredWordsRef.current);
      dirtyFlagsRef.current.starredWords = !saved;
      notifyWriteResult(saved);
    }, 180);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [notifyWriteResult, starredWords]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const flushState = () => {
      flushDirtySlice(dirtyFlagsRef.current, "settings", latestSettingsRef.current, saveSettings);
      flushDirtySlice(dirtyFlagsRef.current, "phrases", latestPhrasesRef.current, savePhrases);
      flushDirtySlice(
        dirtyFlagsRef.current,
        "starredWords",
        latestStarredWordsRef.current,
        saveStarredWords,
      );
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        flushState();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null) {
        const nextSettings = loadSettings();
        const nextPhrases = loadPhrases();
        const nextStarred = loadStarredWords();
        syncedFromExternalRef.current = {
          settings: nextSettings,
          phrases: nextPhrases,
          starredWords: nextStarred,
        };
        setSettings(nextSettings);
        setPhrases(nextPhrases);
        setStarredWords(nextStarred);
        return;
      }
      if (event.key === SETTINGS_KEY) {
        const parsed = parseSettingsFromRaw(event.newValue);
        syncedFromExternalRef.current.settings = parsed;
        setSettings(parsed);
      } else if (event.key === PHRASES_KEY) {
        const parsed = parsePhrasesFromRaw(event.newValue);
        const merged = mergePhrasesFromStorage(latestPhrasesRef.current, parsed);
        if (areMergedEntriesIdentical(merged, parsed)) {
          syncedFromExternalRef.current.phrases = merged;
        }
        setPhrases(merged);
      } else if (event.key === STARRED_WORDS_KEY) {
        const parsed = parseStarredWordsFromRaw(event.newValue);
        const merged = mergeStarredWordsFromStorage(latestStarredWordsRef.current, parsed);
        if (areMergedEntriesIdentical(merged, parsed)) {
          syncedFromExternalRef.current.starredWords = merged;
        }
        setStarredWords(merged);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pagehide", flushState);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pagehide", flushState);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  const stats = useMemo(
    () => getStudyStats(phrases, undefined, starredWords.length),
    [phrases, starredWords.length],
  );

  const starredWordIds = useMemo(
    () => new Set(starredWords.map((item) => item.entryId)),
    [starredWords],
  );

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const nextPlaybackSpeed =
        patch.playbackSpeed !== undefined
          ? normalizePlaybackSpeed(patch.playbackSpeed, prev.playbackSpeed)
          : patch.slowVietnamese !== undefined
            ? patch.slowVietnamese
              ? 70
              : 100
            : prev.playbackSpeed;
      return {
        ...prev,
        ...patch,
        playbackSpeed: nextPlaybackSpeed,
        slowVietnamese: nextPlaybackSpeed <= 75,
      };
    });
  }, []);

  const setRegion = useCallback(
    (region: DialectRegion) => {
      updateSettings({ region });
    },
    [updateSettings],
  );

  const updatePriority = useCallback((id: string, priority: PhrasePriority) => {
    setPhrases((prev) => updatePhrasePriorityInDeck(prev, id, priority));
  }, []);

  const recordReview = useCallback((id: string, outcome: ReviewOutcome) => {
    setPhrases((prev) => recordPhraseReview(prev, id, outcome));
  }, []);

  const recordPractice = useCallback((id: string, accuracy: number) => {
    setPhrases((prev) => recordPhrasePractice(prev, id, accuracy));
  }, []);

  const movePhrase = useCallback((id: string, direction: "up" | "down") => {
    setPhrases((prev) => movePhraseInDeck(prev, id, direction));
  }, []);

  const addPhrase = useCallback((newItem: Omit<Phrase, "id" | "sortOrder">) => {
    setPhrases((prev) => createCustomPhraseInDeck(prev, newItem));
  }, []);

  const updateCustomPhrase = useCallback((id: string, patch: Omit<Phrase, "id" | "sortOrder">) => {
    setPhrases((prev) => updateCustomPhraseInDeck(prev, id, patch));
  }, []);

  const deleteCustomPhrase = useCallback((id: string) => {
    setPhrases((prev) => deletePhraseFromDeck(prev, id));
  }, []);

  const restorePhrasesSnapshot = useCallback((snapshot: Phrase[]) => {
    setPhrases(snapshot);
  }, []);

  const togglePhraseStar = useCallback((id: string) => {
    setPhrases((prev) => togglePhraseStarInDeck(prev, id));
  }, []);

  const toggleWordStar = useCallback((entryId: string) => {
    setStarredWords((prev) => toggleWordStarInList(prev, entryId));
  }, []);

  const resetPhrases = useCallback(() => {
    const fresh = sortPhrasesForStudy(INITIAL_PHRASES.map((p) => ({ ...p })));
    syncedFromExternalRef.current.phrases = null;
    setPhrases(fresh);
  }, []);

  const importBackup = useCallback((rawJson: string): ImportAppStateResult => {
    const result = importSavedAppStateJson(rawJson);
    if (!result.ok) {
      return result;
    }
    syncedFromExternalRef.current = {
      settings: result.settings,
      phrases: result.phrases,
      starredWords: result.starredWords,
    };
    storageWarnedRef.current = false;
    setSettings(result.settings);
    setPhrases(result.phrases);
    setStarredWords(result.starredWords);
    return result;
  }, []);

  return {
    phrases,
    starredWords,
    starredWordIds,
    settings,
    stats,
    updateSettings,
    setRegion,
    updatePriority,
    recordReview,
    recordPractice,
    movePhrase,
    addPhrase,
    updateCustomPhrase,
    deleteCustomPhrase,
    restorePhrasesSnapshot,
    togglePhraseStar,
    toggleWordStar,
    resetPhrases,
    importBackup,
  };
}
