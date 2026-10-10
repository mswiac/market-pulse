# Manual Alert Pause Implementation Plan

## Overview

Let a user pause an alert without deleting it (GitHub issue #199). A paused alert is skipped by the cron evaluation (no emails, no automatic re-arm) until the user resumes it. Pause is a new, separate concept from the automatic `armed` state (exposed as `active`).

## Current State Analysis

- `alerts.armed` (migration 0011) is the automatic re-arm state, exposed as `active` and rendered as "Active/Inactive" in the alert list. `evaluateAlerts` clears it after a trigger and sets it again after the price retreats past a margin.
- `evaluateAlerts` loads every alert with one unfiltered `SELECT` and evaluates all of them.
- `PUT /api/alerts/:id` recomputes `armed` on every edit and writes it in the `UPDATE`.
- The alert list row actions are edit and delete only. There is no partial-update endpoint.

## Desired End State

- Each alert has a `paused` flag, returned as a boolean `paused` by `GET/POST/PUT /api/alerts`.
- `PATCH /api/alerts/:id` with `{ "paused": boolean }` pauses or resumes the caller's own alert. Resuming always sets `armed = 1` (user decision: always re-arm, no recompute against the current price).
- The cron skips paused alerts entirely. Editing an alert never changes `paused`.
- The alert list shows a Pause/Resume button per row and a distinct "Paused" status, separate from "Active/Inactive".

### Key Discoveries:

- `src/worker/lib/alert-evaluation.ts:135` — the single alert-loading `SELECT`; the pause filter belongs in its `WHERE`.
- `src/worker/routes/alerts.ts:185` and `:201` — `ALERT_SELECT` and `toAlertResponse` are the one place response shape is built.
- `src/worker/routes/alerts.ts:300` — the `PUT` `UPDATE` lists its columns explicitly, so `paused` is untouched unless added there.
- `src/worker/lib/instruments.ts:22` — `selectAlertInstruments` is scoped by alert-row existence on purpose; paused alerts keep their ticker fetched. Not changed.
- `migrations/0015_instruments_suffix.sql` — a plain `ADD COLUMN` with a constant default needs no shadow-table rebuild.

## What We're NOT Doing

- No change to `armed` semantics or its "Active/Inactive" label.
- No pause checkbox in the edit form (user chose a list toggle).
- No recompute of `armed` on resume, and no market-data refresh on pause or resume.
- No change to `selectAlertInstruments` (paused-only tickers are still fetched; negligible cost).
- No bulk pause and no pause scheduling.

## Implementation Approach

New column `paused INTEGER NOT NULL DEFAULT 0` (migration 0016). A dedicated `PATCH` endpoint keeps pause out of the create/edit payload, so the edit path cannot clear it by accident. The cron filter is a single `WHERE a.paused = 0`. Two phases: backend with worker tests, then frontend with unit and e2e tests.

## Critical Implementation Details

- **State sequencing**: on resume, set `paused = 0` and `armed = 1` in one `UPDATE`, so a cron run can never see a resumed alert that is still disarmed.
- **Deploy order**: D1 migrations are not applied by `npm run deploy`; migration 0016 must be applied remotely before the new worker code ships, since the cron `SELECT` references `paused`.

## Phase 1: Backend — column, endpoint, cron filter

### Overview

Persist the pause flag, expose it, let the owner toggle it, and make the cron honour it.

### Changes Required:

#### 1. Migration

**File**: `migrations/0016_alert_paused.sql`

**Intent**: Add the user-controlled pause flag, defaulting existing alerts to not paused.

**Contract**: `ALTER TABLE alerts ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;` with a header comment explaining it is separate from `armed`.

#### 2. Alerts routes

**File**: `src/worker/routes/alerts.ts`

**Intent**: Return `paused` as a boolean and add the toggle endpoint. Leave the `PUT` `UPDATE` column list alone so edits never touch `paused`.

**Contract**: `ALERT_SELECT` gains `a.paused AS paused`; `toAlertResponse` converts it to a boolean. New `PATCH /:id` takes `{ paused: boolean }` (400 `invalid_body` otherwise, 400 `invalid_alert_id`, 404 `alert_not_found` for a missing or foreign alert), runs `UPDATE alerts SET paused = ?, armed = CASE WHEN ? = 0 THEN 1 ELSE armed END ... WHERE id = ? AND user_id = ?` plus the `ALERT_SELECT` row in one `batch()` like the other handlers, and returns the alert.

#### 3. Cron evaluation

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Skip paused alerts so they send no email and are neither disarmed nor re-armed.

**Contract**: add `WHERE a.paused = 0` to the alert-loading query.

#### 4. Worker tests

**Files**: `test/worker/alerts.test.ts`, `test/worker/alert-evaluation.test.ts`

**Intent**: Cover the new behaviour at the API and cron boundaries.

**Contract**: PATCH pauses, resumes (and re-arms a disarmed alert), rejects a bad body, and returns 404 for another user's alert; `paused` appears in GET/POST/PUT responses; a PUT on a paused alert leaves it paused; evaluation sends no email for a paused armed alert whose threshold is crossed, and does not re-arm a paused disarmed one.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Worker tests pass: `npm run test:worker`

#### Manual Verification:

- Local D1 accepts migration 0016 and `PATCH /api/alerts/:id` toggles `paused` on a throwaway alert

**Implementation Note**: Pause for manual confirmation after this phase before proceeding.

---

## Phase 2: Frontend — list toggle and status

### Overview

Surface pause in the alert list with a one-click toggle and a distinct status.

### Changes Required:

#### 1. Alerts service

**File**: `src/app/features/alerts/alerts.service.ts`

**Intent**: Carry `paused` on `Alert` and add the toggle call.

**Contract**: `Alert.paused: boolean`; `setPaused(id: number, paused: boolean): Observable<Alert>` does `PATCH /api/alerts/:id` and replaces the alert in the `alerts` signal, like `update`.

#### 2. Alert list

**Files**: `src/app/features/alerts/alert-list/alert-list.ts`, `alert-list.html`, `alert-list.scss`

**Intent**: Add a Pause/Resume icon button in the row actions and show "Paused" as the status. A paused alert takes precedence over Active/Inactive in the status line and gets the existing muted header style.

**Contract**: a handler calling `setPaused` with a load-error flag in the style of `deleteError`; the button's `aria-label` toggles between "Pause alert" and "Resume alert"; status shows Paused when `alert.paused`, otherwise the existing Active/Inactive; the header `inactive` class applies when `!alert.active || alert.paused`.

#### 3. Translations

**Files**: `src/locale/messages.xlf`, `src/locale/messages.pl.xlf`

**Intent**: Add the new strings via `npm run extract-i18n` and add the Polish targets.

**Contract**: ids for the pause/resume labels, the Paused status and the toggle error message.

#### 4. Tests

**Files**: `src/app/features/alerts/alert-list/alert-list.spec.ts`, `e2e/alerts-pause.spec.ts`

**Intent**: Unit-test the toggle and status; one e2e proving the user-visible flow.

**Contract**: unit — clicking Pause calls `setPaused(id, true)`, a paused alert renders "Paused", Resume calls `setPaused(id, false)`; fixtures gain `paused`. e2e (Polish locale strings, `getByRole`, API-created alert with unique threshold and cleanup via `alerts-api.ts`) — pause the alert, see the paused status, resume it, see the active status.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Prettier check passes on changed files: `npx prettier --check <changed files>`
- Angular unit tests pass: `npm run test:ci`
- Pause e2e passes: `npx playwright test e2e/alerts-pause.spec.ts`

#### Manual Verification:

- Pausing and resuming an alert in the running app changes the button, the status and survives a reload
- Editing a paused alert keeps it paused

---

## Testing Strategy

### Unit Tests:

- Worker: PATCH happy paths and errors, `paused` in responses, PUT preserves pause, cron skips paused alerts.
- Angular: toggle call, status rendering, button label.

### Integration Tests:

- One e2e through the real API and D1: pause, then resume.

### Manual Testing Steps:

1. Create an alert, pause it, reload, confirm it is still paused.
2. Edit the paused alert, confirm it stays paused.
3. Resume it and confirm the status returns to Active.

## Migration Notes

Existing rows get `paused = 0`. Apply migration 0016 to remote D1 before deploying the worker (see Critical Implementation Details).

## References

- Issue: #199
- Similar patterns: `src/worker/routes/alerts.ts` (batch-based handlers), `migrations/0015_instruments_suffix.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — column, endpoint, cron filter

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Worker tests pass: `npm run test:worker`

#### Manual

- [ ] 1.4 Local D1 accepts migration 0016 and `PATCH /api/alerts/:id` toggles `paused` on a throwaway alert

### Phase 2: Frontend — list toggle and status

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Prettier check passes on changed files: `npx prettier --check <changed files>`
- [ ] 2.4 Angular unit tests pass: `npm run test:ci`
- [ ] 2.5 Pause e2e passes: `npx playwright test e2e/alerts-pause.spec.ts`

#### Manual

- [ ] 2.6 Pausing and resuming an alert in the running app changes the button, the status and survives a reload
- [ ] 2.7 Editing a paused alert keeps it paused
