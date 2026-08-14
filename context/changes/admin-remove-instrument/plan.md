# Admin can remove an instrument from the registry — Implementation Plan

## Overview

Adds a third admin-panel action: an admin picks an existing instrument (type→ticker two-combobox, same pattern as `admin-panel.ts`'s market-data fetch), sees an impact summary (how many alerts across all users reference this ticker), confirms in a dialog, and the instrument — plus its alerts, price history, and market data — is permanently deleted. `trigger_events` rows are left untouched (they already tolerate a missing instrument). No user is notified when their alert is cascade-deleted.

## Current State Analysis

- `instruments.ticker` (`migrations/0014_instrument_registry_extended_types.sql:21-28`, `0015_instruments_suffix.sql:9`) has no FK constraints from any table. `price_history.ticker`, `market_data.ticker` (PK), `alerts.ticker`, and `trigger_events.ticker` are all plain `TEXT` join keys, and D1 never sets `PRAGMA foreign_keys = ON`, so nothing cascades automatically at the DB level.
- `trigger_events` already tolerates a missing `instruments` row: `src/worker/routes/trigger-events.ts:48-53` does `LEFT JOIN instruments i ON i.ticker = te.ticker` with `COALESCE(i.name, te.ticker)` — no code change needed there.
- `src/worker/routes/alerts.ts:172-175` (`ALERT_SELECT`) uses an inner `JOIN instruments i ON i.ticker = a.ticker` — if an instrument were deleted while alerts still reference it, those alerts would silently vanish from `GET /alerts` without being deleted. This plan avoids that state entirely by always cascade-deleting matching `alerts` rows in the same atomic operation as the `instruments` delete.
- `src/worker/routes/admin.ts:139-194` (`POST /instruments`, added by `admin-add-instrument`) is the pattern to extend: router-level `sessionMiddleware`+`adminMiddleware` (`admin.ts:17`), `{error, code}` JSON responses, `err.message.includes('UNIQUE')` → 409 for constraint violations.
- No delete endpoint with dependent-row cleanup exists anywhere in the codebase yet. The closest precedent is `alerts.ts:288-305` (`DELETE /:id`, single-table, no dependents) and the atomic multi-statement pattern in `alerts.ts:204-211` (`c.env.DB.batch([...])`, used because `RETURNING` can't reference joined tables and a non-atomic write+re-read window is unacceptable).
- `src/app/features/admin/admin-panel.ts:50-96` implements the type→ticker two-combobox against *currently loaded* instruments (`instrumentsService.types()` / `.instruments()`), not the creatable-types list (`instrument-types.ts`'s `CREATABLE_INSTRUMENT_TYPES`, which is for the add-instrument form only). This is the exact picker pattern S-11 needs, since you can only remove an instrument that already exists.
- `src/app/features/alerts/delete-alert-confirm/delete-alert-confirm.ts`+`.html` is the established confirmation-dialog pattern: `MatDialogModule`, data passed in via `MAT_DIALOG_DATA`, opened with `dialog.open(Component, { data }).afterClosed().subscribe(confirmed => ...)` (`alert-list.ts:89-105`).
- `src/app/features/instrument-history/instrument-history.service.ts:25` shows the required `encodeURIComponent(ticker)` convention for ticker-keyed URL segments — tickers like `^VIX` contain characters that must be encoded.
- `src/app/features/instruments/instruments.service.ts:48-52` (`reload()`) is the existing cache-invalidation method, already used by `add-instrument.ts:115` after a successful write; the remove flow calls the same method after a successful delete.
- Admin sidebar nav (`src/app/core/shell/shell.html:64-77`) has two nested links under the "Admin" toggle, ordered alphabetically by their **Polish** label: "Dodaj instrument" (Add instrument), "Pobierz dane giełdowe" (Fetch market data). A new "Usuń instrument" (Remove instrument) link sorts last of the three.

## Desired End State

An admin opens `/admin/remove-instrument`, picks a type then an existing instrument from the same two-combobox pattern used elsewhere, and clicks "Remove". The app calls the impact-preview endpoint and opens a confirmation dialog showing the ticker and how many alerts (across all users) will be deleted. On confirm, the app calls the delete endpoint, which atomically removes the `alerts`, `price_history`, and `market_data` rows for that ticker along with the `instruments` row itself, and shows a success snackbar with the final alert count. `instrumentsService.reload()` runs afterward so the ticker immediately disappears from every other combobox in the app (alert form, instrument history, the other two admin pages) without a page refresh. `trigger_events` rows for the ticker remain, now showing the bare ticker instead of a resolved name (already-supported fallback). No email is sent to affected users.

Verify by: `npm run ci` passes; as an admin, removing an instrument with 2 existing alerts (from different users) shows "This will delete 2 alert(s)" in the confirmation dialog, and after confirming, `GET /api/instruments` no longer includes the ticker, `GET /alerts` for either affected user no longer includes those alerts, and `GET /api/trigger-events` (if either user has trigger history for that ticker) still returns those rows with the bare ticker as the displayed name.

### Key Discoveries:

- `admin-panel.ts`'s combobox reads from `instrumentsService.types()`/`.instruments()` (loaded data), not `CREATABLE_INSTRUMENT_TYPES` — the remove page must do the same, since `pl_stock`/`us_stock` types only exist in the combobox once an instrument of that type has actually been added.
- `DeleteAlertConfirmData` is a plain interface with pre-fetched fields, populated by the caller before `dialog.open(...)` — the remove-instrument dialog follows the same shape: an `alertsCount` field fetched via a preceding HTTP call, not fetched inside the dialog component itself.
- `admin.ts`'s existing `POST /instruments` already defines `VALID_INSTRUMENT_TYPES`/`CURRENCY_PATTERN` at module scope (`admin.ts:10-11`) — the new handlers live in the same file and can reuse the existing `adminRoutes` instance without new middleware wiring.

## What We're NOT Doing

- Not protecting `type='index'` instruments (`^VIX`/`^NDX`) from removal — the endpoint treats all types identically, matching the existing "admin is trusted" contract already accepted for `POST /instruments`.
- Not sending an email (or any other notification) to users whose alerts get cascade-deleted.
- Not touching `trigger_events` — its rows are left in place, already rendering correctly via the existing `LEFT JOIN` + `COALESCE` fallback.
- Not adding a pre-delete lock or optimistic-concurrency check between the impact-preview call and the delete call — a race where an alert is added in between is an acceptable, rare edge case for a low-frequency admin-only action, not worth the added complexity.
- Not guarding against the cron job (`src/worker/scheduled.ts:39-75`) resurrecting `price_history`/`market_data` rows if a `DELETE` completes while a cron run is already mid-flight for that same ticker (the cron loop snapshots the instrument list once at the start and doesn't re-check existence before writing). Accepted as a narrow, self-limiting race — the next day's cron run no longer includes the deleted ticker — not worth adding a re-check for a rare admin action colliding with a once-daily job.
- Not building instrument edit — this plan is remove-only, matching the roadmap's S-11 scope.

## Implementation Approach

Backend first (Phase 1: both new endpoints, since the delete endpoint's cascade logic and the impact endpoint's count query share the same `alerts WHERE ticker = ?` shape), then the reusable frontend pieces the page depends on (Phase 2: service methods + confirmation dialog), then the page itself (Phase 3), then routing/nav/i18n wiring last since it's what makes the page reachable (Phase 4).

## Critical Implementation Details

**`npm run build`'s i18n check only covers components reachable from a route — not everything in `src/`.** Discovered during implementation of Phases 2–3: Angular's esbuild-based application builder (unlike the older webpack/ivy AOT builder) only compiles the import graph actually reachable from `main.ts`/the app's routes, not every file matched by `tsconfig`'s `include`. Verified empirically by deliberately removing a `removeInstrument.*` `<trans-unit>` and re-running `npm run build` — it still passed with exit 0, because `RemoveInstrumentConfirm`/`RemoveInstrument` weren't routed yet. This means Phase 2's and Phase 3's "`npm run build` passes" checks did NOT actually validate those phases' new translation ids — only `npm run typecheck` (TypeScript-level correctness) was a genuine per-phase gate for them. The real i18n completeness check for every id introduced in this plan only happens once Phase 4 registers the route and `npm run ci` runs against a build where the page is actually reachable. Kept as informational rather than restructured — the ids were written carefully and cross-checked against existing translations during Phases 2–3, and Phase 4's `npm run ci` remains the authoritative final gate regardless.

## Phase 1: Backend endpoints

### Overview

Two new admin-only routes on the existing `adminRoutes` router: a read-only impact preview and the actual cascading delete.

### Changes Required:

#### 1. `GET /instruments/:ticker/impact`

**File**: `src/worker/routes/admin.ts`

**Intent**: Returns how many `alerts` rows reference the given ticker, so the frontend can show the blast radius before the admin confirms. Looks up the instrument first (404 if it doesn't exist, matching the `unknown_instrument` code already used by `POST /market-data`), then counts alerts.

**Contract**: `GET /api/admin/instruments/:ticker/impact` → `200 { ticker, alertsCount }`. 404 `{ error: 'unknown instrument', code: 'unknown_instrument' }` if the ticker isn't in `instruments`. `alertsCount` from `SELECT COUNT(*) AS count FROM alerts WHERE ticker = ?`.

#### 2. `DELETE /instruments/:ticker`

**File**: `src/worker/routes/admin.ts`

**Intent**: Atomically deletes the `alerts`, `price_history`, and `market_data` rows for the ticker, then the `instruments` row itself, via `c.env.DB.batch([...])` (same atomicity pattern as `alerts.ts:204-211` — a partial cascade would leave the registry row gone but alerts/history intact, or vice versa). Looks up the instrument first (same `unknown_instrument` 404 as above) and counts alerts in the same round trip so the response can report how many were actually deleted, independent of whatever the earlier impact call showed (which may be stale by the time delete runs).

**Contract**: `DELETE /api/admin/instruments/:ticker` → `200 { ticker, alertsDeleted }`. 404 `{ error: 'unknown instrument', code: 'unknown_instrument' }`. Batch order: count alerts, then `DELETE FROM alerts WHERE ticker = ?`, `DELETE FROM price_history WHERE ticker = ?`, `DELETE FROM market_data WHERE ticker = ?`, `DELETE FROM instruments WHERE ticker = ?` — the count and the deletes run in the same `batch()` call so the reported `alertsDeleted` matches exactly what was removed.

#### 3. Tests

**File**: `test/worker/admin.test.ts`

**Intent**: New `describe('GET /api/admin/instruments/:ticker/impact', ...)` and `describe('DELETE /api/admin/instruments/:ticker', ...)` blocks, reusing `registerAndLogIn`/`logInAsAdmin`/`addInstrument` helpers already in this file.

**Contract**: Cover for both routes: 401 with no session, 403 non-admin, 404 for an unknown ticker. For impact: 200 with `alertsCount: 0` for an instrument with no alerts, and a correct non-zero count after creating alerts (via direct `DB.prepare(...).run()` in the test, or via the alerts API if a logged-in non-admin user is easy to set up) referencing that ticker. For delete: successful 200 removes the row from a subsequent `GET /api/instruments`; alerts, price_history, and market_data rows for that ticker are gone afterward (verify via direct `DB.prepare('SELECT ...')` checks); a `trigger_events` row for that ticker (if seeded) still exists after the delete, unmodified.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including the new `admin.test.ts` blocks
- `npm run typecheck` passes

#### Manual Verification:

- Manually call both new endpoints via `curl` with an admin session cookie against local D1 and confirm the response shapes and that dependent rows are actually gone after the delete

---

## Phase 2: Frontend service methods + confirmation dialog

### Overview

Adds the two HTTP calls to `AdminService` and a new dialog component mirroring `delete-alert-confirm`.

### Changes Required:

#### 1. `AdminService` methods

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Add `getInstrumentImpact(ticker)` and `removeInstrument(ticker)`, following the existing methods' shape. Both URL-encode the ticker per the `instrument-history.service.ts:25` convention.

**Contract**: `getInstrumentImpact(ticker: string): Observable<{ticker: string; alertsCount: number}>` → `GET /api/admin/instruments/${encodeURIComponent(ticker)}/impact`. `removeInstrument(ticker: string): Observable<{ticker: string; alertsDeleted: number}>` → `DELETE /api/admin/instruments/${encodeURIComponent(ticker)}`.

#### 2. Confirmation dialog component

**Files**: `src/app/features/admin/remove-instrument-confirm/remove-instrument-confirm.ts` (new), `.html` (new), `.scss` (new, if needed for spacing — otherwise omit and rely on Material defaults like `delete-alert-confirm.scss` does)

**Intent**: Mirrors `delete-alert-confirm.ts` exactly — a dumb dialog component that renders pre-fetched data via `MAT_DIALOG_DATA` and offers Cancel/Confirm buttons, `[mat-dialog-close]="true"` on confirm.

**Contract**: `RemoveInstrumentConfirmData { ticker: string; alertsCount: number }`. Dialog body states the ticker and, if `alertsCount > 0`, that N alert(s) belonging to other users will also be deleted; also states that price and market history for the instrument will be deleted. Confirm button styled `color="warn"`, same as `delete-alert-confirm.html:23`.

#### 3. Translation catalog (dialog strings)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add `<trans-unit>` entries for every `@@id` introduced by the dialog component in this phase, so the phase's own build check is self-contained. Placed next to the existing `deleteAlertConfirm.*` block (`messages.pl.xlf:465-477`), matching the file's grouping-by-component convention.

**Contract**: Polish translations following the file's existing tone. Dialog title → "Usunąć ten instrument?", confirm button → "Usuń" (matching `deleteAlertConfirm.confirm`'s existing string), cancel button → "Anuluj" (matching `deleteAlertConfirm.cancel`), the alerts-impact sentence phrased to make clear the alerts belong to other users, not the admin's own.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` passes (validates the new `removeInstrumentConfirm.*` ids have matching translations)

#### Manual Verification:

- None yet — this component isn't wired into a page until Phase 3

---

## Phase 3: Remove-instrument page

### Overview

The user-facing feature: a new page component wiring the type→ticker picker to the impact call, the confirmation dialog, and the delete call.

### Changes Required:

#### 1. New page component

**Files**: `src/app/features/admin/remove-instrument/remove-instrument.ts` (new), `.html` (new), `.scss` (new)

**Intent**: Structurally mirrors `admin-panel.ts` for the picker (type→ticker signals + computed instrument list from `instrumentsService.types()`/`.instruments()`, `onTypeChange` defaulting to the first match) and `add-instrument.ts` for the submit/error/snackbar flow. `onSubmit()` calls `adminService.getInstrumentImpact(selectedTicker())`, then opens `RemoveInstrumentConfirm` with the returned `{ticker, alertsCount}`, and on `afterClosed()` returning `true`, calls `adminService.removeInstrument(selectedTicker())`. On success: call `instrumentsService.reload()`, reset the picker to the new first instrument (or empty state if none remain), show a success snackbar with `alertsDeleted`. On error (from either the impact call or the delete call): same code→message-lookup pattern as `admin-panel.ts`/`add-instrument.ts`, covering `unknown_instrument`/`forbidden`/generic.

**Contract**: `.scss` mirrors `admin-panel.scss`'s page-wrapper/card layout. Template: `mat-select` for type, `mat-select` for ticker (or reuse whatever control `admin-panel.html` uses for the instrument picker), a "Remove" button disabled until an instrument is selected or while a request is in flight, disabled entirely (with an inline message) when `instrumentsService.instruments()` is empty. New i18n ids under a `removeInstrument.*` prefix. `MatDialogModule` added to this component's `imports`.

#### 2. `MAT_DIALOG_DATA` message strings

**File**: `src/app/features/admin/remove-instrument-confirm/remove-instrument-confirm.html`

**Intent**: Finalize the dialog copy now that Phase 3 confirms exactly what data is passed in (covered by Phase 2's contract; listed here since the two files are edited together in practice).

**Contract**: No new contract beyond Phase 2's — implementation detail of wiring, not a separate interface.

#### 3. Translation catalog (page strings)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add `<trans-unit>` entries for every `removeInstrument.*` `@@id` introduced by the new page in this phase, so this phase's own build check is self-contained (same reasoning as Phase 2's step 3 — see `admin-add-instrument`'s plan for the same constraint on `i18nMissingTranslation: "error"`). Placed next to the existing `addInstrument.*` block (`messages.pl.xlf:289-357`).

**Contract**: Polish translations following the file's existing tone: page title → "Usuń instrument", field labels matching `addInstrument.*`'s style, submit button → "Usuń", success message, and error messages for `unknown_instrument`/`forbidden`/generic.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` passes (validates the new `removeInstrument.*` ids have matching translations)

#### Manual Verification:

- None yet — page isn't reachable until Phase 4 adds routing

---

## Phase 4: Routing, nav, and i18n

### Overview

Makes the new page reachable. Translation catalog entries for the dialog and page were already added in Phases 2 and 3 respectively — this phase only adds the sidebar-link's own id.

### Changes Required:

#### 1. Route registration

**File**: `src/app/app.routes.ts`

**Intent**: Register `/admin/remove-instrument` as a third sibling under the `admin` children array, gated by `adminGuard`, following the exact shape of the existing `admin`/`admin/add-instrument` entries.

**Contract**: `{ path: 'admin/remove-instrument', loadComponent: () => import('./features/admin/remove-instrument/remove-instrument').then((m) => m.RemoveInstrument), canActivate: [adminGuard] }`.

#### 2. Sidebar nav

**File**: `src/app/core/shell/shell.html`

**Intent**: Add a third nested link inside the existing `@if (adminExpanded())` block (`shell.html:64-77`), positioned last since "Usuń instrument" sorts alphabetically after "Dodaj instrument" and "Pobierz dane giełdowe" per the existing Polish-label ordering convention.

**Contract**: `<a mat-list-item class="nested-item" routerLink="/admin/remove-instrument" routerLinkActive="active-link"><span matListItemTitle i18n="@@shell.nav.adminRemoveInstrument">Remove instrument</span></a>`.

#### 3. Translation catalog (nav link)

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add the single `<trans-unit>` for `shell.nav.adminRemoveInstrument` — the only new id this phase introduces (the `removeInstrument.*` page ids and `removeInstrumentConfirm.*` dialog ids were already added in Phases 3 and 2 respectively). Placed next to the existing `shell.nav.adminAddInstrument`/`shell.nav.adminMarketData` entries (`messages.pl.xlf:213-220`).

**Contract**: "Remove instrument" → "Usuń instrument", matching the page title already set in Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm run ci` passes (typecheck + `test:worker` + build, which validates the full i18n catalog)

#### Manual Verification:

- As a logged-in admin, open `/admin/remove-instrument`, pick an instrument with 0 alerts, remove it, and confirm a success snackbar with "0 alerts deleted" (or equivalent phrasing) appears
- Create a test instrument, add 2 alerts to it from 2 different user accounts, then remove the instrument as admin — confirm the confirmation dialog states "2 alert(s)" before confirming, and after confirming both users' `GET /alerts` no longer include those alerts
- Confirm the removed ticker immediately disappears from the alert-creation form, instrument-history page, and the other two admin pages' comboboxes, without a page refresh
- If either test user has trigger history for the removed ticker, confirm `/history/triggers` for that user still shows those rows (with the bare ticker as the name) after the instrument is gone
- Attempt to remove an instrument as a non-admin (or navigate directly to the URL) and confirm access remains blocked, unchanged from S-09/S-10
- Cancel the confirmation dialog and confirm the instrument is NOT deleted

---

## Testing Strategy

### Unit Tests:

- Backend: `test/worker/admin.test.ts` covers both new endpoints' validation, success, 404, and cascade-correctness paths (Phase 1).

### Integration Tests:

- Phase 1 tests run against the real D1 test binding end-to-end (this repo's `@cloudflare/vitest-pool-workers` convention), so no separate integration layer is needed.

### Manual Testing Steps:

1. Remove an instrument with no dependent alerts — confirm the simple path works end to end.
2. Remove an instrument with alerts from multiple users — confirm the impact count is accurate and all those alerts are actually gone afterward, and that the affected users see no error (their alert lists just no longer show it).
3. Confirm `trigger_events` history for a removed ticker still renders correctly (bare ticker instead of resolved name).
4. Confirm the Polish (`development-pl`) build renders all new strings correctly, not raw `@@id`s or English fallbacks.
5. Cancel out of the confirmation dialog and confirm no state changed.

## Migration Notes

None — no schema changes. This plan only adds application-level `DELETE` statements against existing tables.

## References

- Prior plan for the sibling admin feature: `context/archive/2026-08-09-admin-add-instrument/plan.md`
- Existing atomic multi-statement pattern: `src/worker/routes/alerts.ts:204-211`
- Existing confirmation-dialog pattern: `src/app/features/alerts/delete-alert-confirm/`
- Roadmap outcome (source of truth for scope): `context/foundation/roadmap.md`, `S-11` section

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend endpoints

#### Automated

- [x] 1.1 `npm run test:worker` passes, including new `admin.test.ts` blocks — c40861a
- [x] 1.2 `npm run typecheck` passes — c40861a

#### Manual

- [x] 1.3 Manual `curl` calls to both endpoints confirm response shapes and cascade cleanup — 6ca4413

### Phase 2: Frontend service methods + confirmation dialog

#### Automated

- [x] 2.1 `npm run typecheck` passes — 21384ac
- [x] 2.2 `npm run build` passes (dialog i18n ids) — 21384ac

### Phase 3: Remove-instrument page

#### Automated

- [x] 3.1 `npm run typecheck` passes — 89a617e
- [x] 3.2 `npm run build` passes (page i18n ids — see Critical Implementation Details: doesn't actually validate unrouted-component i18n, Phase 4's `npm run ci` is the real gate) — 89a617e

### Phase 4: Routing, nav, and i18n

#### Automated

- [x] 4.1 `npm run ci` passes — 6ca4413

#### Manual

- [x] 4.2 Remove an instrument with 0 alerts, success snackbar shown — 6ca4413
- [x] 4.3 Remove an instrument with alerts from 2 users, dialog shows correct count, both users' alerts gone afterward — 6ca4413
- [x] 4.4 Removed ticker disappears from all comboboxes without refresh — 6ca4413
- [x] 4.5 Trigger history for the removed ticker still renders (bare ticker as name) — 6ca4413
- [x] 4.6 Non-admin access remains blocked — 6ca4413
- [x] 4.7 Canceling the confirmation dialog leaves the instrument untouched — 6ca4413
