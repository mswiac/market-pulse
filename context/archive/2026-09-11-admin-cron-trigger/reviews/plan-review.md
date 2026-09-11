<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin Endpoint and Panel UI to Manually Trigger the Daily Cron Pipeline

- **Plan**: context/changes/admin-cron-trigger/plan.md
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

Grounding: 10/10 paths ✓ (scheduled.ts, alert-evaluation.ts, index.ts, admin.ts, admin-panel.service.ts, remove-instrument-confirm.ts, app.routes.ts, shell.html, messages.pl.xlf, instruments.service.ts), symbols ✓ (`i18nMissingTranslation: "error"` confirmed at angular.json:84, `defaultConfiguration: "production"` at angular.json:98, `adminGuard` confirmed, Yahoo/Resend hosts confirmed), brief↔plan ✓. Blast-radius sweep: `evaluateAlerts`/`handleScheduled` have no callers beyond `scheduled.ts`/`index.ts` and their test files; no naming collision for `triggerCronRun`/`CronRunSummary`/`CronRunTickerResult`/`CronRunEmailResult` anywhere in `src/app/`; `admin-panel.service.spec.ts` tests methods individually (no reflection/snapshot), so a new method needs no changes to existing tests; `package.json`'s `ci` script runs `npm run build` unmodified — the i18n gate is not suppressed during CI.

## Findings

### F1 — Results panel treated as a brand-new UI pattern; an in-repo precedent exists

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3, Change 3 (Trigger page component) — Contract
- **Detail**: The plan states "this will be the app's first structured-results panel" and describes the tickers/emails sections only in prose ("render... a tickers section... styled with warn color..."), without naming a concrete Angular rendering mechanism. `src/app/features/trigger-history/trigger-history.ts:6,37` and `trigger-history.html:10,90-91` already render a list of structured rows with `MatTableModule` + `[dataSource]="events()"` + `*matHeaderRowDef`/`*matRowDef` + a `displayedColumns` array. `src/app/features/admin/` itself has no table precedent, but `trigger-history` is the closest existing model in the codebase and the plan doesn't reference it, risking an ad-hoc rendering approach where a working pattern already exists.
- **Fix**: In Phase 3, Change 3's Contract, specify that the tickers and emails sections each use `MatTableModule` with a `[dataSource]` bound to the corresponding array from `result()` and a `displayedColumns` list, mirroring `trigger-history.ts`/`.html`'s exact structure (add `MatTableModule` to the component's `imports`). The `errors: string[]` section stays a plain list — it has no per-row columns to define, unlike the other two.
- **Decision**: FIXED

### F2 — New route not added to the existing admin-gate E2E test's route list

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, Change 4 (Route and navigation) — not currently covered by any Change entry
- **Detail**: `e2e/admin-gate-redirect.spec.ts:22-27` hardcodes `const ADMIN_ROUTES = ['/admin', '/admin/add-instrument', '/admin/remove-instrument', '/admin/remove-user']` and loops over it to assert every admin route redirects a non-admin to `/`. This is an existing, already-passing Playwright test whose entire purpose is exhaustive admin-route-authorization coverage. The plan adds a fifth admin route (`/admin/cron-run`) but never touches this file, so the new route silently falls outside this test's coverage — a future regression in `adminGuard` or the route config for `cron-run` specifically would not be caught by it. This is not "adding a new E2E test" (already decided against) — it's keeping an existing, already-scoped-as-exhaustive test actually exhaustive, a one-line addition.
- **Fix**: Add a Change 5 (or fold into Change 4) in Phase 3: append `'/admin/cron-run'` to the `ADMIN_ROUTES` array in `e2e/admin-gate-redirect.spec.ts:22-27`. No new test file, no new `describe`/`it` block — the existing loop picks it up automatically.
- **Decision**: FIXED
