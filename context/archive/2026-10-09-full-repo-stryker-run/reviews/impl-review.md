<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Full-repo Stryker run and tests for surviving mutants

- **Plan**: context/changes/full-repo-stryker-run/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks (npm run test:worker 369 passed, npm run test:ci 192 passed, npm run lint clean) were run before the commit; production code under `src/` is unchanged (verified against `main`).

## Findings

### F1 — triage.md groups survivors instead of one row per survivor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/full-repo-stryker-run/triage.md (Survivor decisions)
- **Detail**: The plan asked for one row per survivor (location, mutation, decision, reason). The file groups them by area (for example about 30 `error:` strings in `routes/admin.ts`, log text), so criterion 1.3 holds at group level only.
- **Fix**: State in the triage intro that survivors are recorded per group and that the full per-mutant list is in the HTML report (`reports/mutation/mutation.html`, gitignored) and the saved run output.
- **Decision**: FIXED (Fix now)

### F2 — Artificial `not.toContain('Stryker')` assertion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/worker/scheduled.test.ts (test "lists tickers that failed for the same reason once")
- **Detail**: The assertion targets the mutator's placeholder string rather than describing behavior; the preceding regex already pins the `A, B: error` format.
- **Fix**: Remove the `not.toContain('Stryker')` line.
- **Decision**: FIXED (Fix now)

### F3 — Misleading test name

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.spec.ts (describe "AlertList details")
- **Detail**: The first test is named "...only for price alerts and the RSI only for RSI alerts" but only asserts the price case; the RSI case is the second test.
- **Fix**: Rename to "shows the day high and low and no RSI for a price alert".
- **Decision**: FIXED (Fix now)

### F4 — Wrong count in triage.md

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/full-repo-stryker-run/triage.md (row for `instrument-picker.ts`)
- **Detail**: The row says "Nine new specs"; the commit adds eight.
- **Fix**: Change to "Eight new specs".
- **Decision**: FIXED (Fix now)

### F5 — Empty "After new tests" cells

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/full-repo-stryker-run/triage.md (Worker scores table)
- **Detail**: Files not covered by the control run have an empty cell, and the "All files" row says "see per-file rows"; the reason is only in the paragraph below.
- **Fix**: Put "n/a" in the empty cells and "n/a (baseline only)" in the "All files" cell.
- **Decision**: FIXED (Fix now)
