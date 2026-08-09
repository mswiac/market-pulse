<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-04: GPW Equity Support via Yahoo (.WA Suffix)

- **Plan**: context/changes/stooq-provider-support/plan.md
- **Scope**: Full plan (Phases 1-3)
- **Date**: 2026-08-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

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

### F1 — Currency auto-correction writes unvalidated external data

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/market-data.ts (`buildCurrencyCorrection`)
- **Detail**: `fetchedCurrency` (Yahoo's `meta.currency`, an unvalidated external string) is written straight into `instruments.currency` with no format check, on every cron tick and every admin backfill, unattended. The admin `/instruments` POST route enforces `CURRENCY_PATTERN = /^[A-Z]{3}$/` (`admin.ts:11`) for manually-set currency, but this auto-correction path bypasses that invariant entirely. A malformed/unexpected `meta.currency` value would silently overwrite a previously-valid code.
- **Fix A ⭐ Recommended**: Validate `fetchedCurrency` against `CURRENCY_PATTERN` inside `buildCurrencyCorrection` before treating it as a correction candidate; treat a non-matching value the same as `null` (no correction).
  - Strength: Keeps the "currency is always a clean 3-letter code" invariant intact everywhere, matching what the admin route already enforces. `CURRENCY_PATTERN` already exists and is trivially reusable.
  - Tradeoff: One more edge case to test; a genuinely malformed Yahoo response silently skips correction instead of surfacing it anywhere.
  - Confidence: HIGH — pattern already exists in the same file's neighbor module.
  - Blind spot: Haven't checked whether Yahoo ever actually returns lowercase or non-ISO codes in practice — this is defense-in-depth, not a reproduced bug.
- **Fix B**: Leave as-is, trusting Yahoo's `meta.currency` as authoritative.
  - Strength: Yahoo is a reputable, already-relied-upon source; unlikely to ever misfire in practice.
  - Tradeoff: No defense-in-depth if Yahoo's response shape changes unexpectedly; breaks the format guarantee enforced everywhere else in the app.
  - Confidence: MEDIUM — no evidence of a real-world failure mode, but also no test coverage against one.
  - Blind spot: No historical data on Yahoo's currency-field reliability.
- **Decision**: FIXED (Fix A) — `CURRENCY_PATTERN` validation added to `buildCurrencyCorrection` in `src/worker/lib/market-data.ts`; new test case added in `test/worker/market-data.test.ts`. Currency field in the add-instrument form kept as-is (removing it was considered and rejected — it would leave new instruments showing the wrong currency on alerts/UI until the first fetch).

### F2 — `InstrumentRow` type claims a `suffix` two call sites never select

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/lib/instruments.ts:1-6; src/worker/routes/instruments.ts:44-46; src/worker/routes/alerts.ts:22
- **Detail**: `InstrumentRow` was widened to add `suffix: string`, but `GET /:ticker/history` and `alerts.ts`'s `lookupTicker` still `SELECT` only `ticker, rsi_eligible, currency` while typing the result as `InstrumentRow`. TypeScript now claims `.suffix` is always present on those rows; at runtime it's `undefined`. Neither call site currently reads `.suffix`, so this is latent rather than active — and it extends a looseness that predates this diff (the same type was already broader than `scheduled.ts`'s original `SELECT` before this change).
- **Fix**: Add `suffix` to those two `SELECT` statements for type honesty (no behavior change, since neither site reads the field) — or, if preferred, split `InstrumentRow` into a narrower type for read-only consumers that never need `suffix`.
- **Decision**: FIXED — `suffix` added to both `SELECT` statements (`src/worker/routes/instruments.ts:44`, `src/worker/routes/alerts.ts:22`).

### F3 — Currency-correction log fires before the DB write is confirmed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/scheduled.ts (currency-correction block, before `await env.DB.batch(statements)`)
- **Detail**: The `console.log('market-data-pipeline: corrected currency...')` call fires before `env.DB.batch(statements)` is awaited. If the batch subsequently throws, it's caught by the outer catch (which logs a failure) — but the "corrected currency" success log has already been emitted, falsely claiming a write that may have been rolled back. `admin.ts`'s equivalent log correctly sits after a successful `await c.env.DB.batch(...)`, inside the try block.
- **Fix**: Move the `console.log` call in `scheduled.ts` to after `await env.DB.batch(statements)` succeeds, matching `admin.ts`'s existing order.
- **Decision**: FIXED — log moved after the `await env.DB.batch(statements)` call in `src/worker/scheduled.ts`.

### F4 — Pre-existing `pl_stock` rows (if any) will fail fetch until `suffix` is backfilled

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/worker/scheduled.ts:39 (dropped `WHERE provider = 'yahoo'` filter)
- **Detail**: Any `pl_stock` instrument row created under the old `deriveProvider` logic (`provider = 'stooq'`) before this branch deploys would now be fetched via Yahoo with `suffix = ''` (the migration's default) — sending the bare ticker instead of `TICKER.WA`, likely failing the fetch until an admin manually sets that row's `suffix`. Confirmed during planning research that zero such rows exist in D1 as of 2026-08-09 (only `^VIX`/`^NDX` are seeded), so this is speculative — but worth a one-time pre/post-deploy check on remote D1.
- **Fix**: Run `SELECT ticker FROM instruments WHERE type = 'pl_stock' AND suffix = ''` against remote D1 before/after deploy; backfill `suffix` manually for any hits.
- **Decision**: CHECKED (local) — `wrangler d1 execute marketpulse-db --local` confirms zero `pl_stock` rows with empty `suffix` on local D1 (2026-08-09). Same check should be re-run against `--remote` before/after deploy, since remote D1 could have diverged from local (e.g. a real admin addition).

### F5 — First `console.log` calls in the worker (previously `console.error`-only)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/scheduled.ts, src/worker/routes/admin.ts (currency-correction log lines)
- **Detail**: Every prior log call in the worker was `console.error`, reserved for failure paths. This diff intentionally introduces `console.log` for a non-failure event (a successful correction) — reasonable, just a new convention worth confirming as intentional for future consistency.
- **Decision**: ACCEPTED — confirmed intentional by user (`console.log` for success, `console.error` for failure).

### F6 — Plan Progress row 3.2 stays unchecked despite its content being written

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/stooq-provider-support/plan.md (Progress, Phase 3, item 3.2)
- **Detail**: Item 3.2 ("Dynamic-categories idea captured in the roadmap") is marked `- [ ]` with a note that the user chose not to confirm it manually — but the underlying roadmap content was in fact written in commit `e07a709` (a `## Parked` entry exists). This is an intentional, already-explained bookkeeping choice, not an implementation gap — flagging so it isn't mistaken for missing work when `/10x-archive` surfaces it.
- **Decision**: DISMISSED — confirmed by user as intentional; left as-is, informational note only.
