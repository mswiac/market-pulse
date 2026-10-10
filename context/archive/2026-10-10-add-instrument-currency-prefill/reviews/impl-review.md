<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add-instrument currency prefill

- **Plan**: context/changes/add-instrument-currency-prefill/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-10-10
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

## Findings

### F1 — Existing submit test no longer proves a manual currency is sent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/admin/add-instrument/add-instrument.spec.ts (test "submits non-default type, currency, suffix and RSI flag...")
- **Detail**: The test calls onTypeChange('pl_stock') and then onCurrencyChange('PLN'). pl_stock now prefills PLN itself, so the PLN assertion passes even if onCurrencyChange or the currency pass-through in submit broke.
- **Fix**: Pick a currency that differs from the prefill (onCurrencyChange('USD') after pl_stock) and expect 'USD' in the addInstrument call.
- **Decision**: FIXED (Fix now)

### F2 — E2E ticker is module-level and shared by both tests

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/admin/add-instrument.spec.ts:20
- **Detail**: `const ticker = uniqueTicker()` is evaluated once per worker and reused by both tests; sibling remove-instrument.spec.ts generates it per test in beforeEach. Not a defect (afterEach cleanup is idempotent, tests run serially per worker), but each test should own its data.
- **Fix**: Make `ticker` a `let` assigned from uniqueTicker() in a beforeEach.
- **Decision**: FIXED (Fix now)
