# ADR 001: Deep Domain Modules for Study Scheduling, Offline Translation, and Speech Audio

**Status:** Accepted  
**Date:** 2026-11-12  
**Scope:** `src/services/storageService.ts`, `src/hooks/useStudyDeck.ts`, `src/services/translationService.ts`, `src/services/vietnameseNumbers.ts`, `src/services/audioService.ts`, and consuming views.

## Context

The initial implementation of Nói delivered clean UI components, but domain orchestration leaked into React views:
- `App.tsx` manually maintained `localStorage` effects, `sortPhrasesForStudy`, and `sortOrder` normalization.
- `TranslateView.tsx` duplicated dictionary variant projection and filtering, while `translationService.ts` silently dropped unknown words during compositional translation and could not parse or format Vietnamese prices/numbers.
- `SettingsModal.tsx` accessed `window.speechSynthesis` directly for `voiceschanged`, and `audioService.ts` left utterance safety timers uncleaned on early finish/stop.

## Decisions

### Q1 — Study Queue, Spaced Review & Persistence Boundary
- **Selected:** **Autonomous Domain Runtime (`storageService.ts` + `useStudyDeck.ts`)** combining pure domain state transitions with a thin React hook adapter.
- **Invariants:**
  - `sortPhrasesForStudy` preserves descending priority (`3 > 2 > 1`), then due/earliest `nextReviewAt`, then `sortOrder`.
  - All `Phrase.review` metadata is optional and additive so pre-existing `localStorage` payloads migrate seamlessly without data loss.
- **Falsifier:** If multi-device sync or remote conflict resolution (CRDT/server timestamps) is introduced, pure `localStorage` persistence in `storageService.ts` would need to be swapped for an async repository adapter behind `useStudyDeck`.

### Q2 — Offline Translation & Number/Currency Engine
- **Selected:** **Hybrid Pipeline + Deterministic Numeric Grammar (`translationService.ts` + `vietnameseNumbers.ts`)**.
- **Invariants:**
  - Single source of truth for regional dictionary projection (`getDictionaryEntryText`) and vocabulary filtering (`filterDictionaryEntries`).
  - Numeric/currency expressions (`50k`, `35000`, `hai chục ngàn`, `một trăm rưỡi`) resolve deterministically before word-by-word fallback.
  - Unrecognized tokens during compositional translation are explicitly surfaced in `TranslationResult.unmatchedTokens` rather than silently omitted.
- **Falsifier:** If full syntactic clause reordering (English SVO to complex Vietnamese aspect/classifier structures) is required offline, a rule/phrase-template engine or on-device neural model would be needed beyond dictionary chunking + numeric grammar.

### Q3 — Reactive Speech & Voice Discovery Facade
- **Selected:** **Encapsulated Audio Runtime (`audioService.ts`)**.
- **Invariants:**
  - No React component accesses `window.speechSynthesis` directly.
  - Voice discovery (`subscribeVoices`) and utterance fallback timer cleanup live strictly inside `OfflineAudioService`.
- **Falsifier:** If pre-recorded regional MP3/Opus audio assets are bundled for offline playback alongside TTS fallback, `OfflineAudioService` must swap its internal playback driver while preserving its public `speak*` and `subscribe*` contracts.
