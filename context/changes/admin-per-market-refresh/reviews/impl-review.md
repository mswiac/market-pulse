<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin Per-Market Refresh

- **Plan**: context/changes/admin-per-market-refresh/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-10-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Duplicate error strings break the keyed Errors list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/admin/cron-run/cron-run.html:82
- **Detail**: `@for (error of summary.errors; track error)` tracks by string. When several requests fail with the same message (e.g. both fetches and the evaluation return the generic error), the keys are duplicated, which triggers Angular's duplicate-key warning and can misrender the list.
- **Fix**: Track by `$index`.
- **Decision**: FIXED — Fix now (`track $index`)

### F2 — Stale subrequest-budget comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/lib/market-refresh.ts:40-45
- **Detail**: The comment says the cap leaves room for "the alert evaluation that shares its invocation" on the manual full run. Evaluation is now a separate request, so no run shares an invocation with it.
- **Fix**: Drop the manual-full-run clause and say that the cron and each admin fetch request get this budget on their own.
- **Decision**: FIXED — Fix now (comment rewritten)

### F3 — Docs still describe the removed handleScheduled()

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/admin-panel-notes.md:47, README.md:22
- **Detail**: Both describe the manual run as calling `handleScheduled()` "exactly like the Cloudflare Cron Trigger". That function is gone and the manual run is now three phase requests.
- **Fix**: Update the admin-panel-notes section and the README sentence to describe the fetch-per-market + evaluate flow.
- **Decision**: FIXED — Fix now (admin-panel-notes.md and README.md updated)

### F4 — Two sources of truth for instrument types

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/worker/lib/instruments.ts:7-19
- **Detail**: `ALL_INSTRUMENT_TYPES` and `MARKET_TYPES` are independent lists. A type added to the CHECK constraint and `ALL_INSTRUMENT_TYPES` but not to `MARKET_TYPES` would never be fetched by any cron trigger or admin market request.
- **Fix**: Derive `ALL_INSTRUMENT_TYPES` from `MARKET_TYPES` (`Object.values(MARKET_TYPES).flat()`).
  - Strength: One list to maintain; matches the "one shared place" goal of #170.
  - Tradeoff: Hides the CHECK-constraint mirror comment; ordering of the array changes.
  - Confidence: MED — only the default argument of `runFetchPhase` reads it.
  - Blind spot: Other readers of `ALL_INSTRUMENT_TYPES` were not checked.
- **Decision**: FIXED — Fix now (ALL_INSTRUMENT_TYPES derived from MARKET_TYPES)

### F5 — Full-market fetch degrades silently past ~40 instruments

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts:21, src/worker/lib/instruments.ts:39
- **Detail**: Scope `all` selects the whole catalogue of a market while `MAX_FETCH_ATTEMPTS_PER_RUN` stays 40. If one market grows past ~40 instruments or tickers retry, the rest fail with "fetch attempt budget exhausted" (reported per ticker, not lost silently). Related: after a failed fetch the evaluation always runs and the page shows "Alerts evaluated: N" even if the freshness check skipped some alerts (logged only).
- **Fix**: Accept and document: the budget error is visible per ticker, and the catalogue is ~40 per market today.
- **Decision**: SKIPPED — known limitation, ~40 instruments per market today; budget errors are reported per ticker
