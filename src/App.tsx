import { BookOpen, GraduationCap, SlidersHorizontal, Star } from "lucide-react";
import {
  type ComponentType,
  type FC,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GoogleTranslateIcon } from "./components/GoogleTranslateIcon";
import { HeaderSearch } from "./components/HeaderSearch";
import { LearnView } from "./components/LearnView";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { PWAUpdatePrompt } from "./components/PWAUpdatePrompt";
import type { ShowBigPayload } from "./components/ShowBigModal";
import { ToastBanner, type ToastItem } from "./components/ToastBanner";
import { useStudyDeck } from "./hooks/useStudyDeck";
import { initializeNativeShell } from "./services/nativePlatform";

function clearChunkReloadFlag(reloadFlagKey: string): void {
  try {
    window.sessionStorage.removeItem(reloadFlagKey);
  } catch {
    // Ignore storage access errors
  }
}

function lazyWithRetry<TProps>(
  importer: () => Promise<{ default: ComponentType<TProps> }>,
  chunkKey: string,
) {
  return lazy(async () => {
    const reloadFlagKey = `noi_chunk_reload_${chunkKey}`;
    try {
      const mod = await importer();
      clearChunkReloadFlag(reloadFlagKey);
      return mod;
    } catch {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 300);
      });
      try {
        const mod = await importer();
        clearChunkReloadFlag(reloadFlagKey);
        return mod;
      } catch (retryError) {
        let alreadyReloaded: boolean;
        try {
          alreadyReloaded = window.sessionStorage.getItem(reloadFlagKey) === "1";
          if (!alreadyReloaded) {
            window.sessionStorage.setItem(reloadFlagKey, "1");
          }
        } catch {
          alreadyReloaded = true;
        }
        if (!alreadyReloaded) {
          window.location.reload();
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500);
          });
        }
        throw retryError;
      }
    }
  });
}

const PhrasesView = lazyWithRetry(
  async () => ({
    default: (await import("./components/PhrasesView")).PhrasesView,
  }),
  "phrases",
);
const PhrasebookView = lazyWithRetry(
  async () => ({
    default: (await import("./components/PhrasebookView")).PhrasebookView,
  }),
  "phrasebook",
);
const TranslateView = lazyWithRetry(
  async () => ({
    default: (await import("./components/TranslateView")).TranslateView,
  }),
  "translate",
);
const SettingsModal = lazyWithRetry(
  async () => ({
    default: (await import("./components/SettingsModal")).SettingsModal,
  }),
  "settings",
);
const ShowBigModal = lazyWithRetry(
  async () => ({
    default: (await import("./components/ShowBigModal")).ShowBigModal,
  }),
  "showbig",
);
const PronunciationGuideModal = lazyWithRetry(
  async () => ({
    default: (await import("./components/PronunciationGuideModal")).PronunciationGuideModal,
  }),
  "pronunciation-guide",
);

function TabLoadingFallback() {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
      Loading view…
    </div>
  );
}

type ActiveTab = "learn" | "phrases" | "phrasebook" | "translate";

function resolveInitialTab(): ActiveTab {
  if (typeof window === "undefined") return "learn";
  const param = new URLSearchParams(window.location.search).get("tab");
  if (param === "learn" || param === "phrases" || param === "phrasebook" || param === "translate") {
    return param;
  }
  return "learn";
}

const NAV_TABS: { id: ActiveTab; label: string }[] = [
  { id: "learn", label: "Learn" },
  { id: "phrases", label: "Library" },
  { id: "phrasebook", label: "Saved" },
  { id: "translate", label: "Translate" },
];

interface DesktopNavTabProps {
  id: ActiveTab;
  label: string;
  count?: number | undefined;
  active: boolean;
  onSelect: (tab: ActiveTab) => void;
}

const NavTabIcon: FC<{ id: ActiveTab; active: boolean }> = ({ id, active }) => {
  switch (id) {
    case "learn":
      return <GraduationCap className="h-5 w-5" aria-hidden="true" />;
    case "phrases":
      return <BookOpen className="h-5 w-5" aria-hidden="true" />;
    case "phrasebook":
      return <Star className={`h-5 w-5 ${active ? "fill-[#0F766E]" : ""}`} aria-hidden="true" />;
    case "translate":
      return <GoogleTranslateIcon className="h-5 w-5" />;
  }
};

const DesktopNavTab: FC<DesktopNavTabProps> = ({ id, label, count, active, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  const ariaLabel = count !== undefined && count > 0 ? `${label} (${String(count)})` : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 transition-colors ${
        active
          ? "border-[#0F766E] text-[#0F766E]"
          : "border-transparent text-stone-500 hover:text-stone-900"
      }`}
    >
      <NavTabIcon id={id} active={active} />
      {count !== undefined && count > 0 ? (
        <span
          className={`text-xs font-medium tabular-nums ${
            active ? "text-[#0F766E]" : "text-stone-400"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
};

export default function App() {
  const [tab, setTab] = useState<ActiveTab>(resolveInitialTab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchElevated, setSearchElevated] = useState(false);
  const [translatePrefill, setTranslatePrefill] = useState<
    { query: string; nonce: number } | undefined
  >(undefined);
  const [showBigPayload, setShowBigPayload] = useState<ShowBigPayload | null>(null);
  const [toast, setToast] = useState<ToastItem | null>(null);

  const headerContentRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);
  const prefillNonceRef = useRef(0);
  const stateRef = useRef({
    tab,
    settingsOpen,
    guideOpen,
    searchOpen,
    hasShowBig: false,
  });

  useEffect(() => {
    stateRef.current = {
      tab,
      settingsOpen,
      guideOpen,
      searchOpen,
      hasShowBig: showBigPayload !== null,
    };
  }, [tab, settingsOpen, guideOpen, searchOpen, showBigPayload]);

  const showToast = useCallback((message: string, onUndo?: () => void) => {
    toastIdRef.current += 1;
    setToast({
      id: toastIdRef.current,
      message,
      ...(onUndo ? { onUndo } : {}),
    });
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let active = true;

    void initializeNativeShell(() => {
      if (stateRef.current.hasShowBig) {
        setShowBigPayload(null);
        return true;
      }
      if (stateRef.current.guideOpen) {
        setGuideOpen(false);
        return true;
      }
      if (stateRef.current.settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (stateRef.current.searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (stateRef.current.tab !== "learn") {
        setTab("learn");
        return true;
      }
      return false;
    }).then((unsub) => {
      if (active) {
        cleanup = unsub;
      } else {
        unsub();
      }
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  const {
    phrases,
    starredWords,
    starredWordIds,
    settings,
    stats,
    updateSettings,
    setRegion,
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
  } = useStudyDeck({ onStorageError: showToast });

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const selectLearnTab = useCallback(() => {
    setTab("learn");
  }, []);

  const selectPhrasesTab = useCallback(() => {
    setTab("phrases");
  }, []);

  const selectPhrasebookTab = useCallback(() => {
    setTab("phrasebook");
  }, []);

  const selectTranslateTab = useCallback(() => {
    setTab("translate");
  }, []);

  const openSearch = useCallback(() => {
    setSearchElevated(true);
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const handleSearchElevationEnd = useCallback(() => {
    setSearchElevated(false);
  }, []);

  const handleOpenInTranslate = useCallback((query: string) => {
    prefillNonceRef.current += 1;
    setTranslatePrefill({ query, nonce: prefillNonceRef.current });
    setTab("translate");
  }, []);

  const openGeneralSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const openPronunciationGuide = useCallback(() => {
    setGuideOpen(true);
  }, []);

  const closePronunciationGuide = useCallback(() => {
    setGuideOpen(false);
  }, []);

  const closeShowBig = useCallback(() => {
    setShowBigPayload(null);
  }, []);

  const handleChangePlaybackSpeed = useCallback(
    (playbackSpeed: number) => {
      updateSettings({ playbackSpeed });
    },
    [updateSettings],
  );

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827]">
      <header
        className={`pt-safe sticky top-0 border-b border-stone-200/80 bg-[#FAFAFA]/90 backdrop-blur-md ${
          searchElevated ? "z-[9999]" : "z-30"
        }`}
      >
        <div
          ref={headerContentRef}
          className="relative mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectLearnTab}
              className="shrink-0 whitespace-nowrap font-display text-lg font-bold tracking-tight text-stone-900"
            >
              Nói
            </button>

            <HeaderSearch
              headerContainerRef={headerContentRef}
              isOpen={searchOpen}
              isElevated={searchElevated}
              onOpen={openSearch}
              onClose={closeSearch}
              onElevationEnd={handleSearchElevationEnd}
              phrases={phrases}
              starredWordIds={starredWordIds}
              settings={settings}
              onTogglePhraseStar={togglePhraseStar}
              onToggleWordStar={toggleWordStar}
              onShowBig={setShowBigPayload}
              onOpenInTranslate={handleOpenInTranslate}
            />
          </div>

          <nav
            aria-label="Primary"
            className="hidden items-center gap-3 text-sm font-medium md:flex"
          >
            {NAV_TABS.map((item) => (
              <DesktopNavTab
                key={item.id}
                id={item.id}
                label={item.label}
                count={item.id === "phrasebook" ? stats.starredCount : undefined}
                active={tab === item.id}
                onSelect={setTab}
              />
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={openGeneralSettings}
              aria-label="Dialect and audio settings"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {searchOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close search overlay"
          onClick={closeSearch}
          className="fixed inset-0 z-[9990] bg-stone-950/15 backdrop-blur-[1px]"
        />
      ) : null}

      <main className="pb-safe-main mx-auto max-w-5xl px-4 pt-4 sm:px-6 md:pb-12 md:pt-6">
        <ErrorBoundary variant="inline" resetKey={tab}>
          {tab === "learn" ? (
            <LearnView
              phrases={phrases}
              settings={settings}
              onChangeRegion={setRegion}
              onChangePlaybackSpeed={handleChangePlaybackSpeed}
              onTogglePhraseStar={togglePhraseStar}
              onRecordPractice={recordPractice}
              onOpenPronunciationGuide={openPronunciationGuide}
              onNotify={showToast}
            />
          ) : null}

          {tab === "phrases" ? (
            <Suspense fallback={<TabLoadingFallback />}>
              <PhrasesView
                phrases={phrases}
                settings={settings}
                onChangeRegion={setRegion}
                onTogglePhraseStar={togglePhraseStar}
                onMovePhrase={movePhrase}
                onAddPhrase={addPhrase}
                onUpdateCustomPhrase={updateCustomPhrase}
                onDeleteCustomPhrase={deleteCustomPhrase}
                onRecordPractice={recordPractice}
                onRestorePhrasesSnapshot={restorePhrasesSnapshot}
                onShowBig={setShowBigPayload}
                onOpenPronunciationGuide={openPronunciationGuide}
                onNotify={showToast}
              />
            </Suspense>
          ) : null}

          {tab === "phrasebook" ? (
            <Suspense fallback={<TabLoadingFallback />}>
              <PhrasebookView
                phrases={phrases}
                starredWords={starredWords}
                settings={settings}
                onChangeRegion={setRegion}
                onTogglePhraseStar={togglePhraseStar}
                onToggleWordStar={toggleWordStar}
                onAddPhrase={addPhrase}
                onUpdateCustomPhrase={updateCustomPhrase}
                onDeleteCustomPhrase={deleteCustomPhrase}
                onRecordPractice={recordPractice}
                onRestorePhrasesSnapshot={restorePhrasesSnapshot}
                onShowBig={setShowBigPayload}
                onOpenPronunciationGuide={openPronunciationGuide}
                onNotify={showToast}
                onBrowsePhrases={selectPhrasesTab}
                onBrowseTranslate={selectTranslateTab}
              />
            </Suspense>
          ) : null}

          {tab === "translate" ? (
            <Suspense fallback={<TabLoadingFallback />}>
              <TranslateView
                phrases={phrases}
                starredWordIds={starredWordIds}
                settings={settings}
                prefillRequest={translatePrefill}
                onChangeRegion={setRegion}
                onSavePhrase={addPhrase}
                onTogglePhraseStar={togglePhraseStar}
                onToggleWordStar={toggleWordStar}
                onShowBig={setShowBigPayload}
                onOpenPronunciationGuide={openPronunciationGuide}
                onNotify={showToast}
              />
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </main>

      <nav
        aria-label="Mobile navigation"
        className="pb-safe fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md md:hidden"
      >
        <div className="grid min-h-15 grid-cols-4 items-center">
          <button
            type="button"
            onClick={selectLearnTab}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 ${
              tab === "learn" ? "text-[#0F766E]" : "text-stone-500"
            }`}
          >
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
            <span className="whitespace-nowrap text-[11px] font-medium tracking-tight">Learn</span>
          </button>

          <button
            type="button"
            onClick={selectPhrasesTab}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 ${
              tab === "phrases" ? "text-[#0F766E]" : "text-stone-500"
            }`}
          >
            <BookOpen className="h-5 w-5" aria-hidden="true" />
            <span className="whitespace-nowrap text-[11px] font-medium tracking-tight">
              Library
            </span>
          </button>

          <button
            type="button"
            onClick={selectPhrasebookTab}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 ${
              tab === "phrasebook" ? "text-[#0F766E]" : "text-stone-500"
            }`}
          >
            <Star
              className={`h-5 w-5 ${tab === "phrasebook" ? "fill-[#0F766E]" : ""}`}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap text-[11px] font-medium tracking-tight">Saved</span>
          </button>

          <button
            type="button"
            onClick={selectTranslateTab}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 ${
              tab === "translate" ? "text-[#0F766E]" : "text-stone-500"
            }`}
          >
            <GoogleTranslateIcon className="h-5 w-5" />
            <span className="whitespace-nowrap text-[11px] font-medium tracking-tight">
              Translate
            </span>
          </button>
        </div>
      </nav>

      {showBigPayload ? (
        <ErrorBoundary
          variant="inline"
          resetKey={`${showBigPayload.english}:${showBigPayload.south}`}
        >
          <Suspense fallback={null}>
            <ShowBigModal
              payload={showBigPayload}
              settings={settings}
              onChangeRegion={setRegion}
              onClose={closeShowBig}
              onNotify={showToast}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}

      <ToastBanner toast={toast} onDismiss={dismissToast} />

      <OfflineIndicator />
      <PWAUpdatePrompt />

      {guideOpen ? (
        <ErrorBoundary variant="inline" resetKey="pronunciation-guide-modal">
          <Suspense fallback={null}>
            <PronunciationGuideModal
              open={guideOpen}
              settings={settings}
              onChangeRegion={setRegion}
              onClose={closePronunciationGuide}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}

      {settingsOpen ? (
        <ErrorBoundary variant="inline" resetKey="settings-modal">
          <Suspense fallback={null}>
            <SettingsModal
              open={settingsOpen}
              phrases={phrases}
              settings={settings}
              onClose={closeSettings}
              onUpdateSettings={updateSettings}
              onResetPhrases={resetPhrases}
              onImportBackup={importBackup}
              onNotify={showToast}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </div>
  );
}
