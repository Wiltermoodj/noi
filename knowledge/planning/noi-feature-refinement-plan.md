# Nói — Feature Refinement & Deep-Module Architecture Plan

**Cycle:** 1 (Single-Cycle Autonomous Abstract Grilling)  
**Scope:** Core domain boundaries — Study Queue & Spaced Review (`storageService` / `useStudyDeck`), Offline Translation & VND Number Engine (`translationService` / `vietnameseNumbers`), and Speech Playback & Voice Discovery (`audioService`).

## 1. Domain Model & Identified Shallow Boundaries

An audit of the initial codebase identified three shallow or leaky boundaries:

1. **Study State & Scheduling Leakage (`App.tsx` ↔ `storageService.ts` ↔ `LearnView.tsx`)**:
   - `App.tsx` manually orchestrated `sortPhrasesForStudy`, `sortOrder` re-indexing, priority syncing during moves, and `localStorage` persistence effects.
   - `Phrase` lacked spaced-review scheduling metadata (`reviewCount`, `streak`, `lastReviewedAt`, `nextReviewAt`), limiting `LearnView` to static sequential card browsing without active recall or due-card prioritization.

2. **Fragmented Translation & Missing Numeric/Currency Domain (`translationService.ts` ↔ `TranslateView.tsx`)**:
   - `TranslateView.tsx` duplicated regional string projection (`entry.vi.split("•")[0]...`) instead of consuming a single linguistic projection contract.
   - Multi-word compositional translation silently dropped unrecognized tokens, risking misleading partial translations.
   - No deterministic parser/formatter existed for Vietnamese numbers and VND prices (e.g., `50k` ↔ `năm mươi nghìn` [North] / `năm chục ngàn` [Central/South]), despite bargaining and money being primary travel use cases.

3. **Leaky Speech Synthesis Lifecycle (`audioService.ts` ↔ `SettingsModal.tsx` / Views)**:
   - `SettingsModal.tsx` subscribed directly to `window.speechSynthesis` `voiceschanged` events instead of consuming reactive voice state from `audioService`.
   - Call sites repeatedly assembled speech option bags (`slowVietnamese`, `preferredViVoiceURI`, `preferredEnVoiceURI`), and utterance fallback timers were not cleared on cancellation.

## 2. Settled Paradigms & Contracts

| Node | Domain Boundary | Settled Paradigm | Narrow Public Contract |
| :--- | :--- | :--- | :--- |
| **Q1** | Study Queue, Spaced Review & Persistence | **Autonomous Domain Store (`useStudyDeck` + `storageService`)** | `useStudyDeck()` exposing `{ phrases, settings, studyStats, updateSettings, setRegion, updatePriority, recordReview, movePhrase, addPhrase, deleteCustomPhrase, resetPhrases }` plus pure deck operations (`recordPhraseReview`, `isPhraseDue`, `getStudyStats`) |
| **Q2** | Bidirectional Translation & VND Number Engine | **Pipeline + Deterministic Numeric Grammar (`translationService` + `vietnameseNumbers`)** | `translateOffline(query, direction, region, phrases)`, `getDictionaryEntryText(entry, region)`, `filterDictionaryEntries(query)`, `detectDirection(query)` returning enriched `TranslationResult` with `unmatchedTokens` and `numericInterpretation` |
| **Q3** | Speech Synthesis & Voice Discovery | **Reactive Audio Facade (`audioService`)** | `audioService.subscribeVoices(cb)`, `audioService.subscribe(cb)`, `audioService.speakPhrase(phrase, region, settings)`, `audioService.speakVietnamese(...)`, `audioService.speakEnglish(...)`, `audioService.stop()` |

## 3. Feature Refinements Unlocked

- **Active Recall & Spaced Review in `LearnView`**:
  - `Due` / `High Priority` / `All` study scopes driven by review intervals.
  - Optional **Recall Mode** (hides Vietnamese & phonetic guide until tapped, with keyboard shortcuts `Space`, `ArrowLeft`, `ArrowRight`, `L`).
  - Three-button review grading (`Again`, `Good`, `Mastered`) that updates streaks, intervals, and priority without breaking backward compatibility with existing `localStorage` phrase arrays.
- **VND Price & Number Translation + Honest Partial Composition in `TranslateView`**:
  - Bidirectional offline translation of prices and numbers (`50k`, `25000`, `hai chục ngàn`, `một trăm rưỡi`) projected across Northern (`nghìn`, `mươi`), Central, and Southern (`ngàn`, `chục`) speech.
  - Explicit reporting of `unmatchedTokens` when compositional lookup cannot translate every word.
  - One-tap **Save to Phrases** from `en-vi` translation results into the persistent study deck.
- **Encapsulated Voice Discovery**:
  - `SettingsModal` consumes `audioService.subscribeVoices` with zero direct `window.speechSynthesis` coupling.
