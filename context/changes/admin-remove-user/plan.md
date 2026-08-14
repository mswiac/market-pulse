# Admin can remove a user — Implementation Plan

## Overview

Adds a fourth admin-panel action: an admin picks an existing user from a searchable email dropdown (the admin's own account is excluded), sees an impact summary (how many alerts and trigger-history entries belong to that user), confirms in a dialog, and the account — plus its sessions, alerts, and trigger history — is permanently deleted. Unlike S-11 (`admin-remove-instrument`), no manual multi-table cascade is needed: `sessions`, `alerts`, and `trigger_events` all declare real `REFERENCES users(id) ON DELETE CASCADE` constraints, and D1 enforces foreign keys by default, so a single `DELETE FROM users WHERE id = ?` does the whole cascade atomically. Self-deletion is blocked outright, both by excluding the admin's own row from the picker and by a server-side guard on the delete endpoint.

## Current State Analysis

- `users.id` is referenced with `ON DELETE CASCADE` from `sessions` (`migrations/0004_sessions_cascade_delete.sql:3`), `alerts` (`migrations/0008_instrument_registry.sql:32`, carried forward by `migrations/0011_alert_notifications.sql:13`), and `trigger_events` (`migrations/0011_alert_notifications.sql:74`). Empirically verified against local D1 in this planning session: `PRAGMA foreign_keys` returns `1`, and a `DELETE FROM users WHERE ...` on a row with a dependent `sessions` row cascaded correctly with no application-level cleanup. This is the opposite situation from S-11, where `instruments.ticker` has no FK anywhere and the delete endpoint had to run an explicit 4-statement `batch()`.
- No user-listing or user-lookup capability exists anywhere in the codebase yet — `grep` for `*user*` under `src/app/` returns nothing, and the only existing `SELECT ... FROM users` queries are `auth.ts:85` (by email, for login) and `auth.ts:112` (by id, for session resolution). This admin action is the first place a user needs to be looked up by an admin rather than resolved from their own session.
- `src/worker/routes/admin.ts:196-241` (`GET /instruments/:ticker/impact`, `DELETE /instruments/:ticker`, added by S-11) is the direct pattern to extend: same router (`adminRoutes`, gated by `sessionMiddleware`+`adminMiddleware` at `admin.ts:17`), same `{error, code}` response shape, same impact-preview-then-delete two-call flow from the frontend.
- `src/worker/lib/admin.ts`'s `adminMiddleware` already resolves the current admin's `userId` from the session (`c.get('userId')`, set by `sessionMiddleware`) before checking `ADMIN_EMAILS` — the same `userId` is available in every route handler on this router and is exactly what's needed to exclude the admin's own account from the user list and to block self-delete. `c.get('userId')` is typed `number` (`admin.ts:13`), while any `c.req.param(...)` is always a `string` — `alerts.ts:235-238`'s `parseAlertId` helper (`Number(idParam)` + `Number.isInteger` guard) is the established pattern for turning a numeric path param into a comparable/queryable `number`, and this plan's `/users/:id` routes need the same treatment (`parseUserId`) to avoid a string-vs-number comparison bug in the self-delete guard (see Phase 1, flagged during plan review as F1).
- `src/app/features/admin/remove-instrument/remove-instrument.ts` and `.html` are the page-structure pattern to mirror, minus the type-filter level (users have no "type" dimension, just a flat searchable list) — picker signal, `onSubmit()` → impact call → confirm dialog → delete call → reload-and-reset flow, error-code-to-message mapping.
- `src/app/features/admin/remove-instrument-confirm/` is the dialog-component pattern to mirror exactly: a dumb component rendering `MAT_DIALOG_DATA`, Cancel/`color="warn"` Confirm buttons.
- `src/app/features/admin/admin-panel.service.ts` is where the new HTTP methods live — same file, same `AdminService`, no new service needed (mirrors how S-11 added its methods to the existing service rather than creating a new one).
- `src/app/core/shell/shell.html:64-80` has three nested links under the "Admin" toggle, ordered alphabetically by Polish label: "Dodaj instrument", "Pobierz dane giełdowe", "Usuń instrument". A new "Usuń użytkownika" link sorts last (comparing "Usuń instrument" vs "Usuń użytkownika": "i" < "u" at the first differing character).
- `src/app/app.routes.ts:20-34` has three `admin/*` child routes, all gated by `adminGuard`, following an identical `loadComponent`/`canActivate` shape.

## Desired End State

An admin opens `/admin/remove-user`, picks a user by email from a searchable dropdown that never lists their own account, and clicks "Remove". The app calls the impact-preview endpoint and opens a confirmation dialog showing the user's email and how many alerts and trigger-history entries will be deleted. On confirm, the app calls the delete endpoint, which deletes the `users` row (cascading to `sessions`, `alerts`, `trigger_events` at the DB level) and returns the final counts. A success snackbar shows those counts, and the picker's user list is refetched so the removed account disappears immediately. Attempting to reach the admin's own account through this flow is impossible from the UI (excluded from the list) and rejected by the API if attempted directly (`cannot_delete_self`).

Verify by: `npm run ci` passes; as an admin, removing a user with 2 alerts and 1 trigger-history entry shows "2 alert(s)" and "1 trigger event(s)" in the confirmation dialog, and after confirming, that user can no longer log in (account gone), a direct `DELETE /api/admin/users/:id` call with the admin's own id returns 403 `cannot_delete_self`, and the admin's own session is unaffected throughout.

### Key Discoveries:

- `PRAGMA foreign_keys` is `1` on local D1 and the `ON DELETE CASCADE` constraints on `sessions`/`alerts`/`trigger_events` actually fire — confirmed by direct `wrangler d1 execute --local` testing during planning, not just assumed from the schema. This means the delete endpoint is a single statement, not a `batch()`.
- `adminMiddleware` (`src/worker/lib/admin.ts:14-23`) already puts `userId` in context before any route handler runs — self-exclusion/self-delete-blocking needs no extra lookup, just a comparison against `c.get('userId')`.
- There is no existing "users" concept on the frontend at all (no service, no interface, no page) — this plan introduces the first one, scoped narrowly to what the remove-user picker needs (id + email), not a general-purpose user-management feature.

## What We're NOT Doing

- Not building a general "browse all users" page or table — the picker is a searchable dropdown scoped to this one action, matching the roadmap's "Remove user tab" framing, not a user-management feature.
- Not showing alert counts (or any other per-user detail) inline in the picker dropdown — it lists email only; the impact-preview call surfaces counts right before the confirmation dialog instead.
- Not allowing self-deletion under any circumstance, and not adding a way to override the block — the admin's own row is excluded from the picker's list, and the delete endpoint independently rejects a self-targeted id.
- Not requiring the admin to type the target user's email as a typed-confirmation safeguard — the existing Confirm/Cancel dialog pattern from S-11 is reused as-is.
- Not sending any notification (email or otherwise) to the user whose account is deleted.
- Not adding a soft-delete, undo, or grace period — deletion is immediate and permanent, same as S-11.
- Not changing the `users`/`sessions`/`alerts`/`trigger_events` schema — no migration needed, the existing FK constraints already provide the cascade.

## Implementation Approach

Backend first (Phase 1: list + impact + delete endpoints, since impact and delete share the same count queries), then the reusable frontend pieces (Phase 2: service methods + confirmation dialog), then the page itself (Phase 3), then routing/nav/i18n last to make it reachable (Phase 4) — identical ordering to S-11.

## Critical Implementation Details

**D1's FK-cascade behavior was verified empirically, not assumed.** S-11's plan documented that `instruments.ticker` has no FK constraint anywhere, which could easily be misread as "D1 doesn't enforce foreign keys." That finding was scoped to `instruments` specifically — it has no `REFERENCES` clause to begin with, regardless of pragma state. For `users.id`, real `REFERENCES users(id) ON DELETE CASCADE` constraints exist on `sessions`, `alerts`, and `trigger_events`, and this planning session confirmed directly against local D1 (`PRAGMA foreign_keys` → `1`; a test insert+delete showed the cascade firing) that these constraints are live. The delete endpoint can therefore be a single `DELETE FROM users WHERE id = ?` — implementing a manual multi-table `batch()` here (copying S-11's shape without checking whether it's needed) would be redundant. Phase 1's manual verification step re-confirms this against local D1 one more time as a safety net before shipping; remote D1 is assumed to behave identically (same SQLite engine, no evidence otherwise) rather than separately verified.

## Phase 1: Backend endpoints

### Overview

Three new admin-only routes on the existing `adminRoutes` router: a user list (for the picker), a read-only impact preview, and the cascading delete.

### Changes Required:

#### 1. `GET /users`

**File**: `src/worker/routes/admin.ts`

**Intent**: Returns every user except the currently logged-in admin, so the frontend picker never offers a self-targeting option. Ordered by email for a stable, alphabetically-sensible dropdown.

**Contract**: `GET /api/admin/users` → `200 { users: Array<{ id: number; email: string }> }`. Query: `SELECT id, email FROM users WHERE id != ? ORDER BY email` bound to `c.get('userId')`.

#### 2. `GET /users/:id/impact`

**File**: `src/worker/routes/admin.ts`

**Intent**: Returns how many `alerts` and `trigger_events` rows belong to the given user, so the frontend can show the blast radius before the admin confirms. Parses and validates `:id` first, then looks up the user (404 if it doesn't exist).

**Contract**: `GET /api/admin/users/:id/impact` → `200 { id, email, alertsCount, triggerEventsCount }`. `:id` is parsed via a `parseUserId(idParam: string): number | null` helper mirroring `alerts.ts:235-238`'s `parseAlertId` (`Number(idParam)` + `Number.isInteger` guard) — 400 `{ error: 'invalid user id', code: 'invalid_user_id' }` if parsing fails, checked before any DB lookup. 404 `{ error: 'unknown user', code: 'unknown_user' }` if the parsed id isn't in `users`. `alertsCount`/`triggerEventsCount` from `SELECT COUNT(*) AS count FROM alerts WHERE user_id = ?` / `... FROM trigger_events WHERE user_id = ?`.

#### 3. `DELETE /users/:id`

**File**: `src/worker/routes/admin.ts`

**Intent**: Deletes the `users` row for the given id, relying on the existing `ON DELETE CASCADE` constraints (see Critical Implementation Details) to remove dependent `sessions`/`alerts`/`trigger_events` rows. Blocks deleting the requesting admin's own account. Counts alerts and trigger events immediately before the delete so the response reports exactly what was removed.

**Contract**: `DELETE /api/admin/users/:id` → `200 { id, email, alertsDeleted, triggerEventsDeleted }`. `:id` is parsed via the same `parseUserId` helper as the impact endpoint — 400 `{ error: 'invalid user id', code: 'invalid_user_id' }` if parsing fails. **Plan-review fix (F1)**: `c.req.param('id')` is always a `string`, while `c.get('userId')` (set by `sessionMiddleware`) is a `number` (`Variables = { userId: number }`, `admin.ts:13`) — the self-delete check must compare the *parsed* numeric id against `c.get('userId')`, not the raw string, or `id === c.get('userId')` silently never matches and the guard never fires. 403 `{ error: 'cannot delete your own account', code: 'cannot_delete_self' }` if the parsed `id === c.get('userId')`, checked before the existence lookup. 404 `{ error: 'unknown user', code: 'unknown_user' }` if the parsed id isn't in `users`. On success: `SELECT COUNT(*) ...` for both tables, then `DELETE FROM users WHERE id = ?` (single statement — no `batch()` needed, see Critical Implementation Details).

#### 4. Tests

**File**: `test/worker/admin.test.ts`

**Intent**: New `describe('GET /api/admin/users', ...)`, `describe('GET /api/admin/users/:id/impact', ...)`, and `describe('DELETE /api/admin/users/:id', ...)` blocks, reusing `registerAndLogIn`/`logInAsAdmin`/`getUserId`/`insertAlert` helpers already in this file, adding a small `insertTriggerEvent`-style helper if one doesn't already exist for seeding `trigger_events` rows directly via `DB.prepare(...).run()`.

**Contract**: Cover for all three routes: 401 with no session, 403 non-admin. For list: 200 excludes the admin's own row, includes other registered users. For impact: 400 `invalid_user_id` for a non-numeric id, 404 for an unknown (but numeric) id, 200 with zero counts for a user with no alerts/trigger events, and correct non-zero counts after seeding both. For delete: 400 `invalid_user_id` for a non-numeric id, 403 `cannot_delete_self` when the admin targets their own id (this test is the concrete regression guard for the F1 plan-review fix — it must actually invoke the route with the admin's own numeric id, not just unit-test a helper in isolation), 404 for an unknown id, successful 200 for another user — verify afterward (via direct `DB.prepare('SELECT ...')` checks) that the `users` row, their `sessions` row(s), `alerts` rows, and `trigger_events` rows are all gone, and that the admin's own `users`/`sessions` rows are untouched.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including the new `admin.test.ts` blocks
- `npm run typecheck` passes

#### Manual Verification:

- Manually call all three new endpoints via `curl` with an admin session cookie against local D1 and confirm the response shapes, that self-delete is rejected, and that dependent rows are actually gone after a real delete

---

## Phase 2: Frontend service methods + confirmation dialog

### Overview

Adds the three HTTP calls to `AdminService` and a new dialog component mirroring `remove-instrument-confirm`.

### Changes Required:

#### 1. `AdminService` methods

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Add `listUsers()`, `getUserImpact(id)`, and `removeUser(id)`, following the existing methods' shape.

**Contract**: `listUsers(): Observable<{id: number; email: string}[]>` → `GET /api/admin/users`, unwrapping the `{users: [...]}` envelope. `getUserImpact(id: number): Observable<{id: number; email: string; alertsCount: number; triggerEventsCount: number}>` → `GET /api/admin/users/${id}/impact`. `removeUser(id: number): Observable<{id: number; email: string; alertsDeleted: number; triggerEventsDeleted: number}>` → `DELETE /api/admin/users/${id}`.

#### 2. Confirmation dialog component

**Files**: `src/app/features/admin/remove-user-confirm/remove-user-confirm.ts` (new), `.html` (new)

**Intent**: Mirrors `remove-instrument-confirm.ts`/`.html` exactly — a dumb dialog component rendering pre-fetched data via `MAT_DIALOG_DATA` with Cancel/Confirm buttons.

**Contract**: `RemoveUserConfirmData { email: string; alertsCount: number; triggerEventsCount: number }`. Dialog body states the target email and, if `alertsCount > 0`, that N alert(s) will be deleted; if `triggerEventsCount > 0`, that N trigger-history entries will be deleted. Confirm button `color="warn"`, same as `removeInstrumentConfirm.html`.

#### 3. Translation catalog (dialog strings)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add `<trans-unit>` entries for every `@@id` introduced by the dialog component in this phase. Placed next to the existing `removeInstrumentConfirm.*` block (`messages.pl.xlf:521-548`).

**Contract**: Polish translations following the file's existing tone: dialog title → "Usunąć tego użytkownika?", confirm button → "Usuń" (matching `removeInstrumentConfirm.confirm`), cancel button → "Anuluj".

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` passes (validates the new dialog's translation ids — same caveat as S-11's Critical Implementation Details: this only fully validates once the component is routed in Phase 4)

#### Manual Verification:

- None yet — this component isn't wired into a page until Phase 3

---

## Phase 3: Remove-user page

### Overview

The user-facing feature: a new page component wiring the email picker to the impact call, the confirmation dialog, and the delete call.

### Changes Required:

#### 1. New page component

**Files**: `src/app/features/admin/remove-user/remove-user.ts` (new), `.html` (new), `.scss` (new)

**Intent**: Structurally mirrors `remove-instrument.ts`, minus the type-filter level — a single `mat-select` (or an autocomplete input, if a plain `mat-select` proves unwieldy once real user counts exist; `mat-select` is sufficient and consistent with the rest of the admin panel for now) populated by `adminService.listUsers()` fetched in the constructor into a local signal, sorted by email. `onSubmit()` calls `adminService.getUserImpact(selectedUserId())`, opens `RemoveUserConfirm` with the returned `{email, alertsCount, triggerEventsCount}`, and on `afterClosed()` returning `true`, calls `adminService.removeUser(selectedUserId())`. On success: refetch the user list (removes the deleted user from the dropdown), reset selection to the new first user (or empty state if none remain), show a success snackbar with the deleted counts. On error (from either call): same code→message-lookup pattern as `remove-instrument.ts`, covering `unknown_user`/`cannot_delete_self`/`forbidden`/generic.

**Contract**: `.scss` mirrors `remove-instrument.scss`'s page-wrapper/card layout. Template: single `mat-select` for the user, a "Remove" button disabled until a user is selected or while a request is in flight, disabled entirely (with an inline message) when the fetched user list is empty. New i18n ids under a `removeUser.*` prefix. `MatDialogModule` added to this component's `imports`.

#### 2. Translation catalog (page strings)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add `<trans-unit>` entries for every `removeUser.*` `@@id` introduced by the new page. Placed next to the existing `removeInstrument.*` block (`messages.pl.xlf:365-400`).

**Contract**: Polish translations following the file's existing tone: page title → "Usuń użytkownika", field label → "Użytkownik" (matching `removeInstrument.instrument.label`'s style), submit button → "Usuń", success message, and error messages for `unknown_user`/`cannot_delete_self`/`forbidden`/generic.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` passes (validates the new `removeUser.*` ids have matching translations — same routed-component caveat as Phase 2)

#### Manual Verification:

- None yet — page isn't reachable until Phase 4 adds routing

---

## Phase 4: Routing, nav, and i18n

### Overview

Makes the new page reachable. Translation catalog entries for the dialog and page were already added in Phases 2 and 3 respectively — this phase only adds the sidebar-link's own id.

### Changes Required:

#### 1. Route registration

**File**: `src/app/app.routes.ts`

**Intent**: Register `/admin/remove-user` as a fourth sibling under the `admin` children array, gated by `adminGuard`, following the exact shape of the existing three `admin/*` entries.

**Contract**: `{ path: 'admin/remove-user', loadComponent: () => import('./features/admin/remove-user/remove-user').then((m) => m.RemoveUser), canActivate: [adminGuard] }`.

#### 2. Sidebar nav

**File**: `src/app/core/shell/shell.html`

**Intent**: Add a fourth nested link inside the existing `@if (adminExpanded())` block (`shell.html:64-80`), positioned last since "Usuń użytkownika" sorts alphabetically after "Usuń instrument" per the existing Polish-label ordering convention.

**Contract**: `<a mat-list-item class="nested-item" routerLink="/admin/remove-user" routerLinkActive="active-link"><span matListItemTitle i18n="@@shell.nav.adminRemoveUser">Remove user</span></a>`.

#### 3. Translation catalog (nav link)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add the single `<trans-unit>` for `shell.nav.adminRemoveUser` — the only new id this phase introduces. Placed next to the existing `shell.nav.adminRemoveInstrument` entry (`messages.pl.xlf:221-224`).

**Contract**: "Remove user" → "Usuń użytkownika", matching the page title already set in Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm run ci` passes (typecheck + `test:worker` + build, which validates the full i18n catalog)

#### Manual Verification:

- As a logged-in admin, open `/admin/remove-user`, confirm the admin's own account is not in the dropdown
- Remove a user with 0 alerts and 0 trigger events, confirm a success snackbar with "0 alert(s)"/"0 trigger event(s)" (or equivalent phrasing) appears
- Create a test user, add 2 alerts and trigger a couple of alerts to generate `trigger_events` rows for them, then remove that user as admin — confirm the confirmation dialog states the correct counts before confirming, and after confirming that user can no longer log in
- Attempt `DELETE /api/admin/users/:id` (via `curl`) with the admin's own id and confirm it's rejected with `cannot_delete_self`, and that the admin's own session/account is unaffected
- Attempt to remove a user as a non-admin (or navigate directly to the URL) and confirm access remains blocked, unchanged from S-09/S-10/S-11
- Cancel the confirmation dialog and confirm the user is NOT deleted
- Confirm the Polish (`development-pl`) build renders all new strings correctly, not raw `@@id`s or English fallbacks

---

## Testing Strategy

### Unit Tests:

- Backend: `test/worker/admin.test.ts` covers all three new endpoints' validation, success, 403/404, self-delete-block, and cascade-correctness paths (Phase 1).

### Integration Tests:

- Phase 1 tests run against the real D1 test binding end-to-end (this repo's `@cloudflare/vitest-pool-workers` convention), so no separate integration layer is needed.

### Manual Testing Steps:

1. Remove a user with no dependent alerts or trigger events — confirm the simple path works end to end.
2. Remove a user with alerts and trigger history — confirm the impact counts are accurate and all those rows are actually gone afterward (verify the deleted user can no longer log in).
3. Attempt to delete the admin's own account directly via the API — confirm it's rejected and nothing is deleted.
4. Confirm the Polish (`development-pl`) build renders all new strings correctly.
5. Cancel out of the confirmation dialog and confirm no state changed.

## Migration Notes

None — no schema changes. This plan only adds application-level `SELECT`/`DELETE` statements against existing tables, relying on FK constraints that already exist.

## References

- Prior plan for the sibling admin feature: `context/archive/2026-08-14-admin-remove-instrument/plan.md`
- Existing admin-route pattern: `src/worker/routes/admin.ts:196-241`
- Existing confirmation-dialog pattern: `src/app/features/admin/remove-instrument-confirm/`
- Roadmap outcome (source of truth for scope): `context/foundation/roadmap.md`, `S-12` section

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend endpoints

#### Automated

- [x] 1.1 `npm run test:worker` passes, including new `admin.test.ts` blocks — eb72a61
- [x] 1.2 `npm run typecheck` passes — eb72a61

#### Manual

- [ ] 1.3 Manual `curl` calls to all three endpoints confirm response shapes, self-delete rejection, and cascade cleanup

### Phase 2: Frontend service methods + confirmation dialog

#### Automated

- [x] 2.1 `npm run typecheck` passes — da4a327
- [x] 2.2 `npm run build` passes (dialog i18n ids) — da4a327

### Phase 3: Remove-user page

#### Automated

- [x] 3.1 `npm run typecheck` passes
- [x] 3.2 `npm run build` passes (page i18n ids — see Critical Implementation Details in S-11's plan for why this doesn't fully validate until Phase 4)

### Phase 4: Routing, nav, and i18n

#### Automated

- [ ] 4.1 `npm run ci` passes

#### Manual

- [ ] 4.2 Admin's own account excluded from the picker
- [ ] 4.3 Remove a user with 0 alerts/trigger events, success snackbar shown
- [ ] 4.4 Remove a user with alerts and trigger history, dialog shows correct counts, rows gone afterward
- [ ] 4.5 Self-delete via direct API call rejected with `cannot_delete_self`
- [ ] 4.6 Non-admin access remains blocked
- [ ] 4.7 Canceling the confirmation dialog leaves the user untouched
- [ ] 4.8 Polish translations render correctly
