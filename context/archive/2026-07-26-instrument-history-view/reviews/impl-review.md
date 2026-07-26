<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Instrument History View (S-07) Implementation Plan

- **Plan**: context/changes/instrument-history-view/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — plan.md's Phase 3 shell contract describes a superseded design

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/instrument-history-view/plan.md:147
- **Detail**: The shipped `Shell` (confirmed correct and working via manual testing: `shell.ts`/`shell.html`) uses a single `mat-nav-list` with a direct "Alerts" link and a plain `<button>` + `historyExpanded` signal toggle that reveals a nested "Instruments" link. Plan.md's Phase 3 item 4 "Contract" paragraph still describes the second (superseded) revision — "a `mat-nav-list` of two `routerLink` items (`/` → Alerts, `/history` → History)" — with no toggle/expand behavior and no nested item. The code is correct; only the plan's prose was left stale after the final revision round (dropdown → toggleable sidenav → persistent shell → expansion-panel → single-list toggle-button).
- **Fix**: Update the Contract paragraph in plan.md's Phase 3 item 4 to describe the actual final design (single `mat-nav-list`, direct "Alerts" link, toggle `<button>` with `historyExpanded` signal + `aria-expanded`, initial state derived from `router.url`, conditionally-rendered nested "Instruments" link).
- **Decision**: FIXED

### F2 — no cancellation of in-flight history requests on rapid instrument switching

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/instrument-history/instrument-history.ts:83
- **Detail**: `onTickerChange` fires a new `getHistory(ticker)` HTTP call on every selection change but doesn't cancel or ignore stale in-flight requests. If a user switches instruments quickly (e.g. `^NDX` → `^VIX` → `^NDX` before the first response lands), responses can arrive out of order and the table can end up showing a different instrument's data than the one currently selected.
- **Fix**: Guard against stale responses — e.g. capture the requested ticker in a local variable and only apply the response (`this.rsiEligible.set(...)`, `this.history.set(...)`) if `this.selectedTicker() === requestedTicker` at the time the response arrives.
- **Decision**: FIXED

### F3 — `rsiEligible` has an inconsistent wire type across two endpoints on the same router

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/instruments.ts:23 vs :49
- **Detail**: `GET /api/instruments` returns `rsi_eligible AS rsiEligible` as a raw SQLite integer (`0`/`1`, matching the existing `Instrument.rsiEligible: number` frontend type), while the new `GET /:ticker/history` explicitly coerces the same underlying column to a real boolean (`!!instrument.rsi_eligible`, matching `InstrumentHistoryResponse.rsiEligible: boolean`). Same field name, same source column, different JSON type depending on which endpoint on the same router serves it — no current consumer breaks (both are used with truthy checks or their own typed interface), but it's a wire-contract inconsistency a future consumer could trip on.
- **Fix**: Either coerce `GET /api/instruments`'s `rsiEligible` to a boolean too for consistency, or leave as-is and add a one-line comment noting the deliberate difference (list endpoint mirrors the raw column; history endpoint normalizes it for a cleaner contract). No behavior currently depends on picking one over the other.
- **Decision**: FIXED (coerced GET /api/instruments to boolean; updated Instrument.rsiEligible type and the pre-existing instruments.test.ts assertions from 0/1 to false/true)

### F4 — History toggle button has `aria-expanded` but no `aria-controls`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/core/shell/shell.html:18-30
- **Detail**: The "History" disclosure button correctly sets `[attr.aria-expanded]="historyExpanded()"` but doesn't link to the revealed nested "Instruments" item via `aria-controls`/a matching `id` — the standard ARIA disclosure-widget pattern is half-implemented. Not a regression against existing convention (no other disclosure widget exists in this codebase to compare against).
- **Fix**: Add `id="history-nav-panel"` to the nested `<a>`'s wrapping element and `[attr.aria-controls]="'history-nav-panel'"` to the toggle button, if/when accessibility polish is prioritized.
- **Decision**: FIXED

### F5 — `historyError` isn't reset when a selected type has no instruments

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/instrument-history/instrument-history.ts:68-77
- **Detail**: `onTypeChange`'s no-match branch (`else { this.selectedTicker.set(''); this.history.set([]); }`) clears the ticker/history but doesn't reset `historyError`, so a stale error banner from a previous instrument's failed fetch could remain visible after switching to a type with zero instruments. Currently unreachable in practice — only one instrument type (`index`) exists today — but the seams for a second type already exist in the test suite (`gpw_company` in `instruments.test.ts`).
- **Fix**: Add `this.historyError.set(false);` to the no-match branch alongside the existing resets.
- **Decision**: FIXED
