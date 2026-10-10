<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E for the Force data refresh admin page

- **Plan**: context/changes/e2e-admin-cron-run/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-10-10
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

## Findings

### F1 — Cancel test can pass vacuously (race)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/cron-run.spec.ts:160-163
- **Detail**: After `toBeHidden()` the test immediately asserts `requests.length === 0` and `Tickery` count 0. Requests are recorded asynchronously in the `route` handler and results render only after three mocked round-trips, so a regression that runs on cancel could still be unrecorded at assertion time. The B4 break-check did turn the test red, but the barrier is not deterministic.
- **Fix**: Count requests with a synchronous `page.on('request')` listener (filtered on the cron-run URL) instead of in the route handler, and add a state barrier after cancel (trigger button enabled, no progressbar) before asserting.
  - Strength: Removes the dependence on route-handler timing without any time-based wait.
  - Tradeoff: Slightly more setup in the cancel test only.
  - Confidence: MED — the barrier narrows but cannot fully close a "request not sent yet" window.
  - Blind spot: Not verified how far apart `afterClosed` and DOM removal fire in practice.
- **Decision**: FIXED (Fix now)

### F2 — Negated assertion on a row that may not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/cron-run.spec.ts:122
- **Detail**: `expect(okRow).not.toContainText('Błąd')` also passes when the row is absent. It is safe today only because the failed row was asserted visible just before.
- **Fix**: Precede it with a positive assertion that the healthy row is visible and shows its OK status.
- **Decision**: FIXED (Fix now)

### F3 — Ticker names collide with the status label in row regexes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/admin/cron-run.spec.ts:90-91 (also 78, 105)
- **Detail**: Tickers `E2E-OK-PL` / `E2E-OK-OTHER` contain "OK", so `/E2E-OK-PL.*OK/` matches by coincidence of the name rather than only the status cell.
- **Fix**: Rename to tickers without "OK" (e.g. `E2E-GOOD-PL`, `E2E-GOOD-OTHER`) and assert the status via `row.getByRole('cell', { name: 'OK', exact: true })`.
- **Decision**: FIXED (Fix now)

### F4 — No safety net if the mock stops matching the real endpoint

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/cron-run.spec.ts:46-57
- **Detail**: The endpoint sends real emails. If its URL ever changes (version prefix, absolute API base) the narrow mock silently stops matching and a click on the confirm button would hit the real worker with the admin session.
- **Fix**: Register a broad guard `page.route('**/api/admin/**', r => r.abort())` before the narrow mock in the helper (Playwright picks the most recently registered matching route, so the narrow mock must come second).
  - Strength: Fails closed instead of running a real refresh.
  - Tradeoff: Aborts other admin calls too; none are made on this page today.
  - Confidence: HIGH — route precedence is documented.
  - Blind spot: Not checked whether other admin requests occur on page load.
- **Decision**: FIXED (Fix now)

### F5 — Request order (evaluate last) is not asserted

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/admin/cron-run.spec.ts:81-88
- **Detail**: The comment says fetch per market, then evaluate, but `arrayContaining` + length would pass for evaluate-before-fetch, which matters because evaluation guards against stale data.
- **Fix**: Assert `requests.at(-1)` is `{ phase: 'evaluate' }` and that the first two are the fetches.
- **Decision**: FIXED (Fix now)

### F6 — Risk #8 reference is a stretch; plan path nit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: e2e/admin/cron-run.spec.ts:1-3, e2e/prompts/cron-run.prompt.md:9-13
- **Detail**: test-plan.md Risk #8 is about delete-confirm dialogs and component coverage, not the cron-run page. The plan also lists `cron-run-confirm/` as a child of `cron-run/` (it is a sibling directory).
- **Fix**: State in the header that Risk #8 is applied by analogy (destructive-action confirm + truthful outcome rendering); leave the archived-to-be plan as is.
- **Decision**: FIXED (Fix now)

### F7 — Error list items not scoped to the Errors section

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/admin/cron-run.spec.ts:140-146
- **Detail**: `getByRole('listitem').filter({ hasText })` would also match the messages if they rendered anywhere else on the page, so it does not prove they sit under the Errors heading.
- **Fix**: Scope to the results card's list (e.g. `page.getByRole('list')` within the results region) or assert the count of list items equals 2.
- **Decision**: FIXED (Fix now)
