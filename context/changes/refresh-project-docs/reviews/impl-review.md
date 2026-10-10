<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Refresh Project Docs

- **Plan**: context/changes/refresh-project-docs/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-10-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

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

### F1 — E2E test count is wrong (38 vs 42)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:34, :111, :191
- **Detail**: Docs say "18 spec files, 38 tests". The file count is right (12 in e2e/, 6 in e2e/admin/), but `npx playwright test --list` reports 42 spec tests (44 including 2 setup tests); my count missed tests generated in loops in auth-gate-redirect and admin-gate-redirect.
- **Fix**: Replace "38 tests" with "42 tests" in the three places.
- **Decision**: FIXED — Fix now (38 -> 42 in test-plan.md)

### F2 — Mutation testing details lost in the README move

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/ci-and-repo-notes.md:36
- **Detail**: The removed README section said Stryker is manual, outside `npm run ci`, does not gate PRs, and writes reports to `reports/mutation/mutation.html`. The new bullet only points to stryker-notes.md.
- **Fix**: Extend the bullet with one sentence: not part of `npm run ci`, does not gate PRs, report at `reports/mutation/mutation.html`.
- **Decision**: FIXED — Fix now (mutation bullet extended)

### F3 — S-23 Done date differs from its archive folder date

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/roadmap.md (Done, S-23)
- **Detail**: The bullet says "Archived 2026-10-08" while the folder is `2026-10-09-admin-per-market-refresh` (folder date is the created date). 2026-10-08 matches `archived_at: 2026-10-08T23:29:56Z`, so it is correct but can look inconsistent.
- **Fix**: Leave as is (matches `archived_at`, the field the archive skill uses).
- **Decision**: SKIPPED

### F4 — `npm run ci` description inaccurate (pre-existing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: README.md (Deployment), context/foundation/ci-and-repo-notes.md:7
- **Detail**: Both say `npm run ci` is "typecheck && test:worker && build"; the script also chains `npm run test` (`ng test`), as README's own "Checks before pushing" notes. The text was carried over unchanged from before this change.
- **Fix**: Skip — pre-existing and outside the issue's scope; track separately if wanted.
- **Decision**: FIXED — Fix now (npm run ci description updated in README, ci-and-repo-notes.md and test-plan.md §5)

### F5 — Minor wording nits

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: roadmap.md (S-15), test-plan.md (ledger worker-test-gaps; "State (2026-10-11)" label), ci-and-repo-notes.md:3
- **Detail**: S-15 says "remove-user, remove-instrument and related pages" (the brief names remove-user, remove-instrument and the admin panel); the worker-test-gaps ledger line is vaguer than its plan-brief; the plan said "State (2026-10-10)"; ci-and-repo-notes.md points to README "Running locally" for commands that sit in its "Checks before pushing" subsection.
- **Fix**: Skip — none is false; fix only if touching the files again.
- **Decision**: FIXED — Fix now (S-15 wording, worker-test-gaps ledger detail, Checks-before-pushing pointer; State label date kept because it is the date the paragraph was written)
