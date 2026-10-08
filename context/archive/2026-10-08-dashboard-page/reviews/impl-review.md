<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dashboard Page

- **Plan**: context/changes/dashboard-page/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated re-run: `npm run test:worker` 290/290, `npm run test:ci` 147/147, `npm run lint` clean, `npm run build` OK; Playwright 19/19 at the end of Phase 3. All manual rows confirmed by the user.

## Findings

### F1 — Latest-close query scans the whole price_history table

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/instruments.ts:40-52
- **Detail**: The `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)` subquery has no WHERE/LIMIT inside, so every dashboard load reads all price_history rows (D1 `rows_read`), growing linearly with history (~250 rows/year/instrument). Response size is bounded; the read cost is not. Still one subrequest.
- **Fix A ⭐ Recommended**: Bound the scan with a date cutoff derived from the newest stored date, e.g. `WHERE date >= (SELECT date(MAX(date), '-100 days') FROM price_history)` inside the window subquery.
  - Strength: Keeps the single-query shape and the parity with the history endpoint (44 trading days fit in ~65 calendar days; 100 leaves slack for holidays).
  - Tradeoff: An instrument whose last close is older than the cutoff shows dashes instead of its stale close.
  - Confidence: MEDIUM — depends on how stale instruments should look; not measured with EXPLAIN.
  - Blind spot: Actual table size in production and D1 free-tier row-read budget not checked.
- **Fix B**: Leave as is and revisit when the table grows.
  - Strength: No code change; table is tiny today (about 20 instruments x a few hundred days).
  - Tradeoff: Cost grows silently with every cron run.
  - Confidence: MEDIUM — current volume is small.
  - Blind spot: Production row count.
- **Decision**: FIXED — user chose a tighter variant of Fix A: floor of 70 calendar days (44 trading days fit, RSI parity with history kept); test added for a stale instrument

### F2 — "No instruments in the system yet" flashes while the dashboard is loading

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/dashboard/dashboard.html:130-136, src/app/features/dashboard/dashboard.ts
- **Detail**: `rows()` is empty until the response arrives, so the empty-catalogue message shows during loading. No test covers the in-flight state.
- **Fix**: Track a `loaded` signal set in the `next` handler, show the empty message only when loaded, and add a unit test with an unresolved Subject.
- **Decision**: FIXED — `loaded` signal; empty-catalogue message only after the response; loading-state unit test added

### F3 — Sort state is not exposed to assistive technology

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/dashboard/dashboard.html (all six sortable `<th>`)
- **Detail**: Header sort buttons have no `aria-sort` on the `<th>`, and the direction arrow is an aria-hidden icon. The alert list has the same gap, so this is not a regression, but a real table makes it more visible.
- **Fix**: Add `[attr.aria-sort]` on each `<th>` (`ascending` / `descending` / `none`).
- **Decision**: FIXED — `aria-sort` on all six sortable headers via `ariaSort()`; unit test added

### F4 — Menu link locator in the e2e test is a substring match

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/dashboard.spec.ts:31
- **Detail**: `getByRole('link', { name: 'Alerty' })` matches case-insensitive substrings, so it would also match "Uruchomione alerty" if the History group were expanded.
- **Fix**: Use `{ name: 'Alerty', exact: true }`.
- **Decision**: FIXED — `exact: true` on the Alerty link locator

### F5 — Duplicated sortable-header markup and comparator

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/dashboard/dashboard.html, src/app/features/dashboard/dashboard.ts:40-52
- **Detail**: Six near-identical header cells and three identical close/high/low cells; the comparator mirrors alert-list.ts. Maintenance cost only.
- **Fix**: Optional — drive the columns from a config loop; leave the comparator as is unless a third list needs it.
- **Decision**: FIXED — header markup via a shared `sortHeader` template and a loop over the close/high/low columns; labels moved to `$localize` with the same i18n ids; comparator left as is

### F6 — Redundant route-order comment

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/instruments.ts:33-34
- **Detail**: The comment states that `/latest` never collides with `/:ticker/history`; project convention is comments only for non-obvious WHY.
- **Fix**: Remove the comment.
- **Decision**: FIXED — comment removed (done while rewriting the F1 fragment); user confirmed keeping it removed

### F7 — Brittle sort assertion in the component test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/app/features/dashboard/dashboard.spec.ts (sort test)
- **Detail**: The order is asserted via `textContent.slice(0, 3)` of each row, which depends on cell text layout.
- **Fix**: Assert on the `.instrument-name` text of each row.
- **Decision**: FIXED — sort test asserts on `.instrument-name` text

## Notes

- `src/locale/messages.xlf` (source catalogue) was not updated. This is pre-existing (last touched in #63) and in line with the project rule that only `messages.pl.xlf` is hand-edited; not reported as a finding.
- Two changes outside the plan list (`e2e/auth.setup.ts`, `e2e/prompts/admin-gate-redirect.prompt.md`) are necessary follow-ons of the landing-page change and were kept.
