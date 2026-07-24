# Alert Edit & Delete Implementation Plan

## Overview

Extend the alert-crud slice (S-02) with edit and delete capability for existing alerts (S-03, PRD FR-006/FR-007). Adds `PUT`/`DELETE /api/alerts/:id` backend routes, `AlertsService.update()`/`delete()` frontend methods, a dual-mode `AlertForm` (create/edit) opened for editing, and a new delete-confirmation dialog — both triggered from a `mat-action-row` added to each `AlertList` row's expanded panel.

## Current State Analysis

- `src/worker/routes/alerts.ts` has only `POST /` and `GET /` — no route addressing a single alert by id, no `PUT`/`DELETE`.
- `src/app/features/alerts/alerts.service.ts` exposes `list()` and `create()` only; no `update()`/`delete()`.
- `src/app/features/alerts/alert-list/alert-list.ts`/`.html` renders alerts as `mat-expansion-panel`s with a sortable header row; no per-row actions exist, and `AlertList` does not inject `MatDialog`.
- `src/app/features/alerts/alert-form/alert-form.ts`/`.html` is create-only: hardcoded title "New alert" / submit "Create alert", `form` initialized once in the field initializer, `onSubmit()` calls `alertsService.create()` unconditionally.
- Angular i18n (`$localize`, `i18n="@@id"`) is now the established convention (migrated after alert-crud shipped); `angular.json`'s `pl` locale config has `i18nMissingTranslation: "error"` — `npm run build` fails if any `trans-unit id` in `messages.xlf` has no matching `<target>` in `messages.pl.xlf`.
- `price_history` (from F-02, `migrations/0006_create_price_history.sql`) retains every historical close indefinitely — confirmed no data-loss risk in deferring alert `direction` computation to S-05.

## Desired End State

A logged-in user can expand any alert in their list, click "Edit" to open the same alert dialog pre-filled with that alert's current values, change any field, and save — the row updates in place without a page reload, with the same VIX/RSI and threshold-range validation as creation. Clicking "Delete" opens a confirmation dialog naming the specific alert; confirming removes it from D1 and the list immediately; canceling leaves it untouched. Editing to a duplicate of another existing alert, or editing/deleting an alert that no longer exists, surfaces a clear Polish error in the dialog rather than failing silently.

**Verification**: `npm run typecheck`, `npm run test:worker`, and `npm run build` all pass; manual walkthrough in `Testing Strategy` below succeeds end-to-end.

### Key Discoveries:

- `src/worker/routes/auth.ts:64-73`'s UNIQUE-violation-by-message-match pattern, already reused once for `POST /api/alerts`, extends to `PUT` verbatim — SQLite's uniqueness check on `UPDATE` evaluates the table's final state, not the row's pre-update values, so no special "exclude self" logic is needed for the `(user_id, instrument, alert_type, threshold)` constraint to correctly allow a no-op edit while still rejecting a change that collides with a *different* row.
- `INSERT ... RETURNING` is already used in `POST /api/alerts` (`src/worker/routes/alerts.ts:92-98`) — the same `UPDATE ... RETURNING` / `DELETE ... RETURNING id` pattern gives a clean 404 signal (`.first()` returns `null` when the `WHERE id = ? AND user_id = ?` predicate matches no row, whether because the id doesn't exist or belongs to another user) without a separate existence-check query.
- `AlertForm`'s constructor wires two `valueChanges` subscriptions that reset dependent fields (`instrument → 'VIX'` resets `alertType` to `'PRICE'`; any `alertType` change resets `threshold` to `null`) — pre-filling the form for an edit must not let these subscriptions fire during initial population, or the pre-filled `alertType`/`threshold` values will be wiped immediately after being set (see Critical Implementation Details).
- `messages.pl.xlf` entries are added by hand after `npm run extract-i18n` regenerates `messages.xlf` (confirmed via `context/archive/2026-07-19-i18n-migration/plan.md`) — every phase in this plan that introduces new rendered strings must add matching Polish `<trans-unit>`s in the same phase, or `npm run build` fails on `i18nMissingTranslation: "error"`.
- `AlertList` currently has no `MatDialog` injected (only `AlertForm`'s opener, `Home`, does) — this plan is the first place `AlertList` itself needs to open a dialog (both edit and the new delete-confirm dialog).

## What We're NOT Doing

- Adding a `direction` column or any threshold-crossing-direction logic to `alerts` — deferred to S-05, which owns this design; `price_history`'s full retention means no data is lost by waiting (see Key Discoveries).
- Bulk/multi-select edit or delete — FR-006/FR-007 describe single-alert actions only.
- A snackbar/toast confirmation after a successful edit or delete — the list updating in place is the feedback, matching `create()`'s existing (toast-free) convention.
- Displaying current RSI/price next to alerts, or any RSI calculation (S-04).
- Sending notifications or recording trigger events (S-05).
- `PATCH` or any partial-update endpoint — the form always submits the complete alert object, so `PUT`'s full-replace semantics match the only client that will ever call it.

## Implementation Approach

Mirror alert-crud's layering exactly: backend routes (reusing the existing validation helpers and the UNIQUE/CHECK error-mapping pattern) → service methods (same signal-update convention as `create()`) → UI (reuse `AlertForm` in a dual mode rather than fork it; add one new small confirmation-dialog component for delete). Ship the backend routes and tests first (independently verifiable against a real D1 instance via curl/HTTPie), then the service layer, then edit, then delete — each phase leaves the app in a working, demoable state.

## Critical Implementation Details

- **Form pre-fill must not trigger the reset subscriptions.** `AlertForm`'s constructor subscribes to `instrument.valueChanges` (resets `alertType` when switching to `'VIX'`) and `alertType.valueChanges` (always resets `threshold` to `null`). When opening the dialog for an existing alert, the initial `patchValue()` call must either run before these subscriptions are wired, or pass `{ emitEvent: false }`, or the population order must set `threshold` last and outside the reset path — otherwise a pre-filled NASDAQ-100/RSI/70 alert opens with `threshold` silently cleared to `null` the instant `alertType` is set to `'RSI'` during population. The conditional threshold validators (`rsiRangeValidators()`/`priceValidators()`) must also be applied to match the pre-filled `alertType` before the form is considered valid — not just the default `priceValidators()` from the field initializer.
- **`i18nMissingTranslation: "error"` gates every phase that adds UI text.** Phases 3 and 4 below each end with `npm run extract-i18n` followed by hand-adding the new `trans-unit id`s to `messages.pl.xlf` — skipping this breaks `npm run build`, which is this plan's primary automated verification for those phases.

## Phase 1: Backend — PUT/DELETE endpoints

### Overview

Add `PUT /api/alerts/:id` (full-replace update) and `DELETE /api/alerts/:id` to the existing `alertsRoutes` module, both scoped to the authenticated user, with exhaustive integration test coverage mirroring `test/worker/alerts.test.ts`'s existing style.

### Changes Required:

#### 1. Alerts route module — update and delete handlers

**File**: `src/worker/routes/alerts.ts`

**Intent**: Let a user update any field of one of their own alerts, or permanently delete it — both rejecting access to another user's alert as if it doesn't exist.

**Contract**:
- `alertsRoutes.put('/:id', ...)`: parses `id` from `c.req.param('id')` (reject non-numeric with `400 { error: 'invalid alert id' }`); validates body with the same `normalizeInstrument`/`normalizeAlertType`/`validateThreshold`/`normalizeEmail` functions and the same VIX+RSI cross-field rejection as `POST /`; on success runs `UPDATE alerts SET instrument = ?, alert_type = ?, threshold = ?, notification_email = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ? RETURNING ${ALERT_ROW_COLUMNS}`, bound to the validated fields plus `id` and `c.get('userId')`; `.first()` returning `null` → `404 { error: 'alert not found' }`; otherwise `200` with the updated row. `UNIQUE`/`CHECK constraint failed` errors map to `409`/`400` exactly as in `POST /` (same catch block shape, reused verbatim).
- `alertsRoutes.delete('/:id', ...)`: same `id` parsing/400; runs `DELETE FROM alerts WHERE id = ? AND user_id = ? RETURNING id`; `.first()` returning `null` → `404 { error: 'alert not found' }`; otherwise `c.body(null, 204)`.
- Both handlers sit below the existing `POST '/'` and `GET '/'` in the same file, sharing `ALERT_ROW_COLUMNS` and the normalize/validate helpers already defined there.

#### 2. Integration tests

**File**: `test/worker/alerts.test.ts`

**Intent**: Cover the update/delete happy paths, validation reuse, cross-user isolation, and the 404 paths that are new to this phase.

**Contract**: Adds `updateAlert(cookie, id, overrides)` and `deleteAlert(cookie, id)` helpers following the existing `createAlert`/`listAlerts` style. Cases: update happy path (change threshold, confirm `updatedAt` advances past `createdAt`, confirm new values persist via a follow-up `GET`); update rejects the same per-field validation failures as create (spot-check 2-3, not the full create matrix — that's already covered); update to a combination that collides with a different existing alert → `409`; update to `VIX`+`RSI` → `400` with the specific message; update of a nonexistent id → `404`; update of another user's alert id → `404` (isolation); update without a session cookie → `401`; delete happy path (confirm subsequent `GET` no longer includes it) → `204`; delete of a nonexistent id → `404`; delete of another user's alert id → `404` (isolation); delete without a session cookie → `401`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- All worker tests pass, including the new update/delete cases: `npm run test:worker`

#### Manual Verification:

- Start the local worker (`npm run worker:dev`) and manually exercise `PUT`/`DELETE /api/alerts/:id` with a valid session cookie using curl or HTTPie, confirming response shape and status codes match the contract above.

---

## Phase 2: Frontend — AlertsService update/delete methods

### Overview

Add the data-layer methods the edit and delete UI (Phases 3-4) will call, following `create()`'s existing signal-update convention.

### Changes Required:

#### 1. Alerts service

**File**: `src/app/features/alerts/alerts.service.ts`

**Intent**: Give the UI a way to persist an edit or a deletion and see the in-memory alert list reflect it immediately, without a refetch.

**Contract**: `update(id: number, payload: CreateAlertPayload): Observable<Alert>` calls `PUT /api/alerts/${id}`, `tap` replaces the matching alert in place: `this._alerts.update(alerts => alerts.map(a => a.id === id ? updated : a))`. `delete(id: number): Observable<void>` calls `DELETE /api/alerts/${id}`, `tap` removes it: `this._alerts.update(alerts => alerts.filter(a => a.id !== id))`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Production build succeeds: `npm run build`

#### Manual Verification:

- N/A — this phase has no UI surface yet; verified indirectly by Phases 3-4.

---

## Phase 3: Frontend — Edit flow

### Overview

Turn `AlertForm` into a dual-mode dialog (create/edit) and wire an "Edit" action into `AlertList`, opened via a new `mat-action-row` in each panel's expanded body.

### Changes Required:

#### 1. AlertForm dual mode

**File**: `src/app/features/alerts/alert-form/alert-form.ts` / `.html`

**Intent**: Reuse the same form, validators, and error-mapping for editing an existing alert instead of forking a second component.

**Contract**: Injects `MAT_DIALOG_DATA` typed as `{ alert?: Alert } | null`. When `data?.alert` is present: dialog title becomes "Edit alert" / submit label "Save changes" (new i18n ids); the form group is populated from the alert's fields — `threshold`'s conditional validators (`rsiRangeValidators()` for `RSI`, `priceValidators()` for `PRICE`) are applied to match the alert's existing `alertType` as part of population, per the ordering constraint in Critical Implementation Details; `onSubmit()` calls `alertsService.update(data.alert.id, payload)` instead of `create(payload)`. `messageFor()` gains a `404` case mapped to a new Polish message ("This alert no longer exists." — new i18n id) alongside the existing `409` and VIX/RSI `400` cases; the fallback generic message is unchanged.

#### 2. AlertForm template — dynamic title/submit label

**File**: `src/app/features/alerts/alert-form/alert-form.html`

**Intent**: Reflect create vs edit mode in the dialog chrome.

**Contract**: `<h2 mat-dialog-title>` and the submit `<button>` text become `{{ isEditMode ? ... : ... }}` bindings (or two `@if` branches) driven by a `protected readonly isEditMode = !!this.data?.alert;` field, each branch carrying its own `i18n="@@..."` id so both strings extract independently.

#### 3. Edit trigger in AlertList

**File**: `src/app/features/alerts/alert-list/alert-list.ts` / `.html`

**Intent**: Let the user open the edit dialog for a specific alert from its expanded panel.

**Contract**: `AlertList` injects `MatDialog`; adds `protected openEditDialog(alert: Alert): void` calling `this.dialog.open(AlertForm, { width: '32rem', data: { alert } })` (mirrors `Home`'s existing `dialog.open(AlertForm, { width: '32rem' })` call); `AlertsService.update()`'s `tap` already updates the signal in place, so no `afterClosed()` handling is needed beyond opening the dialog. Template adds a `<mat-action-row>` inside each `mat-expansion-panel`, after the existing `.alert-detail` block, with `<button mat-icon-button (click)="openEditDialog(alert)"><mat-icon>edit</mat-icon></button>` plus an `aria-label` (new i18n id, e.g. "Edit alert").

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- `npx ng extract-i18n --output-path src/locale` exits 0 and `messages.xlf` contains every new id introduced in this phase
- Production build succeeds (enforces `i18nMissingTranslation: "error"` against the updated `messages.pl.xlf`): `npm run build`

#### Manual Verification:

- Expand an alert, click the edit icon in its `mat-action-row`, confirm the dialog opens titled "Edit alert" with all four fields pre-filled to the alert's current values (including a NASDAQ-100/RSI alert — confirm the RSI threshold is NOT reset to empty on open).
- Change the threshold and save — confirm the dialog closes and the row's value updates in place without a page reload or refetch flash.
- Edit an alert's `instrument` to `VIX` while `alertType` is `RSI` — confirm the same reset-to-`PRICE` behavior as creation.
- Attempt to edit an alert's values to exactly match a different existing alert — confirm "An alert like this already exists." surfaces as a visible form error.
- Open the edit dialog, delete the alert in a second browser tab, then submit the edit — confirm a "This alert no longer exists." error appears in the dialog and it does not auto-close.

---

## Phase 4: Frontend — Delete flow

### Overview

Add a delete-confirmation dialog and wire a "Delete" action into the same `mat-action-row` added in Phase 3.

### Changes Required:

#### 1. Delete confirmation dialog

**File**: `src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts` / `.html` / `.scss` (new)

**Intent**: Require an explicit, specific confirmation before permanently deleting an alert (FR-007), per M3 destructive-action guidance (name the item, warn-colored confirm action, Cancel focused by default).

**Contract**: Standalone component; injects `MAT_DIALOG_DATA` typed as `{ summary: string }` — `summary` is a pre-formatted string (e.g. `"VIX · Price · 35.00"`) built by the caller (`AlertList`, which already has `instrumentLabel()`/`alertTypeLabel()`) rather than duplicated in this component. Dialog shows the summary in its body text ("Delete this alert?" / the summary, new i18n ids); `<mat-dialog-actions>` has a `mat-dialog-close` Cancel button with `cdkFocusInitial`, and a `color="warn"` Delete button that closes the dialog with `true`.

#### 2. Delete trigger in AlertList

**File**: `src/app/features/alerts/alert-list/alert-list.ts` / `.html`

**Intent**: Let the user delete a specific alert, with confirmation, from its expanded panel.

**Contract**: Adds `protected deleteAlert(alert: Alert): void` — opens `DeleteAlertConfirm` via `this.dialog.open(DeleteAlertConfirm, { data: { summary: \`${this.instrumentLabel(alert.instrument)} · ${this.alertTypeLabel(alert.alertType)} · ${alert.threshold.toFixed(2)}\` } })`, and on `afterClosed()` emitting `true`, calls `this.alertsService.delete(alert.id).subscribe()` (no further UI action needed — the service's `tap` removes the row from the signal). Template adds a second button to the same `<mat-action-row>` from Phase 3: `<button mat-icon-button color="warn" (click)="deleteAlert(alert)"><mat-icon>delete</mat-icon></button>` with an `aria-label` (new i18n id, "Delete alert").

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- `npx ng extract-i18n --output-path src/locale` exits 0 and `messages.xlf` contains every new id introduced in this phase
- Production build succeeds: `npm run build`

#### Manual Verification:

- Expand an alert, click the delete icon in its `mat-action-row`, confirm the confirmation dialog names the specific alert (instrument/type/threshold) — not a generic message.
- Click "Cancel" — confirm the dialog closes and the alert is still present in the list.
- Click "Delete" — confirm the dialog closes and the alert disappears from the list immediately without a page reload.
- Refresh the page after deleting — confirm the alert stays gone (persisted, not just local state).
- Delete the only remaining alert — confirm the empty-state message reappears.

---

## Testing Strategy

### Unit Tests:

None — Angular unit tests are disabled project-wide (`skipTests: true` in `angular.json`, a hard rule in `CLAUDE.md`). Coverage comes from backend integration tests (Phase 1) and manual verification (Phases 3-4).

### Integration Tests:

- `test/worker/alerts.test.ts` (Phase 1) — update/delete happy paths, validation reuse, 404s, cross-user isolation; see the exhaustive case list above.

### Manual Testing Steps:

1. Log in with an existing user who has at least one VIX/PRICE and one NASDAQ-100/RSI alert (create them via the existing "New alert" flow if needed).
2. Expand the NASDAQ-100/RSI alert, click edit — confirm all fields (including the RSI threshold) are pre-filled correctly.
3. Change the threshold to a new valid value and save — confirm the row updates in place.
4. Attempt to edit an alert into a duplicate of another — confirm the 409 error message.
5. Expand an alert, click delete, click Cancel — confirm nothing changes.
6. Click delete again, confirm — confirm the alert disappears and stays gone after a page refresh.
7. Log in as a second user — confirm they cannot see or affect the first user's alerts (already covered by Phase 1's automated isolation tests, but worth a quick manual sanity check via the UI).

## Performance Considerations

None specific to this slice — same single-digit alert counts per user as S-02; no pagination or virtualization needed.

## Migration Notes

No D1 migration in this plan — `PUT`/`DELETE` operate on the existing `alerts` table schema unchanged.

## References

- Prior implementation: `context/archive/2026-07-19-alert-crud/plan.md`
- i18n workflow (`extract-i18n` + hand-translated `messages.pl.xlf`, `i18nMissingTranslation: "error"`): `context/archive/2026-07-19-i18n-migration/plan.md`
- `price_history` retention (grounds deferring `direction` to S-05): `context/archive/2026-07-24-market-data-pipeline/plan.md`
- UNIQUE-violation pattern: `src/worker/routes/auth.ts:64-73`, reused in `src/worker/routes/alerts.ts:101-109`
- `RETURNING`-based existence check precedent: `src/worker/routes/alerts.ts:92-98`
- Dialog-open precedent: `src/app/features/home/home.ts` (`dialog.open(AlertForm, { width: '32rem' })`)
- Roadmap: `context/foundation/roadmap.md` S-03
- PRD: `context/foundation/prd.md` FR-006, FR-007

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — PUT/DELETE endpoints

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 96f6aa0
- [x] 1.2 All worker tests pass, including new update/delete cases: `npm run test:worker` — 96f6aa0

#### Manual

- [x] 1.3 Manually exercise `PUT`/`DELETE /api/alerts/:id` against the local worker with a valid session cookie — 96f6aa0

### Phase 2: Frontend — AlertsService update/delete methods

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 8a35239
- [x] 2.2 Production build succeeds: `npm run build` — 8a35239

### Phase 3: Frontend — Edit flow

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck`
- [x] 3.2 `npx ng extract-i18n --output-path src/locale` exits 0 and includes every new id from this phase
- [x] 3.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Edit dialog opens pre-filled with all four fields, including a NASDAQ-100/RSI alert's threshold
- [ ] 3.5 Editing threshold and saving updates the row in place without a refetch flash
- [ ] 3.6 Editing instrument to VIX while alertType is RSI resets alertType to PRICE
- [ ] 3.7 Editing to a duplicate of another alert surfaces the 409 error
- [ ] 3.8 Editing an alert deleted in another tab surfaces "This alert no longer exists." without auto-closing

### Phase 4: Frontend — Delete flow

#### Automated

- [ ] 4.1 Typecheck passes: `npm run typecheck`
- [ ] 4.2 `npx ng extract-i18n --output-path src/locale` exits 0 and includes every new id from this phase
- [ ] 4.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.4 Delete confirmation dialog names the specific alert being deleted
- [ ] 4.5 Cancel leaves the alert untouched
- [ ] 4.6 Confirm removes the alert from the list immediately
- [ ] 4.7 Deletion persists after a page refresh
- [ ] 4.8 Deleting the last alert restores the empty-state message
