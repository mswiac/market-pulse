<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin Endpoint and Panel UI to Manually Trigger the Daily Cron Pipeline

- **Plan**: context/changes/admin-cron-trigger/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-09-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (re-run at HEAD, commit 1d3a781)

- `npm run typecheck` — PASS
- `npm run test:worker` — PASS (285/285)
- `npm run lint` — PASS
- `npm run build` (i18n completeness gate) — PASS
- `npm run test:ci` — PASS (104/104)
- `npx playwright test admin-gate-redirect` — PASS (6/6), confirmed earlier in-session at commit 63c8473; not re-run here since nav-label/position changes since then don't affect this test's URL-based assertions.

## Findings

### F1 — Plan and brief still describe the pre-rename UI text

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/admin-cron-trigger/plan.md:31,234`, `context/changes/admin-cron-trigger/plan-brief.md:15`
- **Detail**: The plan's Desired End State and Phase 3 Manual Verification bullet, plus the brief's Key Decisions table, still say the button reads "Uruchom pipeline". Mid-implementation the user renamed the feature twice (commits bae4d72, a52bd5f) to "Wymuś aktualizację danych" (page/button/dialog) with a shorter "Aktualizuj dane" for the nav label — the shipped code is fully consistent with the final naming (confirmed by both review sub-agents), but these two doc files were never updated to match. Progress item 3.6 was checked `[x]` referencing the old text even though the UI had already been renamed by that point.
- **Fix**: Update `plan.md:31,234` and `plan-brief.md:15` to reference the final strings ("Wymuś aktualizację danych" for the page/button, "Aktualizuj dane" for the nav label).
- **Decision**: FIXED

### F2 — Unplanned scheduled.ts date-window fix not recorded in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/worker/scheduled.ts` (commit 556a318, not in `plan.md`'s file list)
- **Detail**: Manual testing surfaced a real, pre-existing bug — `fetchWithRetry`'s `to` date used today instead of tomorrow, so Yahoo's exclusive `period2` boundary silently excluded every ticker's own-day close on every cron run. The user explicitly asked to fix this in the same branch ("Napraw teraz, w tym samym branchu"), and it's fixed and tested. It's a legitimate, authorized addition — not scope creep in the "someone snuck in extra work" sense — but `plan.md` has no record that this commit is part of the branch for a reason unrelated to issue #150, which a future reader (or `/10x-archive`) would have no way to know.
- **Fix**: Add a short note to `plan.md` (e.g. a "Related fixes" subsection under References) recording that commit 556a318 is an unrelated, user-authorized bugfix bundled into this branch, with a one-line description and why it isn't reflected in the phases above.
- **Decision**: FIXED

### F3 — `/cron/run` has no try/catch, unlike every sibling admin route

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/worker/routes/admin.ts:107-113`
- **Detail**: Every other route in this file wraps its fallible core logic in try/catch and returns a `{error, code}` shape on failure (`write_failed`, `delete_failed`, `fetch_failed`). `/cron/run` calls `await handleScheduled(c.env)` directly with no wrapper. In practice this is currently safe — every failure path inside `handleScheduled`/`evaluateAlerts` is already caught internally and folded into the returned summary (confirmed by both sub-agents and by Phase 1's own design) — so there is no live throw path today. But the route is an outlier from this file's own defensive convention, and any future change to the pipeline that introduces an uncaught throw would surface as Hono's generic unhandled 500 instead of this file's consistent `{error, code}` shape.
- **Fix**: Wrap the `handleScheduled` call in try/catch, returning `c.json({ error: 'cron run failed', code: 'cron_run_failed' }, 500)` on an unexpected throw, matching the file's existing pattern.
- **Decision**: FIXED (no automated test added — the project doesn't use `vi.mock`, and every internal failure path in `handleScheduled` is already caught, so there's no clean way to force a throw at this boundary without contrived module mocking)

### F4 — Raw error strings rendered unsanitized in the results table

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: `src/app/features/admin/cron-run/cron-run.html:38-41,67-70`, sourced from `String(err)` in `src/worker/lib/alert-evaluation.ts:191` and similar spots in `scheduled.ts`
- **Detail**: Ticker/email/stage error messages are internal exception text (Yahoo HTTP failures, D1 exceptions), not secrets, and the page is admin-gated — risk is low. This diverges from the rest of the app's pattern of mapping a `code` to a curated, localized message rather than surfacing raw server text, which is deliberate here (there's no fixed enum of codes for arbitrary pipeline exceptions), but worth a conscious note rather than silent acceptance.
- **Fix**: No action required now; if this table is ever exposed more broadly (e.g. screen-shared reports, exported logs), reconsider truncating/generalizing these strings first.
- **Decision**: SKIPPED

### F5 — No route-level test for the email-failure (207 via failed send) path

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria (test coverage)
- **Location**: `test/worker/admin.test.ts` — `describe('POST /api/admin/cron/run', ...)`
- **Detail**: `stubFetchForCronRun` already supports a `resendFails` option, but no test in this describe block exercises it — the only 207 test covers a ticker-fetch failure, not an email-send failure. The `emails.some(status==='failed')` branch of `hasFailures` (admin.ts:110) is exercised at the unit level in `alert-evaluation.test.ts` but not through the full route.
- **Fix**: Add one more test case using `stubFetchForCronRun({ resendFails: true })` with a crossing alert, asserting `emails` contains a `status: 'failed'` entry and the response is `207`.
- **Decision**: FIXED
