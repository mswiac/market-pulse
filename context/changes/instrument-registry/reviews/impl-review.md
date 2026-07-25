<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-03: Instrument Registry Implementation Plan

- **Plan**: context/changes/instrument-registry/plan.md
- **Scope**: Phase 1 of 2 (full plan)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — price_history migration remap has no fail-safe for unmapped legacy values

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: migrations/0008_instrument_registry.sql (price_history block)
- **Detail**: `market_data` and `alerts` remap via `CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END` with no `ELSE` — an unexpected legacy value would insert `NULL` into a `NOT NULL` column and abort the migration loudly. `price_history` instead uses two `UPDATE ... WHERE ticker = 'VIX'` / `WHERE ticker = 'NASDAQ100'` statements — an unexpected value would silently keep its old, non-registry value instead of failing. This is an asymmetry across three tables doing conceptually the same remap in the same migration. Not exploitable today (this codebase has only ever written `'VIX'`/`'NASDAQ100'` into these tables), but worth a decision.
- **Fix A ⭐ Recommended**: Leave as-is, document the asymmetry
  - Strength: No further schema risk introduced; the migration already shipped and was manually verified against seeded legacy rows.
  - Tradeoff: The inconsistency persists for any future migration author to rediscover.
  - Confidence: HIGH — no other code path in this repo has ever written a third value into `price_history.instrument`.
  - Blind spot: None significant.
- **Fix B**: Amend the migration to add a defensive check (e.g. an assertion query comparing row counts before/after the UPDATE pair) before committing further
  - Strength: Makes `price_history`'s failure mode symmetric with the other two tables.
  - Tradeoff: This migration is already applied to local D1 and committed — amending it now means re-testing the whole phase 1 verification pass again.
  - Confidence: MEDIUM — untested whether D1 supports the assertion pattern cleanly mid-migration-file.
  - Blind spot: Whether remote D1 has already had this migration applied (would make amending it unsafe).
- **Decision**: ACCEPTED (Fix A — leave as-is, asymmetry accepted; no code change)

### F2 — New scheduled.ts failure path has no test coverage

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/worker/scheduled.ts:29-38
- **Detail**: The try/catch around the new `SELECT ticker, rsi_eligible FROM instruments WHERE provider = 'yahoo'` query — added specifically during plan review (F3) to avoid an unhandled exception skipping the whole cron day — has no test exercising the failure branch. `test/worker/scheduled.test.ts` only covers per-instrument fetch failures, not a failure of the instruments-registry query itself.
- **Fix**: Add a test that makes `env.DB.prepare` for the instruments query throw (or drop/rename the table transiently) and asserts `handleScheduled` logs and returns without throwing, and that `price_history`/`market_data` are left untouched.
- **Decision**: FIXED — added `test/worker/scheduled.test.ts` case "logs and returns without writing anything when the instruments registry query fails" (drops the `instruments` table, spies on `console.error`, asserts no throw and empty `market_data`, restores the table in `finally`). 60/60 tests pass, typecheck clean.

### F3 — InstrumentRow interface duplicated identically in two files

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/alerts.ts:16-19, src/worker/scheduled.ts:8-11
- **Detail**: The same `{ ticker: string; rsi_eligible: number }` shape is defined independently in both files rather than shared. Not a defect — both files already had independent local types before this change — but a simplification opportunity now that the shape is used in two places.
- **Fix**: Extract to a shared type (e.g. in `src/worker/lib/market-data.ts` or a new `src/worker/lib/instruments.ts`) if a third consumer appears; not worth a shared module for two call sites today.
- **Decision**: FIXED — extracted to new `src/worker/lib/instruments.ts`, imported by both `alerts.ts` and `scheduled.ts`. 60/60 tests pass, typecheck clean.

### F4 — Two Phase 1 manual verification items remain unconfirmed

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/instrument-registry/plan.md — Progress 1.4, 1.5
- **Detail**: "Legacy-row rewrite verified by hand on scratch local D1" (1.4) and "DB no longer rejects RSI+VIX-equivalent insert at the CHECK layer" (1.5) remain `- [ ]`. This is not an oversight — the user explicitly declined to run them during implementation ("nie będę tego testować bo to wymaga stanu z przed zmian, lećmy dalej"), and the epilogue commit (`a98d463`) documents this decision explicitly. Flagging only because it's the one open item against the plan's own success criteria.
- **Fix**: No action needed unless the user wants to revisit — these were a deliberate, informed call, not a gap. `/10x-archive` will surface the same two rows as informational warnings.
- **Decision**: SKIPPED
