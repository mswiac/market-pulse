# E2E for the Force data refresh admin page Implementation Plan

## Overview

Add browser-level coverage for the admin "Force data refresh" page (`/admin/cron-run`, GitHub issue #184). The three `POST /api/admin/cron/run` calls the page makes are mocked at the network layer, so the tests exercise the real rendered UI (confirm dialog, results tables, errors section) without Yahoo, D1 data, or real emails. Server logic stays covered by worker tests.

## Current State Analysis

- The page (`src/app/features/admin/cron-run/`) opens `CronRunConfirm` on click; on confirm it sends three requests to `/api/admin/cron/run`: `{phase:'fetch', market:'pl'}`, `{phase:'fetch', market:'other'}`, then `{phase:'evaluate'}`. Responses are merged into one summary (`mergeSummaries`) rendered as a Tickers table, "Alerts evaluated: N", an Emails table or "No emails were sent.", and an Errors list only when `errors` is non-empty.
- A failed request (non-2xx) is converted into an entry in `errors`; 207 is a 2xx and is treated as a normal success body by `HttpClient`.
- Admin E2E infrastructure already exists from #183: the `chromium-admin` project, admin `storageState`, `e2e/admin/admin-gate-pass.spec.ts` as the admin seed, and `e2e/seed.spec.ts` as the general seed.
- The dev server runs the `development-pl` build, so accessible names are the Polish targets from `src/locale/messages.pl.xlf`.

## Desired End State

`e2e/admin/cron-run.spec.ts` holds four independent tests, all green in `chromium-admin` locally and in CI, each of which turns red when the behavior it protects is broken:

1. Clean run (200): per-market fetch plus evaluation shown, "Nie wysłano żadnych e-maili.", no "Błędy" section.
2. 207 with a failed ticker: the Tickers table shows the "Błąd" status and the error message for that ticker.
3. 207 with `errors` (stale ticker / failed alert load, from #172): the "Błędy" section lists them.
4. Cancelling the confirm dialog sends no request.

### Key Discoveries:

- The page issues 3 requests per run, so the mock must branch on the request body (`phase`, `market`) rather than return one fixed response (`cron-run.ts` `run()`).
- `Cancel` in the dialog is `mat-dialog-close` with no value, so `afterClosed()` yields `undefined` and `run()` is skipped (`cron-run.ts` `onTriggerClick`).
- Without a route handler a click on "Wymuś" would hit the real worker and trigger a real run, so every test installs the mock before navigating, including the cancel test (where it doubles as the "no request" probe).

## What We're NOT Doing

- No real cron execution, Yahoo calls, or D1 data setup.
- No coverage of the failure-notice email (sent only from the scheduled handler; covered by `scheduled.test.ts` and `cron-failure-notice.test.ts`).
- No changes to application code, worker code, Playwright config, CI workflow, or husky hook.
- No 401/403 or network-failure scenarios (not in the issue; the generic-error path is already unit-tested).

## Implementation Approach

One `/10x-e2e` phase: fill a prompt file from the template, generate one spec with four tests modeled on `e2e/seed.spec.ts` and `e2e/admin/admin-gate-pass.spec.ts`, review against the five anti-patterns, then verify green and break-check each test. A single spec file holds the four tests (a deliberate deviation from the skill's one-test-per-file default, chosen to share one mock helper); each test still has its own setup, action, assertion, and no shared state.

## Critical Implementation Details

- **Route mocking**: install `page.route('**/api/admin/cron/run', ...)` before `page.goto`, and fulfil per request body so the pl fetch, other fetch, and evaluate calls can return different payloads (needed to put a failed ticker or `errors` into exactly one of them). The cancel test uses the same route purely to count requests.
- **Ticker names**: result rows show the instrument name when the instrument is in the catalogue, otherwise the raw ticker; assert on text that holds in both cases (use tickers from the mocked payload and match the error message text, not the display name).

## Phase 1: Cron-run admin page E2E

### Overview

Generate, review, and verify `e2e/admin/cron-run.spec.ts` via `/10x-e2e`.

### Changes Required:

#### 1. Generation prompt

**File**: `e2e/prompts/cron-run.prompt.md`

**Intent**: Record the filled prompt template (risk, research anchor, scenarios, real vs mocked boundaries) for traceability, as done for the admin-gate prompt.

**Contract**: Follows `.claude/skills/10x-e2e/references/e2e-prompt-template.md`; real boundaries are storageState admin session, adminGuard, router, the confirm dialog, and the results rendering; the only mocked boundary is `POST /api/admin/cron/run`.

#### 2. Spec

**File**: `e2e/admin/cron-run.spec.ts`

**Intent**: Four tests covering the four issue scenarios, with a small local helper that installs the body-aware route mock and records requests.

**Contract**: Runs only in `chromium-admin` (already matches `e2e/admin/`). Role/label/text locators only, no `waitForTimeout`, unique ticker/message strings not required (nothing is persisted) but each test installs its own route. Test names bind to the behavior (e.g. "a failed ticker in a 207 response shows its error in the Tickers table").

### Success Criteria:

#### Automated Verification:

- The new spec passes in the admin project: `npx playwright test --project=chromium-admin e2e/admin/cron-run.spec.ts`
- Each test fails when its risk is deliberately broken (temporary break, reverted afterwards)
- Typecheck and lint pass: `npx tsc --noEmit -p tsconfig.json` (or the project's typecheck script) and `npm run lint`
- CI Playwright job is green on the PR

---

## Testing Strategy

### E2E Tests:

- The four scenarios above, all with a mocked `/api/admin/cron/run`.

### Unit Tests:

- None added; page logic is already covered by component/worker tests.

## Performance Considerations

None; all responses are fulfilled locally and instantly.

## References

- Issue: #184 (depends on #183)
- Seeds: `e2e/seed.spec.ts`, `e2e/admin/admin-gate-pass.spec.ts`, prompt `e2e/prompts/admin-gate-pass.prompt.md`
- Page: `src/app/features/admin/cron-run/cron-run.ts`, `cron-run.html`, `cron-run-confirm/`
- Risk map: `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cron-run admin page E2E

#### Automated

- [x] 1.1 The new spec passes in the admin project
- [x] 1.2 Each test fails when its risk is deliberately broken
- [x] 1.3 Typecheck and lint pass
- [ ] 1.4 CI Playwright job is green on the PR
