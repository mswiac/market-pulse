<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alerts List Filtering

- **Plan**: context/changes/alerts-list-filtering/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings (1 already fixed), 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Reviewed by two sub-agents (plan drift; safety/quality/patterns). Automated: `npm run test:ci` (135 passed), `npm run typecheck`, `npm run lint` (clean after F1), `npm run build`, and `npx playwright test e2e/alerts-filter.spec.ts` all pass. Manual rows 1.5–1.9 and 2.3 confirmed by the user.

## Findings

### F1 — Unused `settle` destructuring fails lint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.spec.ts:88
- **Detail**: `const { settle } = await renderList();` in "shows every alert…" never uses `settle`; `@typescript-eslint/no-unused-vars` errors, so CI lint would fail. Introduced while refactoring the helper (earlier finding about module-level `settle`).
- **Fix**: Use `await renderList();`.
- **Decision**: FIXED — `renderList` returns `settle`, helpers take it as a parameter, unused destructuring removed; lint clean

### F2 — Fixture instrument types differ from real values

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.spec.ts:9-12
- **Detail**: Fixtures use `'INDEX'`/`'STOCK'`; real values are `index`/`pl_stock`/`us_stock` (instrument-types.ts), as `alert-filter.spec.ts` already uses.
- **Fix**: Use `index` / `pl_stock` in the fixtures.
- **Decision**: FIXED — fixtures use `index` / `pl_stock`

### F3 — `getAllByRole(...)[0]` for the clear button

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.spec.ts:116
- **Detail**: Only one "Clear filters" button exists now (the empty state has none, per the plan addendum), so indexing `[0]` is unnecessary.
- **Fix**: Use `getByRole('button', { name: 'Clear filters' })`.
- **Decision**: FIXED — `getByRole('button', { name: 'Clear filters' })`

### F4 — Filters stay active but hidden state when alerts drop to zero

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/features/alerts/alert-list/alert-list.html:8
- **Detail**: Filters are kept when the last alert is deleted (bar hidden) and when a non-matching alert is created. The latter is the user's explicit choice during planning; the former is a rare edge case where the bar reappears with the filters still set.
- **Fix**: Accept; behavior matches the planning decision.
- **Decision**: ACCEPTED — matches the planning decision (filters stay)

### F5 — Catalogue load failure is silent in the list

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/features/alerts/alert-list/alert-list.ts:94
- **Detail**: `ensureLoaded().subscribe({ error: () => {} })` swallows the error with a comment explaining why. If the catalogue fails to load, the picker has no options and the user gets no hint. The alert-type filter and the list itself keep working.
- **Fix**: Accept (filtering by alert type still works); optionally add an error hint later.
- **Decision**: ACCEPTED — alert-type filter and list keep working; optional hint can be a separate change
