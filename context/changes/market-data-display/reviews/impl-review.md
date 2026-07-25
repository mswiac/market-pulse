<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04: Market Data Display Implementation Plan

- **Plan**: context/changes/market-data-display/plan.md
- **Scope**: Phase 2 of 2 (full plan)
- **Date**: 2026-07-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — POST/PUT duplicate validation logic in alerts.ts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/alerts.ts (POST ~78-111, PUT ~156-190)
- **Detail**: POST and PUT duplicate ~25 lines of identical validation (ticker lookup, alertType/threshold/email checks, VIX+RSI rule) verbatim. Pre-existing — this plan only changed the RETURNING/batch mechanics, not the validation flow — but worth noting since a future rule change could land in only one handler.
- **Fix**: Extract the shared block into a helper (e.g. `validateAlertInput`) called by both handlers. Out of scope for this change — a follow-up, not a defect introduced here.
- **Decision**: FIXED — extracted `validateAlertInput()` (returns a discriminated `{ ok: true, ... } | { ok: false, error }` result) in `src/worker/routes/alerts.ts`; both POST and PUT now call it instead of duplicating the 5-check block. Re-verified: 61/61 tests pass, typecheck clean.

### F2 — InstrumentsService cache has a harmless concurrent-load race

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/instruments/instruments.service.ts
- **Detail**: The `loaded` flag isn't set until the HTTP response's `tap()` fires, so two near-simultaneous `ensureLoaded()` calls (e.g. opening two dialogs back to back) can both miss the cache and issue duplicate `GET /api/instruments` requests. Harmless — same data both times, last-write-wins on the signal — just wasteful.
- **Fix**: Cache the in-flight Observable (e.g. `shareReplay(1)`) so concurrent callers await the same request instead of firing duplicates.
- **Decision**: FIXED — added an `inFlight` Observable cached via `shareReplay(1)` in `src/app/features/instruments/instruments.service.ts`; reset to `null` on error so a transient failure doesn't permanently block future retries. Re-verified: typecheck and build both clean.

## Verification Log

- `npm run test:worker` — 61/61 passed
- `npm run typecheck` — clean
- `npm run build` — clean
- Plan-drift sub-agent: all 11 planned file changes (Phase 1: alerts.ts, instruments.ts, alerts.test.ts, instruments.test.ts; Phase 2: alerts.service.ts, instruments.service.ts, alert-form.ts/.html, alert-list.ts/.html, delete-alert-confirm.ts/.html) verified MATCH. No DRIFT/MISSING/EXTRA beyond the already-explained `src/locale/messages.xlf`/`messages.pl.xlf` additions (required by the i18n build for 4 new translation ids; confirmed the ids match actual usages). "What We're NOT Doing" boundaries (no migration, no second instrument type, no history view, no frontend `?type=` param) confirmed respected.
- Safety/pattern sub-agent: all D1 queries parameterized via `.bind()`; session middleware applied on both routers; `env.DB.batch()` in POST/PUT correctly wrapped in the existing UNIQUE-constraint catch; the previously-fixed RxJS subscription-ordering bug in `alert-form.ts` re-verified correct, no other instance of that pattern found; `InstrumentsService` follows the same DI/signal conventions as `AlertsService`/`AuthService`.
- Manual verification: all Phase 1 (1.3, 1.4) and Phase 2 (2.3-2.8) manual checks confirmed via live interactive testing in this conversation (not rubber-stamped) — including one real bug found and fixed mid-testing (ticker combobox dropping selection on dialog reopen after cache warm-up).
