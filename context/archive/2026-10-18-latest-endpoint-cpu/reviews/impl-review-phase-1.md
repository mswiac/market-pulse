<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Reduce CPU time of GET /api/instruments/latest

- **Plan**: context/changes/latest-endpoint-cpu/plan.md
- **Scope**: Phase 1 of 2 (Phase 2 is a manual prod measurement, no code)
- **Date**: 2026-10-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- Plan drift: all four planned changes MATCH; nothing missing; only EXTRA is the untracked change folder itself. Edge cases checked against `buildHistory(...).at(-1)`: ordering/reversal, fewer than 15 closes, RSI-ineligible ticker, ticker without rows, empty table, last ticker flush.
- Automated: `npm run typecheck` clean, `npm run lint` clean, `npm run test:worker` 19 files / 448 tests passed (re-run during review).
- Manual: 1.4 and all of Phase 2 are pending and unchecked; nothing rubber-stamped.
- The stale-ticker case (last close older than the age floor) is covered at route level by the existing test in `test/worker/instruments.test.ts` ("shows no data for an instrument whose last close is older than the scan floor"), so no loader-level test is needed.

## Findings

### F1 — New tests do not exercise ticker separation or mixed eligibility

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/price-history.test.ts:219-230
- **Detail**: The "keeps tickers apart" test seeds a second ticker whose closes are the first series multiplied by 2, and asserts only `close`. RSI is scale-invariant, so leaking closes between tickers (e.g. not resetting `closesNewestFirst`) would not change either RSI and the test would still pass. Both tickers are also eligible, so a bug in resetting `eligible` when the ticker changes (an eligible ticker next to an ineligible one) is not exercised by any test; the new fold logic is exactly this state handling.
- **Fix**: Replace that test with two tickers that have different, non-proportional close series, one eligible and one not, and assert each ticker's `rsi` (eligible one equals its `latestRsi`, ineligible one is `null`). Seed them so the eligible ticker sorts both before and after the ineligible one, or add a third ticker, so both transition directions are covered.
- **Decision**: FIXED — test replaced with three tickers (eligible, ineligible, eligible) of non-proportional series asserting each RSI; verified by mutation (dropping the buffer reset or the eligibility reset now fails it)

### F2 — New comments are longer than the project norm

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/lib/price-history.ts:50-52, 95-100
- **Detail**: The two new comment blocks run 5-6 lines and partly restate what the code does ("rows come back as arrays and are folded as they stream by"). The project keeps only comments that explain a non-obvious WHY.
- **Fix**: Trim to the two non-obvious facts: the window SQL is shared so loaders cannot drift, and a ticker without rows is absent from the map while `rsi` stays null outside `rsiTickers`.
- **Decision**: FIXED — both comments trimmed to the non-obvious facts
