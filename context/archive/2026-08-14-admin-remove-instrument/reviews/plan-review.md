<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin can remove an instrument from the registry

- **Plan**: context/changes/admin-remove-instrument/plan.md
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: SOUND (after fixes; REVISE prior to fixes)
- **Findings**: 0 critical, 2 warnings, 0 observations — both fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F2, fixed) |
| Plan Completeness | WARNING (F1, fixed) |

## Grounding

9/9 paths ✓, 6/6 symbols ✓, brief↔plan ✓

Paths checked: `src/worker/routes/admin.ts`, `src/worker/routes/alerts.ts`, `src/worker/routes/trigger-events.ts`, `src/app/features/admin/admin-panel.ts`, `src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts`, `src/app/features/instruments/instruments.service.ts`, `src/app/features/instrument-history/instrument-history.service.ts`, `src/app/core/shell/shell.html`, `test/worker/admin.test.ts`.
Symbols checked: `adminMiddleware`, `ALERT_SELECT`, `InstrumentsService.reload()`, `registerAndLogIn`/`logInAsAdmin`, `CREATABLE_INSTRUMENT_TYPES`, `adminGuard`.

Codebase verification sub-agent additionally confirmed: D1 `batch()` ordering/atomicity assumption is consistent with existing repo usage and documented D1 semantics; Hono's `c.req.param()` already correctly round-trips `^`-prefixed tickers (`instruments.ts:41-42`, proven by passing tests in `instruments.test.ts`); no route/method conflicts in `admin.ts`; a 5-statement batch is small relative to existing precedent (`scheduled.ts`/`admin.ts` batches already scale to 30–730 statements).

## Findings

### F1 — Phase 3 could not pass `npm run build` standalone — i18n ids split across Phases 2–4

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; worth pausing to reason through
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Phase 3, Phase 4
- **Detail**: Phase 3 declared `npm run build` as an automated criterion, but new `@@id`s introduced in Phases 2/3 were only added to `messages.pl.xlf` in Phase 4. Angular's production config sets `i18nMissingTranslation: "error"`, so `npm run build` would actually fail if Phase 3 were verified in isolation — breaking the assumption that each phase ends with a passing automated check before the manual-verification pause. The sibling plan (`admin-add-instrument`) avoided this by adding translation entries in the same phase that introduced the ids.
- **Fix A ⭐ Recommended**: Move i18n entries into the phase that introduces each id (dialog ids → Phase 2, page ids → Phase 3; Phase 4 keeps only the nav-link id).
  - Strength: Restores per-phase independence; matches the precedent already proven in `admin-add-instrument`.
  - Tradeoff: Requires splitting the "Translation catalog" step across three phases instead of one.
  - Confidence: HIGH — identical problem and identical fix already applied in the sibling plan.
  - Blind spot: None significant.
- **Fix B**: Drop `npm run build` from Phase 3's criteria, keep it only in Phase 4.
  - Strength: Minimal edit, no content reshuffling.
  - Tradeoff: Phase 3 alone no longer confirms new strings render correctly.
  - Confidence: MEDIUM — works, but weakens the per-phase verification guarantee.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A applied — i18n entries moved into Phase 2 (dialog ids) and Phase 3 (page ids); Phase 4 now only adds `shell.nav.adminRemoveInstrument`)

### F2 — Cron can resurrect price_history/market_data rows deleted by a concurrent admin cascade-delete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (DELETE endpoint) / "What We're NOT Doing"
- **Detail**: `src/worker/scheduled.ts:39` snapshots the full instrument list once at the start of the cron run, then `scheduled.ts:46-82` writes `price_history`/`market_data` per ticker without re-checking existence. If an admin's `DELETE /instruments/:ticker` completes while a cron run is already mid-flight for that same ticker, the cron's already-fetched loop iteration can write fresh rows for that ticker after the delete — silently resurrecting data the cascade-delete was meant to remove. No crash (no FK constraints); narrow and self-limiting (next day's cron no longer includes the deleted ticker, since it's excluded from the snapshot).
- **Fix**: Document the race as an accepted risk in "What We're NOT Doing" and the brief's "Open Risks & Assumptions", alongside the already-documented impact-preview→delete race.
- **Decision**: FIXED (risk note added to plan.md's "What We're NOT Doing" and plan-brief.md's "Open Risks & Assumptions")
