<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Close the Remaining Divergent RSI Paths

- **Plan**: context/changes/rsi-review-fixes/plan.md
- **Scope**: Phases 1-2 of 2
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: `npm run test:worker` 428/428, typecheck and lint clean. Manual 1.6 and 2.6 confirmed by the user; 2.7 (remote migration) pending.

## Findings

### F1 — Prettier reflowed unrelated code

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: test/worker/scheduled.test.ts (+353/-112), test/worker/instruments.test.ts, test/worker/price-history.test.ts, src/worker/lib/market-refresh.ts, src/worker/routes/instruments.ts
- **Detail**: `prettier --write` was run on files whose existing code was not prettier-clean (printWidth 100), so about 300 unrelated lines were rewrapped. Only three tests in scheduled.test.ts changed in substance. Behavior is unchanged, but the diff is hard to review and blames noisily.
- **Fix**: Restore the unrelated hunks so the PR's net diff contains only the intended changes (new commit on top).
  - Strength: Clean, reviewable diff; no behavior risk.
  - Tradeoff: One more commit; history keeps the churn unless the PR is squash-merged (past PRs were).
  - Confidence: HIGH — the original file fails `prettier --check`, confirming the churn is mine.
  - Blind spot: None significant.
- **Decision**: SKIPPED — user chose to keep the formatting as is

### F2 — Alert create/edit skips its refresh when the history read fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/market-refresh.ts:134-156, caller src/worker/routes/alerts.ts:~147
- **Detail**: `fullWindow` now loads D1 history first. If that read fails, RSI tickers are reported as errors and not fetched, so `ensureFreshMarketData` (which ignores the result) leaves the stale `market_data` row, and for a ticker with no row the initial armed state defaults to armed=1. Previously fullWindow fetched regardless. Needs a D1 read failure while writes would succeed, so rare. Alert creation itself never fails. Not covered by a test.
- **Fix A ⭐ Recommended**: Accept and document in the plan (Critical Implementation Details / risks).
  - Strength: Consistent with the chosen "no RSI write on failed read" rule; no extra code.
  - Tradeoff: Rare edge keeps the old stale-data fallback.
  - Confidence: HIGH — failure needs D1 read errors, and the alert path already tolerates a failed refresh.
  - Blind spot: Not measured how often D1 reads fail in production.
- **Fix B**: On a failed read in the fullWindow path, still fetch and write price without RSI.
  - Strength: Fresh price for the armed state.
  - Tradeoff: Reintroduces a partial write the plan explicitly excluded.
  - Confidence: MEDIUM — needs a new upsert variant.
  - Blind spot: RSI alerts would compare a fresh price against a stale RSI.
- **Decision**: FIXED via Fix A — documented as a known limitation in plan.md (Critical Implementation Details)

### F3 — No /history vs /latest parity test near the age floor

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: test/worker/instruments.test.ts
- **Detail**: Plan Phase 2 (3c) listed a parity test for sparse data near the floor. Only the empty-history-past-floor test was added; the existing parity test uses 200 dense rows. Both routes share one loader now, so the risk is low.
- **Fix**: Add one test: a ticker whose rows end near the floor returns the same newest RSI from both endpoints.
- **Decision**: FIXED — parity test "matches the history endpoint when the age floor cuts into the ticker series" added

### F4 — Loader error text is copied into per-ticker results

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/market-refresh.ts:140,152
- **Detail**: `String(err)` appears in the failure email and the admin 207 body. Admin-only, and the existing batch-failure path does the same; D1 errors carry no secrets.
- **Fix**: None needed (optionally a fixed string, detail only in console.error).
- **Decision**: SKIPPED — no action needed

### F5 — Index value is mostly future-proofing

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: migrations/0017_price_history_date_index.sql
- **Detail**: Verified with SQLite: `MAX(date)` goes from a covering-index scan to O(log n); the main window query still uses the ticker-leading index, so nothing gets worse. Every price upsert now maintains one more index (more rows written on D1), and the saving at this table size is small.
- **Fix**: None; migration is safe and idempotent.
- **Decision**: SKIPPED — no action needed

### F6 — Test coupling and gap

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: test/worker/scheduled.test.ts (loader failure test)
- **Detail**: The failure is simulated by a synchronous throw from `prepare` matched on `sql.includes('ROW_NUMBER')`, coupled to the query text. No test covers fullWindow combined with a failed read (F2).
- **Fix**: None now.
- **Decision**: SKIPPED — no action needed
