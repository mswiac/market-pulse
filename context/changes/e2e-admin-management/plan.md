# E2E for admin instrument and user management Implementation Plan

## Overview

Add browser-level coverage for the three admin management screens (GitHub issue #185): add instrument (`/admin/add-instrument`), remove instrument (`/admin/remove-instrument`) and remove user (`/admin/remove-user`). Unlike the cron-run page (#184), nothing is mocked: these actions are local, reversible, and send no email, so the specs exercise the real chain UI → Worker → D1 and clean up after themselves through the admin API.

## Current State Analysis

- Add instrument: a signal-based form (type, ticker, suffix, name, currency, RSI checkbox). The ticker is uppercased on blur; submit calls `POST /api/admin/instruments`, then reloads the shared `InstrumentsService`, so the new instrument appears in every instrument picker. Success shows a snackbar; a duplicate ticker returns 409 `instrument_duplicate_ticker`.
- Remove instrument: the instrument picker plus a "Remove instrument" button. Submit calls `GET /api/admin/instruments/:ticker/impact`, opens `RemoveInstrumentConfirm` (alert count, history warning), and only on confirm calls `DELETE /api/admin/instruments/:ticker`, which cascades to alerts, price_history and market_data in one batch (no FK on `ticker`). Cancel just re-enables the button.
- Remove user: a select listing users sorted by email, first one preselected. Submit calls `GET /api/admin/users/:id/impact`, opens `RemoveUserConfirm` (email, alert and trigger-event counts), and only on confirm calls `DELETE /api/admin/users/:id` (DB-level cascade).
- `GET /api/admin/users` excludes the caller (`id != userId`), so the admin's own account is not selectable in the UI. The `cannot_delete_self` guard (403) is only reachable via a direct API call.
- `POST /api/register` returns `{id, email}` and also sets a session cookie, so registering through the admin page's request context would replace the admin session.
- Admin E2E infrastructure exists from #183 (`chromium-admin`, admin `storageState`); seeds are `e2e/seed.spec.ts` and `e2e/admin/admin-gate-pass.spec.ts`; `e2e/delete-alert.spec.ts` is the reference for API cleanup in `afterEach`.
- The dev server runs the `development-pl` build, so accessible names are the Polish targets from `src/locale/messages.pl.xlf`.

## Desired End State

Three specs under `e2e/admin/`, green in `chromium-admin` locally and in CI, each turning red when its behavior breaks:

1. `add-instrument.spec.ts`: filling the form and submitting makes the instrument findable in the instrument picker (with the ticker uppercased); the instrument is removed again via the API.
2. `remove-instrument.spec.ts`: for an instrument created via the API, the confirm dialog shows the impact, confirming removes it from the picker and from the server, cancelling removes nothing.
3. `remove-user.spec.ts`: for a user created via `/api/register`, the confirm dialog shows that user's email, confirming removes them from the list and from the server (the user can no longer log in); cancelling removes nothing; the admin's own account is not selectable and a direct `DELETE` of one's own id is rejected with 403 `cannot_delete_self`.

### Key Discoveries:

- Register must run in a fresh `APIRequestContext` (`playwright.request.newContext`), otherwise its `Set-Cookie` replaces the admin session in the page's context (`auth.ts` `/register`).
- The self-delete guard cannot be driven from the UI because `GET /api/admin/users` omits the caller (`admin.ts` `/users`); it is asserted over the API, plus a UI assertion that the admin's email is absent from the list.
- `DELETE /api/admin/instruments/:ticker` and `DELETE /api/admin/users/:id` double as the cleanup calls (admin session, idempotent enough: a 404 after a test already removed the row is fine).
- The remove-user select preselects the first user, so the test must pick its own user explicitly by email, never rely on the default.

## What We're NOT Doing

- No mocking of the admin endpoints and no changes to application code, worker code, Playwright config, CI workflow, or husky hook.
- No validation-error scenarios (missing ticker, bad currency, duplicate ticker) and no 403-for-non-admin checks; those belong to alerts/validation work (#186) or are already unit-tested.
- No assertions about cascade side effects (alerts, price history deleted) beyond the count shown in the impact dialog; that is worker-test territory.
- No test of the type → suffix mapping or RSI checkbox beyond what the happy path needs.

## Implementation Approach

One `/10x-e2e` phase: fill one prompt file, generate three spec files modeled on the seeds, review against the five anti-patterns, then verify green and break-check each test. Each test creates its own data with a unique timestamp-based id, and registers its cleanup in `afterEach` (best-effort API delete), so a failure mid-test leaves nothing behind.

## Critical Implementation Details

- **Unique, collision-proof ids**: the instruments table is global and `ticker` is unique, so use a prefix such as `E2E` plus a timestamp and random suffix (letters/digits only, uppercase already so the server normalization is a no-op); users use `e2e-<id>@e2e.market-pulse.test`. The remove-user list is global too, so locate the row by the unique email.
- **Cleanup must not touch real data**: delete only the exact ticker/id this test created. Never sweep by prefix across the table in a way that could remove another parallel run's data unless the prefix is run-unique.
- **Self-delete id**: read the admin's own id from `GET /api/me` in the test; do not hardcode.

## Phase 1: Admin management E2E

### Overview

Generate, review, and verify the three specs via `/10x-e2e`.

### Changes Required:

#### 1. Generation prompt

**File**: `e2e/prompts/admin-management.prompt.md`

**Intent**: Record the filled prompt template for the three screens (risk, research anchor, scenarios, real vs mocked boundaries) for traceability, as done for the earlier admin prompts.

**Contract**: Follows `.claude/skills/10x-e2e/references/e2e-prompt-template.md`; Risk #8 (destructive-action UI) is applied by analogy as in #184; every boundary is real (nothing mocked).

#### 2. Add instrument spec

**File**: `e2e/admin/add-instrument.spec.ts`

**Intent**: Prove an admin-created instrument is persisted and visible in the instrument picker, with the ticker normalized to uppercase.

**Contract**: One test; creates a unique ticker through the form, waits for the POST response, asserts the instrument is selectable in a picker; `afterEach` deletes it via `DELETE /api/admin/instruments/:ticker`.

#### 3. Remove instrument spec

**File**: `e2e/admin/remove-instrument.spec.ts`

**Intent**: Prove the confirm dialog gates the deletion and that confirming removes the instrument for real.

**Contract**: Two tests. Setup creates the instrument via `POST /api/admin/instruments`. (a) Confirm: dialog shows the ticker, confirming makes it disappear from the picker and a reload of the page still does not list it. (b) Cancel: nothing is removed (still selectable, and `GET` of the instrument list still contains it). `afterEach` best-effort deletes the ticker.

#### 4. Remove user spec

**File**: `e2e/admin/remove-user.spec.ts`

**Intent**: Prove the same gating for user removal, and that an admin cannot delete themselves.

**Contract**: Three tests. User is registered via `POST /api/register` in a fresh request context (returns `id`). (a) Confirm: dialog shows the user's email, confirming removes the email from the select and the user can no longer log in. (b) Cancel: user still listed and can still log in. (c) Self: the admin's own email is absent from the select, and `DELETE /api/admin/users/<own id>` returns 403 with `code: 'cannot_delete_self'`. `afterEach` best-effort deletes the registered user by id.

### Success Criteria:

#### Automated Verification:

- The new specs pass in the admin project: `npx playwright test --project=chromium-admin e2e/admin/add-instrument.spec.ts e2e/admin/remove-instrument.spec.ts e2e/admin/remove-user.spec.ts`
- Each test fails when its risk is deliberately broken (temporary break, reverted afterwards)
- No test data is left behind after a run (instrument list and user list unchanged)
- Typecheck and lint pass: `npx tsc --noEmit -p tsconfig.json` (or the project's typecheck script) and `npm run lint`
- CI Playwright job is green on the PR

---

## Testing Strategy

### E2E Tests:

- The six scenarios above against the real Worker and local D1, with API cleanup.

### Unit Tests:

- None added; component and worker logic is already covered by component/worker tests.

## Performance Considerations

Each spec makes a few API calls; registration hashes a password once per created user (PBKDF2, already capped for the Workers runtime). Specs are independent and can run in parallel.

## References

- Issue: #185 (depends on #183)
- Seeds: `e2e/seed.spec.ts`, `e2e/admin/admin-gate-pass.spec.ts`, cleanup reference `e2e/delete-alert.spec.ts`, prompt reference `e2e/prompts/cron-run.prompt.md`
- Screens: `src/app/features/admin/{add-instrument,remove-instrument,remove-instrument-confirm,remove-user,remove-user-confirm}/`
- API: `src/worker/routes/admin.ts`, `src/worker/routes/auth.ts`
- Risk map: `context/foundation/test-plan.md` (Risk #8)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Admin management E2E

#### Automated

- [x] 1.1 The new specs pass in the admin project
- [x] 1.2 Each test fails when its risk is deliberately broken
- [x] 1.3 No test data is left behind after a run
- [x] 1.4 Typecheck and lint pass
- [ ] 1.5 CI Playwright job is green on the PR
