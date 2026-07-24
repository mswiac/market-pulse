<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Market Data Pipeline (F-02) Implementation Plan

- **Plan**: `context/changes/market-data-pipeline/plan.md`
- **Scope**: Phase 4 of 4 (full plan)
- **Date**: 2026-07-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Grounding

Automated checks re-verified fresh during this review: `npm run test:worker` (7/7 files, 44/44 tests), `npm run typecheck` (clean), `npm run migrate:local` (idempotent — "No migrations to apply!"). Manual Progress items 4.4/4.5 both have real observable evidence in the conversation (live Yahoo data in local D1; production deploy log + remote migration log with correct `schedule: 0 23 * * 1-5`) — not rubber-stamped.

Plan-drift sub-agent verified all 4 phases' file-level contracts (migrations, `market-data.ts`, `rsi.ts`, `scheduled.ts` + `index.ts` wiring) against the plan — all MATCH, including the two riskiest details (typed-error-on-every-branch in `market-data.ts`, and single `env.DB.batch()` per instrument with per-iteration try/catch isolation in `scheduled.ts`).

Safety/pattern sub-agent confirmed clean: no SQL injection (parameterized `.bind()` throughout), no SSRF (Yahoo symbol param is always a fixed internal constant), `scheduled` unreachable over HTTP, migrations are pure `CREATE TABLE`/`CREATE INDEX` with no destructive ops, CHECK constraint on `market_data.rsi` is enforced in code (not just schema) and covered by a test, retry logic genuinely re-throws (no silent swallow), no hardcoded secrets.

Also verified during this review (not a finding — closed clean): the plan's own open question about scheduled-Worker wall-clock duration limits. Confirmed via Cloudflare docs: 15-minute wall-clock ceiling uniform across all plans, far above this handler's worst-case retry timing.

## Findings

### F1 — Yahoo close-array ordering trusted without validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/market-data.ts:69-74
- **Detail**: `fetchDailyCloses()` builds `DailyClose[]` straight from Yahoo's `timestamp[]`/`close[]` arrays with no sort and no monotonicity check — it trusts the unofficial API returns ascending order. `rsi.ts`'s Wilder smoothing and `scheduled.ts`'s "latest price" (`closes[closes.length-1]`) both depend on that assumption silently. No test exercises an out-of-order response. If Yahoo ever reorders, RSI and the displayed price would be silently wrong — no error, no log — and this data is what S-05 will later evaluate alert thresholds against.
- **Fix A ⭐ Recommended**: Throw `MarketDataFetchError` on non-ascending timestamps
  - Strength: Reuses the exact validation pattern already in this function for every other malformed-response case — fails loud into the existing retry-and-skip path instead of silently corrupting downstream data.
  - Tradeoff: A benign one-off reordering from Yahoo (if that ever happens without being a real problem) would cause a skipped day instead of being tolerated.
  - Confidence: MED — haven't observed Yahoo actually reorder in practice; this is defense against an assumption, not an observed failure mode.
  - Blind spot: No historical data on how often/whether Yahoo's chart API has ever reordered results.
- **Fix B**: Defensively sort by timestamp before building `DailyClose[]`
  - Strength: Self-heals regardless of Yahoo's actual ordering; never fails a cron run over this.
  - Tradeoff: Masks a real API contract violation if one ever occurs — the pipeline would look healthy while quietly compensating for an upstream change nobody would notice.
  - Confidence: HIGH — sorting is straightforward and correct.
  - Blind spot: None significant.
- **Decision**: FIXED — applied Fix A. Added a monotonicity check in `fetchDailyCloses` that throws `MarketDataFetchError` on non-ascending timestamps, plus a covering test.

### F2 — scheduled.test.ts's invocation pattern contradicts the plan's own text

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/worker/scheduled.test.ts:1,4,26 vs plan.md:15,226,246
- **Detail**: The plan states three times (Current State Analysis, Phase 4 Success Criteria, Testing Strategy) that `scheduled()` would be tested via `exports.default.scheduled(...)` — the same RPC pattern every other test file uses. During Phase 4 implementation that pattern threw `DataCloneError: Could not serialize object of type "ScheduledController"` (not structured-cloneable across the `exports` RPC boundary), so the fix switched to importing the worker module directly and calling `worker.scheduled(...)`. The code fix was correct and necessary, but the plan text was never updated to match, and the test file has no comment explaining the deviation — a future reader (or a healer agent) could reasonably "fix" it back to the broken RPC pattern.
- **Fix**: Update plan.md's three references to `exports.default.scheduled(...)` to describe the direct-import pattern instead, and add a one-line code comment in `scheduled.test.ts` explaining that `ScheduledController` isn't serializable across the `exports` RPC boundary, so this file imports the worker module directly.
- **Decision**: FIXED — plan.md's 3 references corrected; explanatory comment added to `scheduled.test.ts`.
