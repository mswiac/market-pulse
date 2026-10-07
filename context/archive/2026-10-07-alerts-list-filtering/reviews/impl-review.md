<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alerts List Filtering

- **Plan**: context/changes/alerts-list-filtering/plan.md
- **Scope**: Full plan (Phases 1–2 of 2), reviewed after commits 766446c, ba1ad94, 3a664df
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Reviewed by two sub-agents (plan drift; safety/quality/patterns). Automated: `npm run test:ci` (135 passed), `npm run typecheck`, `npm run lint`, `npm run build` clean; full Playwright suite passes after the e2e adaptations (new filter spec plus the three adapted specs). Manual rows 1.5–1.9 and 2.3 confirmed by the user.

Carried over from the previous review pass (already decided): unused `settle` lint error, fixture instrument types and `getAllByRole(...)[0]` were FIXED; "filters stay after adding a non-matching alert" and "silent catalogue load failure" were ACCEPTED.

## Findings

### F1 — Existing e2e specs adapted but not covered by the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: e2e/seed.spec.ts:39, e2e/delete-alert.spec.ts:39, e2e/auth-gate-redirect.spec.ts:77
- **Detail**: Three existing specs had to change (Instrument combobox scoped to the dialog because the filter bar adds a second one; the mid-session 401 test now triggers via in-app navigation to the triggered-alerts page because `AlertList` prefetches the instrument catalogue in its constructor). The plan did not anticipate this. Justified, but undocumented.
- **Fix**: Add a plan addendum describing the regression and the three adaptations.
- **Decision**: FIXED — addendum added to plan.md

### F2 — Unanchored threshold regex in `rowFor`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/alerts-filter.spec.ts:20
- **Detail**: `NASDAQ-100.*<label>.*<threshold>` has no anchor before the number, so `12.50` also matches `112.50`. Leftover `^NDX` alerts with similar values could produce multiple matches (strict-mode error) or a false `toBeHidden()`.
- **Fix**: Anchor the number, e.g. `(?<![\d.,])<threshold>`.
- **Decision**: FIXED — number anchored with `(?<![\d.,])`

### F3 — Random thresholds can collide on the UNIQUE constraint

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/alerts-filter.spec.ts:15-19
- **Detail**: RSI uses ~9800 possible values; a collision with an existing `^NDX` alert makes the POST fail and `waitForResponse(...ok)` time out without a clear cause. Same pattern as `delete-alert.spec.ts`, and the `afterEach` sweep cleans this run's alerts.
- **Fix**: Accept; consistent with the existing spec.
- **Decision**: ACCEPTED — consistent with delete-alert.spec.ts; the afterEach sweep cleans this run's alerts

### F4 — 401 test depends on the History nav starting collapsed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/auth-gate-redirect.spec.ts:77-80
- **Detail**: One click on "Historia" expands the menu only because `historyExpanded` starts collapsed on `/`. If the default changes, the click collapses it and the link disappears. The test still exercises the same risk (session-expired interceptor).
- **Fix**: Optionally assert `aria-expanded="false"` before the click.
- **Decision**: FIXED — asserts `aria-expanded="false"` before the click

### F5 — Empty error handler style

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.ts:94
- **Detail**: `error: () => {}` where other code uses `() => undefined` (cron-run.ts:48). Behavior (silent failure) was accepted earlier.
- **Fix**: Accept or switch to `() => undefined`.
- **Decision**: FIXED — `() => undefined`
