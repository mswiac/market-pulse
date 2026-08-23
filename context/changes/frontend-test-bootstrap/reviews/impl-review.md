<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Frontend Test Bootstrap

- **Plan**: context/changes/frontend-test-bootstrap/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-08-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Two Alert Form cascade tests assert only component state, not DOM

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/app/features/alerts/alert-form/alert-form.spec.ts (instrumentType→ticker and ticker→alertType tests)
- **Detail**: The Phase 2 plan's contract explicitly says assertions should go through the rendered DOM ("mat-error visibility and matInput values... consistent with @testing-library/angular's DOM-first philosophy"), and the Phase 3-authored test-plan.md §6.5 cookbook — which cites this exact file as its reference example — repeats the same rule ("Assert through the rendered DOM ... not the component instance's error state directly"). Two of the four tests (the instrumentType→ticker cascade and the ticker→alertType reset cascade) assert exclusively via `form.controls.X.value` reached through a protected-member cast, with no corresponding DOM check. The underlying component behavior is verified correct (cross-checked against alert-form.ts), so this isn't a false-positive risk today — but the tests don't match the pattern the codebase's own documentation says to follow, and a future contributor copying these two tests as an example would learn the wrong lesson.
- **Fix**: Add a DOM-level assertion to each of the two cascade tests alongside the existing form-control checks — e.g. `screen.findByText('CD Projekt')` for the rendered ticker mat-select's trigger text after the instrumentType→ticker cascade, and a check that the RSI option is no longer selectable/selected after the ticker→alertType reset.
  - Strength: Makes all four tests consistent with each other and with the §6.5 cookbook they're cited from; catches template-level regressions (e.g. mat-select stops reflecting the control value) that a component-state-only assertion would miss.
  - Tradeoff: Requires locating the correct Angular Material DOM query for a closed mat-select's displayed value — a little more fiddly than a plain `matInput` value check, though bounded in scope (2 tests only).
  - Confidence: MED — the fix direction is clear; the exact Material selector/query needs verifying against the rendered DOM once written.
  - Blind spot: Haven't run the fix to confirm the exact query resolves in jsdom on the first try.
- **Decision**: FIXED — DOM assertions added to both cascade tests (`screen.findByText('CD Projekt')` and `screen.getByText`/`queryByText('RSI')`); `ng test --watch=false` passes 7/7.

### F2 — InstrumentsService test stub uses plain functions instead of real Signals

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/alerts/alert-form/alert-form.spec.ts (InstrumentsService provider stub)
- **Detail**: `instruments`/`types` are stubbed as plain arrow functions rather than real `signal()`/`computed()` producers. Alert Form's `instrumentOptions` computed() only tracks `selectedInstrumentType` (a real signal) as a dependency, not the untracked stub — meaning if a future test tried to mutate the stub's returned instrument list mid-test and expected `instrumentOptions()` to reactively update, it silently wouldn't, unlike a real signal. This is a known, plan-acknowledged simplification (the plan's Key Discoveries explicitly scope these tests to the "warm cache" case), not a bug in what's shipped today — all four current tests only ever mutate real signals (selectedInstrumentType, ticker, alertType), never the instrument list itself.
- **Fix**: Add a short comment above the `InstrumentsService` stub in alert-form.spec.ts noting it's intentionally non-reactive (plain functions, not signals) and that tests relying on a changing instrument list mid-test would need a real `signal()` there instead.
- **Decision**: FIXED — comment added above the stub; `ng test --watch=false` passes 7/7.
