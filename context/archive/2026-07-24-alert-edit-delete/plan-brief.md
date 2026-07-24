# Alert Edit & Delete — Plan Brief

> Full plan: `context/changes/alert-edit-delete/plan.md`

## What & Why

Add edit and delete for existing alerts (S-03, PRD FR-006/FR-007), completing the alert CRUD loop started by S-02. A user can currently only create and view alerts — they can't fix a mistyped threshold or remove an alert they no longer want without contacting support or living with it.

## Starting Point

S-02 (alert-crud) shipped `POST`/`GET /api/alerts`, an `AlertsService` with `list()`/`create()`, and a `mat-expansion-panel`-based `AlertList` with a create dialog (`AlertForm`). There is no way to change or remove an alert once created — no `PUT`/`DELETE` routes, no service methods, no UI trigger.

## Desired End State

Expanding an alert in the list reveals Edit and Delete actions. Edit reopens the same alert dialog, pre-filled, and saves in place on submit. Delete opens a confirmation dialog naming the specific alert, then removes it immediately on confirm — no page reload, no refetch flash, changes persist across a page refresh.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Action placement | `mat-action-row` in the expanded panel body | Official Angular Material component for this exact pattern, no new layout work on the collapsed sortable header | Plan |
| Edit component | Reuse `AlertForm` in a dual create/edit mode | Avoids duplicating VIX/RSI exclusion + validator + error-mapping logic | Plan |
| Delete confirmation | `MatDialog` naming the specific alert, warn-colored confirm, Cancel focused | FR-007 calls deletion permanent; matches M3 destructive-action guidance | Plan |
| Route shape | `PUT`/`DELETE /api/alerts/:id`, full-replace semantics | The form always submits the complete object; matches `POST`'s validation exactly | Plan |
| `direction` field for S-05 | Not added now — deferred to S-05 | `price_history` retains full history, so S-05 can backfill direction accurately later; adding it now pulls unbuilt `market_data`-lookup logic into this change | Plan |
| List update after edit/delete | In-place signal update, no refetch | Matches `create()`'s existing convention, avoids a network round trip | Plan |
| Post-action feedback | No snackbar — the list change is the feedback | Matches `create()`, avoids introducing `MatSnackBar` as a new UI primitive for marginal value | Plan |
| Scope | Single-alert actions only, no bulk edit/delete | FR-006/FR-007 describe single-alert operations; bulk adds unrequested UI complexity | Plan |

## Scope

**In scope:** `PUT`/`DELETE /api/alerts/:id`; `AlertsService.update()`/`delete()`; `AlertForm` edit mode; a new delete-confirmation dialog; `mat-action-row` wiring in `AlertList`; Polish translations for all new strings.

**Out of scope:** `direction`/threshold-crossing logic (S-05); current price/RSI display (S-04); notifications/trigger history (S-05/S-06); bulk actions; toast/snackbar feedback; `PATCH`/partial updates.

## Architecture / Approach

Same layering as S-02: Hono route handlers reuse the existing validation helpers and UNIQUE/CHECK error-mapping pattern; `AlertsService` gains two methods following `create()`'s signal-update convention; the UI reuses `AlertForm` for edit (one new `MAT_DIALOG_DATA` branch) and adds one small new component (`DeleteAlertConfirm`) for the delete confirmation. Both actions surface from a single `mat-action-row` added to `AlertList`'s existing expansion panels.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend — PUT/DELETE endpoints | `PUT`/`DELETE /api/alerts/:id`, scoped + tested | 404-vs-403 scoping bug would leak/allow cross-user edits |
| 2. Frontend — service methods | `AlertsService.update()`/`delete()` | Low — small, no UI surface yet |
| 3. Frontend — edit flow | Dual-mode `AlertForm`, edit trigger | Form pre-fill wiped by existing reset subscriptions (see Critical Implementation Details) |
| 4. Frontend — delete flow | Confirmation dialog, delete trigger | i18n build gate (`i18nMissingTranslation: "error"`) if Polish translations are skipped |

**Prerequisites:** S-02 (alert-crud) shipped and deployed — confirmed done.
**Estimated effort:** ~1 session across 4 phases; no new external dependencies or migrations.

## Open Risks & Assumptions

- Assumes SQLite's `UPDATE` uniqueness check excludes the row's own pre-update values when evaluating the `(user_id, instrument, alert_type, threshold)` constraint — standard SQLite behavior, not separately verified against D1's specific engine version before implementation.
- The edit dialog's stale-alert 404 handling (alert deleted in another tab while being edited) is a low-probability race for this single-user-per-session product; the plan handles it via the existing error-mapping path rather than a dedicated UX.

## Success Criteria (Summary)

- A user can edit any field of an existing alert and see the change reflected immediately, with the same validation as creation.
- A user can permanently delete an alert only after an explicit, specific confirmation, and the deletion persists.
- Neither action affects another user's alerts (enforced at the route level, covered by automated isolation tests).
