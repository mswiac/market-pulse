<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Post-release hardening

- **Plan**: context/changes/post-release-hardening/plan.md
- **Scope**: Full plan (Phase 1 and 2 of 2)
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warnings, 1 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run: `npm run test:worker` 442 passed, typecheck clean, lint clean. No file under `src/` changed. Stryker figures in test-plan.md (458 mutants, 433 killed, 25 survived, 94.54%) match the report. Benign drift: the plan listed `price-history.test.ts`, `instruments.test.ts` and `market-data.test.ts` as candidates ("whichever covers each mutated file"); only `scheduled.test.ts` and `alert-evaluation.test.ts` needed changes.

## Findings

### F1 — Empty-window test name overclaims

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/scheduled.test.ts:486
- **Detail**: The test is named "treats an empty Yahoo window as ok and leaves the stored row alone", but the top-level `beforeEach` clears `price_history` and `market_data`, so there is no stored row and the before/after `COUNT(*)` comparison only proves that nothing was inserted. It also ignores `market_data`, which the production code writes. The targeted mutant is still killed (status becomes `error`).
- **Fix**: Rename to "treats an empty Yahoo window as ok and writes nothing" and assert `COUNT(*) = 0` on both `price_history` and `market_data` after the run.
- **Decision**: FIXED (renamed, asserts zero rows in price_history and market_data)

### F2 — Redundant `last error: undefined` assertion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/worker/scheduled.test.ts:883
- **Detail**: The flipped `lastError === undefined` mutant is already killed by the existing exact-equality and `includes('last error:')` assertions in the same test. The new assertion only gives a clearer failure message. Harmless.
- **Fix**: Keep as is.
- **Decision**: SKIPPED
