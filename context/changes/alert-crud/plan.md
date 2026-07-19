# Alert CRUD (S-02) Implementation Plan

## Overview

Implement the roadmap's north-star slice: a logged-in user can create a price or RSI alert on VIX or NASDAQ-100 and see it in a persistent list. **RSI is only a valid alert type for NASDAQ-100 — VIX supports price alerts only** (PRD FR-004, updated 2026-07-19: a naive RSI on VIX has no established sentiment interpretation). This lands a new `alerts` D1 table, `POST`/`GET /api/alerts` endpoints scoped to the authenticated user, and a frontend list + creation dialog that replace the current "Alert management is coming soon" placeholder on the home page.

Each list item shows instrument/type/threshold collapsed, expanding on click to reveal the notification email, last-edited date, and (placeholder for now — see Key Discoveries) current price/RSI. **All new user-facing UI text is in Polish**, per an updated CLAUDE.md carve-out (2026-07-19) — code, comments, and backend API contract strings stay English.

## Current State Analysis

- No `alerts` table, route, or frontend feature exists yet — S-01 (auth) is the only implemented slice.
- `sessionMiddleware` (`src/worker/lib/session.ts:70-90`) already validates the session cookie and sets `userId` on the Hono context; it was explicitly designed to be reused without changes.
- The `Home` component (`src/app/features/home/home.ts`, `home.html:19`) is currently a placeholder shell — toolbar with logout + a card with static text — and is the natural target for the alert list.
- No validation library exists anywhere (no zod), no DB `CHECK` constraints beyond `NOT NULL`/`UNIQUE`/`FOREIGN KEY`, no shared row-type file, no `MatDialog` usage yet — all confirmed by direct file reads of `auth.ts`, `session.ts`, `home.ts`, `login.ts`, `auth.service.ts`, `app.routes.ts`, `package.json`, `wrangler.toml`.

## Desired End State

A user who registers/logs in lands on `/` and sees their alert list, in Polish, with an empty state on first visit. A "Nowy alert" button opens a modal form (instrument, alert type, threshold, notification email pre-filled from the account) — on submit, the alert appears at the top of the list without a page reload, and duplicate, out-of-range, or invalid instrument/type-combination submissions (VIX + RSI) are rejected with a visible, field-relevant Polish error message. Clicking an alert expands it to show the notification email, last-edited date, and current price/RSI (hardcoded "Brak danych" for now — no market-data pipeline exists yet).

**Verification**: `npm run typecheck`, `npm run test:worker`, and `npm run build` all pass; manual walkthrough in `Testing Strategy` below succeeds end-to-end.

### Key Discoveries:

- `context/archive/2026-06-28-users-email-schema/plan.md` explicitly anticipated `alerts.notification_email` as an application-layer prefill from `users.email`, confirming this column belongs on `alerts`, not derived via a join (`users` has no `notification_email` column since F-01a).
- `auth.ts:64-73` establishes the UNIQUE-violation-by-message-match pattern (`err.message.includes('UNIQUE')` → `409`), directly reusable for duplicate-alert rejection.
- `migrations/0004_sessions_cascade_delete.sql` shows `ON DELETE CASCADE` was missed on the first `sessions` migration and needed a follow-up fix — the `alerts` migration must include it from the start.
- `@angular/cdk` is already a dependency (`package.json:20`), so `MatDialog` (which depends on the CDK Overlay) needs no new package — just new imports.
- `context/foundation/prd.md` (FR-004) and `context/foundation/roadmap.md` (S-02 risk note) were updated 2026-07-19, after the initial research pass, to restrict RSI to NASDAQ-100 only. The roadmap explicitly calls for this to be enforced "at the persistence layer," not just in application code — this plan adds a targeted `CHECK` constraint for this one cross-field rule (see Phase 1), which is a narrower, explicitly-requested exception to the "no DB constraints" convention noted below, not a reversal of it.
- `CLAUDE.md`'s English-only hard rule was updated 2026-07-19 to carve out an exception: rendered UI strings (labels, buttons, messages) may be Polish, since MarketPulse's users are Polish-speaking; code, comments, commit messages, and the backend API's `{ error: string }` contract stay English (the latter is a wire-format contract consumed by the frontend, not directly rendered — the frontend maps each error case to a Polish message, the same way `register.ts` already avoids displaying a raw server string for its 409 case).
- The existing S-01 `login`/`register` pages are still in English and are deliberately **not** touched by this plan — tracked separately as [GitHub issue #23](https://github.com/mswiac/market-pulse/issues/23). `Home` (`home.ts`/`home.html`) *is* touched by this plan (Phase 3/4 already edit it to add the alert list and the "Nowy alert" button), so its existing English copy ("Welcome back", "You're signed in as", "Log out") is translated to Polish as part of this change, not left inconsistent.
- Current price and current RSI have no data source yet — no `market_data` table, no Stooq fetch, no RSI calculation (that's F-02 → S-04, not yet built). The list's expanded detail therefore hardcodes a "Brak danych" placeholder for both, wired up for real in S-04 without any further UI restructuring (see Phase 3).
- Alerts have no edit feature yet (that's S-03), so "last edited" and "created" are identical today — but the migration adds an `updated_at` column now (defaulting to the same insert-time value as `created_at`) so the UI can display "last edited" correctly from day one, and S-03 only needs to add `updated_at = unixepoch()` to its future `UPDATE` statement, no further schema or UI change.

## What We're NOT Doing

- Editing or deleting alerts (S-03).
- Displaying current RSI/price value next to alerts, or any RSI calculation (S-04/F-02) — threshold is stored, not evaluated.
- Sending notifications or recording trigger events (S-05).
- Trigger history view (S-06).
- Any shell layout or side navigation — deferred to whenever S-06 needs it; this slice only touches the existing `Home` route.
- DB-level `CHECK` constraints on `instrument`/`alert_type` enum membership or `threshold` range — validation for these stays application-layer only, matching existing convention (a `UNIQUE` constraint is still used for duplicate prevention, and a single-purpose `CHECK` is used for the VIX/RSI exclusion — see Phase 1 — both narrow, explicitly-requested exceptions, not a reversal of the general no-DB-constraints convention).
- Instruments or indicator types beyond VIX/NASDAQ-100 and price/RSI (PRD non-goals).

## Implementation Approach

Follow the codebase's established layering for a new resource: migration → Hono route module (inline D1 queries, manual validation, reused session middleware) → Angular service (signal-based state, mirroring `AuthService`) → Angular components (standalone, Material, mirroring `login`/`register`). Ship the list before the creation UI so each phase is independently verifiable against a real (if initially empty) backend.

## Critical Implementation Details

- **RSI is not a valid alert type for VIX (PRD FR-004).** This is enforced in three places, all of which must agree: the DB `CHECK` constraint (Phase 1, backstop), the backend validation in `POST /api/alerts` (Phase 2, primary — returns `400` before any insert is attempted), and the frontend form (Phase 4 — the "RSI" option is unavailable whenever `instrument` is `'VIX'`, and switching `instrument` to `'VIX'` while `alertType` is `'RSI'` must reset `alertType` rather than silently submitting an invalid combination).
- **Conditional threshold validators must be recomputed on `alertType` change.** RSI needs `min(0)`/`max(100)`; price needs a strict `> 0` check (`Validators.min(0)` alone would wrongly accept `0`, so use a custom validator). When the user switches the `alertType` select, the `threshold` control's validators must be reassigned and `updateValueAndValidity()` called — otherwise stale validators from the previous type silently persist.
- **First `MatDialog` usage in this codebase.** The opener (`Home`) needs `MatDialogModule` in its `imports` to inject `MatDialog` and call `dialog.open(AlertForm)`. The dialog content component (`AlertForm`) separately needs `MatDialogModule` in its own `imports` for the `<mat-dialog-content>`/`<mat-dialog-actions>` template directives, plus an injected `MatDialogRef<AlertForm>` to close itself (`dialogRef.close(true)`) on success.
- **API responses use SQL column aliases to produce camelCase JSON directly** (e.g. `alert_type AS alertType`), avoiding a separate mapping layer — both `POST` and `GET` handlers must alias consistently so the frontend `Alert` interface lines up with the raw response shape.
- **Language split**: rendered UI text (labels, buttons, `mat-error` messages, empty states) is Polish; everything the backend returns (`{ error: '...' }` strings) stays English, matching the existing `auth.ts` convention — the frontend is responsible for translating each known error case into a Polish message shown to the user, never displaying a raw API string directly.
- **First `mat-expansion-panel` (accordion) usage in this codebase.** Each alert list item is a `mat-expansion-panel`: the always-visible header shows instrument/type/threshold, and the panel body (rendered only once expanded, or at least only revealed on click) shows the notification email, formatted `updatedAt` date, current price ("Brak danych"), and — only when `instrument === 'NASDAQ100' && alertType === 'RSI'` — current RSI ("Brak danych"). For any other instrument/type combination, the current-RSI row is omitted entirely, not just hidden.

## Phase 1: Database schema

### Overview

Introduce the `alerts` table as a plain forward migration (no shadow-table needed — this is a new table, not an alteration of an existing one).

### Changes Required:

#### 1. Alerts table migration

**File**: `migrations/0005_create_alerts.sql`

**Intent**: Store one alert per row, scoped to a user, with duplicate prevention and cascade cleanup when a user is deleted.

**Contract**:
```sql
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, instrument, alert_type, threshold),
  CHECK (NOT (instrument = 'VIX' AND alert_type = 'RSI'))
);
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
```
`instrument` holds `'VIX'` or `'NASDAQ100'`; `alert_type` holds `'PRICE'` or `'RSI'` — enum membership and threshold range are enforced only at the application layer (Phase 2), matching the no-`CHECK`-constraint convention already in `users`/`sessions`. The one exception is the `CHECK` above: per the roadmap's explicit requirement (PRD FR-004, S-02 risk note), VIX+RSI is an invalid combination and is rejected at the persistence layer as a backstop, in addition to the primary application-layer rejection in Phase 2. `updated_at` is not modified by anything in this slice (no edit feature yet — that's S-03) — it exists now purely so the frontend can display a "last edited" date from day one without a future migration; both timestamp columns get the same value at insert time.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run migrate:local`
- Existing test suite still passes (migration auto-loaded by `vitest.config.mts`, no other tests reference `alerts` yet): `npm run test:worker`
- Typecheck still passes: `npm run typecheck`

#### Manual Verification:

- Inspect the local D1 schema and confirm the table shape: `wrangler d1 execute marketpulse-db --local --command "SELECT sql FROM sqlite_master WHERE name='alerts'"`

---

## Phase 2: Backend API

### Overview

Add `POST /api/alerts` (create) and `GET /api/alerts` (list), scoped to the authenticated user via the existing session middleware, plus exhaustive integration tests.

### Changes Required:

#### 1. Shared email validation helper

**File**: `src/worker/lib/email.ts` (new)

**Intent**: `alerts.ts` needs the same email-format validation as `auth.ts` for `notificationEmail`; extract it once instead of duplicating the regex and normalization logic.

**Contract**: exports `EMAIL_PATTERN: RegExp` and `normalizeEmail(email: unknown): string | null`, with identical behavior to the current private implementation in `auth.ts`.

#### 2. Auth route update

**File**: `src/worker/routes/auth.ts`

**Intent**: Use the shared helper instead of the local copy.

**Contract**: Replace the local `EMAIL_PATTERN` const and `normalizeEmail` function with an import from `../lib/email`. No behavior change — `test/worker/auth.test.ts` must keep passing unmodified.

#### 3. Alerts route module

**File**: `src/worker/routes/alerts.ts` (new)

**Intent**: Create and list alerts for the authenticated user only; every route in this module requires a valid session (unlike `auth.ts`, where only `/me` is protected).

**Contract**:
- `type Variables = { userId: number }`; `const alertsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()`; `alertsRoutes.use('*', sessionMiddleware)` applied once at the module level.
- Validation helpers: `normalizeInstrument` (accepts exactly `'VIX'` or `'NASDAQ100'`), `normalizeAlertType` (accepts exactly `'PRICE'` or `'RSI'`), `validateThreshold(alertType, value)` — must be a finite number; `'RSI'` additionally requires `0 <= value <= 100` (inclusive); `'PRICE'` additionally requires `value > 0` (strict).
- **Cross-field rule**: after the individual fields normalize successfully, reject the combination `instrument === 'VIX' && alertType === 'RSI'` with `400 { error: 'RSI is not available for VIX' }` — checked before the insert, so the DB `CHECK` constraint (Phase 1) is a backstop that should never actually fire through this endpoint.
- `POST /` — body `{ instrument, alertType, threshold, notificationEmail }`. Validates each field independently (then the cross-field rule above), returning a field-specific `400 { error: '<field> ...' }` on the first failure (unlike `auth.ts`'s single generic credentials message — there's no security reason to obscure which of 4 fields is wrong on a creation form). On success: insert scoped to `c.get('userId')`, using `RETURNING id, instrument, alert_type AS alertType, threshold, notification_email AS notificationEmail, created_at AS createdAt, updated_at AS updatedAt`; respond `201` with that row. A `UNIQUE` constraint violation (same message-matching pattern as `auth.ts:69`) → `409 { error: 'duplicate alert' }`. A `CHECK constraint failed` violation (should be unreachable given the pre-insert validation above, but handled defensively) → `400 { error: 'RSI is not available for VIX' }`, checked before the generic rethrow.
- `GET /` — `SELECT id, instrument, alert_type AS alertType, threshold, notification_email AS notificationEmail, created_at AS createdAt, updated_at AS updatedAt FROM alerts WHERE user_id = ? ORDER BY created_at DESC, id DESC`, bound to `c.get('userId')`. Responds `200` with the array (empty array for a user with no alerts, not a 404).
- All error messages returned by this module are English (backend/API contract, matching `auth.ts`'s existing convention) — the Polish text shown to the user lives entirely in the frontend (Phase 4), which maps each known error case to a Polish message.

#### 4. Route mounting

**File**: `src/worker/index.ts`

**Intent**: Expose the new routes under the established `/api` prefix.

**Contract**: `app.route('/api/alerts', alertsRoutes)`, added alongside the existing `app.route('/api', authRoutes)` line, before the SPA catch-all (`app.get('*', ...)`).

#### 5. Integration tests

**File**: `test/worker/alerts.test.ts` (new)

**Intent**: Exhaustive coverage per the agreed test scope — happy path, per-field validation, boundary values, duplicates, malformed input, and cross-user isolation.

**Contract**: Follows `auth.test.ts`'s `exports.default.fetch(...)` + `sessionCookieFrom(...)` style; a shared helper registers and logs in a user to obtain a cookie before exercising alert endpoints. Cases: create-then-list happy path for both `VIX`/`PRICE` and `NASDAQ100`/`RSI`, asserting the response includes `createdAt` and `updatedAt` (equal, since nothing edits an alert yet); reject each invalid field (bad `instrument`, bad `alertType`, non-numeric/negative/out-of-range `threshold` for both `RSI` and `PRICE`, malformed `notificationEmail`); reject `VIX`/`RSI` with `400` and the specific error message; accept `NASDAQ100`/`RSI` and `VIX`/`PRICE`; accept `RSI` threshold at exactly `0` and exactly `100`; reject `RSI` at `-0.01` and `100.01`; reject `PRICE` threshold of `0`; accept a `PRICE` threshold with decimals (e.g. `18.42`); reject an exact duplicate (same user + instrument + alertType + threshold) with `409`; reject a malformed JSON body with `400`; reject `POST`/`GET` without a session cookie with `401`; confirm a second user's `GET /api/alerts` never includes the first user's alert (isolation).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- All worker tests pass, including the new suite: `npm run test:worker`

#### Manual Verification:

- Start the local worker (`npm run worker:dev`) and manually exercise `POST`/`GET /api/alerts` with a valid session cookie (obtained via `/api/login`) using curl or HTTPie, confirming response shape and status codes match the contract above.

---

## Phase 3: Frontend — alerts service + list view

### Overview

Introduce the data layer and read-only list rendering, replacing the `Home` placeholder text. No creation UI yet — this phase is verifiable against a real (empty) backend before Phase 4 adds writes.

### Changes Required:

#### 1. Alerts service

**File**: `src/app/features/alerts/alerts.service.ts` (new)

**Intent**: Single source of truth for the current user's alerts, mirroring `AuthService`'s signal + `tap` shape so the list reflects a later `create()` call automatically.

**Contract**: `@Injectable({ providedIn: 'root' })`; exports `interface Alert { id: number; instrument: string; alertType: string; threshold: number; notificationEmail: string; createdAt: number; updatedAt: number }`; private `signal<Alert[]>([])` + public `.asReadonly()`; `list(): Observable<Alert[]>` calls `GET /api/alerts`, `tap` sets the signal; `create(payload: { instrument: string; alertType: string; threshold: number; notificationEmail: string }): Observable<Alert>` calls `POST /api/alerts`, `tap` prepends the created alert (`this._alerts.update(a => [created, ...a])`).

#### 2. Alert list component

**File**: `src/app/features/alerts/alert-list/alert-list.ts` / `.html` / `.scss` (new)

**Intent**: Render the authenticated user's alerts as an accordion — collapsed summary, expand-on-click detail — fetching once on construction.

**Contract**: Standalone component (selector `app-alert-list`), `imports: [MatExpansionModule, MatIconModule]`; injects `AlertsService`, calls `list().subscribe()` in the constructor. Template wraps `alertsService.alerts()` in a `mat-accordion`; each alert is one `mat-expansion-panel` whose `mat-expansion-panel-header`/`mat-panel-title` shows instrument, alert type, and threshold (e.g. "NASDAQ-100 · RSI · próg 70"), using Polish display labels for the type (`'PRICE'` → "Cena", `'RSI'` → "RSI"; instrument values are shown as-is: "VIX", "NASDAQ-100"). The panel body shows, each on its own labeled line: "E-mail powiadomień" (`notificationEmail`), "Ostatnia edycja" (`updatedAt`, formatted as a date), "Aktualna cena" (hardcoded "Brak danych"), and — only `@if (alert.instrument === 'NASDAQ100' && alert.alertType === 'RSI')` — "Aktualne RSI" (hardcoded "Brak danych"); the row is omitted entirely otherwise. An empty-state message ("Brak alertów — dodaj pierwszy, aby zacząć.") is shown when the array is empty.

#### 3. Home integration

**File**: `src/app/features/home/home.ts` / `home.html`

**Intent**: Replace the static English placeholder with the real (Polish) alert list; translate the rest of `Home`'s copy to Polish while the file is already being touched (the S-01 `login`/`register` pages are explicitly left as-is — tracked in issue #23).

**Contract**: `Home`'s `imports` gains `AlertList`; in `home.html`: "Welcome back" → "Witaj ponownie", "You're signed in as {{ currentUser.email }}." → "Zalogowano jako: {{ currentUser.email }}.", "Log out" → "Wyloguj", and the `<p>Alert management is coming soon.</p>` line is replaced with `<app-alert-list />`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Log in with a fresh user, land on `/`, see the Polish empty-state message render correctly with no console errors.
- `Home`'s toolbar and copy render in Polish ("Witaj ponownie", "Zalogowano jako", "Wyloguj").

---

## Phase 4: Frontend — alert creation dialog

### Overview

Add the "New alert" button and the `MatDialog`-hosted creation form, completing the end-to-end flow.

### Changes Required:

#### 1. Alert form (dialog content)

**File**: `src/app/features/alerts/alert-form/alert-form.ts` / `.html` / `.scss` (new)

**Intent**: The alert-creation form, opened as `MatDialog` content — first `<mat-select>` usage in this codebase.

**Contract**: Standalone component; `imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule]`; injects `MatDialogRef<AlertForm>`, `AlertsService`, `AuthService`. Dialog title: "Nowy alert". `fb.nonNullable.group({...})` with: `instrument` (label "Instrument", `Validators.required`, options `'VIX'`/`'NASDAQ100'` displayed as "VIX"/"NASDAQ-100"), `alertType` (label "Typ alertu", `Validators.required`, options `'PRICE'`/`'RSI'` displayed as "Cena"/"RSI"), `threshold` (label "Próg", `Validators.required` plus the conditional min/max or strict-positive validator described in Critical Implementation Details, recomputed whenever `alertType` changes), `notificationEmail` (label "E-mail do powiadomień", default value `authService.currentUser()?.email ?? ''`, `[Validators.required, Validators.email]`, editable). Validation messages: "Pole wymagane." (`required`), "Wprowadź prawidłowy adres e-mail." (`email`), "Wartość musi mieścić się w zakresie 0–100." (RSI range), "Wartość musi być większa od 0." (price strict-positive). Submit button: "Utwórz alert". The `alertType` select's available options depend on the current `instrument` value: when `instrument === 'VIX'`, only "Cena" is offered (the "RSI" `mat-option` is omitted, not merely disabled); subscribing to `instrument`'s `valueChanges` and switching to `'VIX'` while `alertType` is currently `'RSI'` must reset `alertType` to `'PRICE'` rather than leave an invalid combination selected. On submit: `alertsService.create(...).subscribe({ next: () => dialogRef.close(true), error: (err) => ... })`; both a `409` (duplicate → "Taki alert już istnieje.") and a `400` for the VIX+RSI case (should be unreachable given the option-filtering above, but handled defensively → "RSI nie jest dostępne dla VIX.") are mapped onto the form the same way `register.ts` maps its own server-side conflict (`setErrors({ server: true })` + `markAsTouched()`), reading the raw English `error` string only to select which Polish message to display — never rendering it directly. Any other/unrecognized error response (unexpected status, network failure) falls back to a generic message ("Wystąpił błąd. Spróbuj ponownie.") via the same `setErrors`/`markAsTouched()` mechanism, so no error path leaves the dialog silently stuck.

#### 2. Home trigger button

**File**: `src/app/features/home/home.ts` / `home.html`

**Intent**: Let the user open the creation dialog.

**Contract**: `Home` injects `MatDialog` (adds `MatDialogModule` to its `imports`); a new `openNewAlertDialog()` method calls `this.dialog.open(AlertForm)`; a `<button mat-raised-button (click)="openNewAlertDialog()">Nowy alert</button>` is placed above `<app-alert-list />`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Click "Nowy alert", submit a valid RSI alert, see the dialog close and the new alert appear at the top of the list without a page reload.
- Attempt an RSI threshold of `150` — inline validation ("Wartość musi mieścić się w zakresie 0–100.") blocks submission before any request is sent.
- Attempt to create the same alert twice — the second submission surfaces "Taki alert już istnieje." as a visible form error, not a silent failure.
- The notification email field is pre-filled with the logged-in account's email and remains editable.
- Select `VIX` as the instrument — confirm the alert-type select offers only "Cena" (no "RSI" option is present).
- Select `NASDAQ-100` + `RSI`, then switch the instrument to `VIX` — confirm the alert type resets to "Cena" rather than silently keeping the invalid combination.
- Click a created alert to expand it — confirm it shows "E-mail powiadomień", "Ostatnia edycja" (a real date), and "Aktualna cena: Brak danych".
- For a NASDAQ-100/RSI alert specifically, confirm the expanded detail also shows "Aktualne RSI: Brak danych"; confirm this row is absent for any other instrument/type combination.

---

## Testing Strategy

### Unit Tests:

None — Angular unit tests are disabled project-wide (`skipTests: true` in `angular.json`, a hard rule in `CLAUDE.md`). Coverage comes from backend integration tests (Phase 2) and manual verification (Phases 3-4).

### Integration Tests:

- `test/worker/alerts.test.ts` (Phase 2) — see the exhaustive case list above; this is the primary automated safety net for this slice, particularly the cross-user isolation case, which is the highest-risk correctness point identified in research.

### Manual Testing Steps:

1. Register a new user, confirm redirect to `/` shows the Polish empty-state message.
2. Open "Nowy alert", create a `VIX` / `Cena` / `35` alert with the pre-filled email — confirm it appears at the top of the list, collapsed, showing instrument/type/threshold.
3. Click the new alert to expand it — confirm "E-mail powiadomień", "Ostatnia edycja" (today's date), and "Aktualna cena: Brak danych" show; confirm there is no "Aktualne RSI" row (this alert is `VIX`/`PRICE`).
4. Open "Nowy alert" again, attempt the exact same alert — confirm "Taki alert już istnieje.", no duplicate row added.
5. Open "Nowy alert", select `Cena`, attempt threshold `0` — confirm inline validation blocks it; attempt `4500.25` — confirm it's accepted and appears in the list.
6. Create a `NASDAQ-100` / `RSI` / `70` alert, expand it — confirm it shows both "Aktualna cena: Brak danych" and "Aktualne RSI: Brak danych".
7. Log out, register a second user, confirm their alert list is empty (does not show the first user's alerts).
8. Refresh the page after creating an alert — confirm it persists (loaded from `GET /api/alerts`, not just local state).
9. Open "Nowy alert", select `VIX` — confirm only "Cena" is offered as the alert type (no way to select RSI for VIX).

## Performance Considerations

None specific to this slice — single-digit alert counts per user at this product stage; no pagination or virtualization needed.

## Migration Notes

`migrations/0005_create_alerts.sql` is a plain forward `CREATE TABLE` (no existing data to migrate, no shadow-table pattern needed) — this holds even with the added `CHECK` constraint, since it's part of the initial table definition, not a later alteration. Applies to local and remote D1 via the existing `npm run migrate:local` / `migrate:remote` scripts with no config changes.

## References

- Research: `context/changes/alert-crud/research.md`
- VIX/RSI restriction rationale: `context/foundation/prd.md` FR-004 (Socrates note), `context/foundation/roadmap.md` S-02 risk note (both updated 2026-07-19)
- Polish-UI carve-out: `CLAUDE.md` Hard Rules (updated 2026-07-19)
- Login/register Polish translation (out of scope here): [GitHub issue #23](https://github.com/mswiac/market-pulse/issues/23)
- Session middleware to reuse: `src/worker/lib/session.ts:70-90`
- UNIQUE-violation pattern to mirror: `src/worker/routes/auth.ts:64-73`
- Protected-route pattern to mirror: `src/worker/routes/auth.ts:115-126`
- Integration test style to mirror: `test/worker/auth.test.ts`
- Component pattern to mirror: `src/app/features/auth/login/login.ts`, `login.html`
- Server-error-to-form mapping pattern: `src/app/features/auth/register/register.ts:39-51`
- Service pattern to mirror: `src/app/core/auth/auth.service.ts`
- Placeholder to replace: `src/app/features/home/home.html:19`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database schema

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run migrate:local` — 5fb80fc
- [x] 1.2 Existing test suite still passes: `npm run test:worker` — 5fb80fc
- [x] 1.3 Typecheck still passes: `npm run typecheck` — 5fb80fc

#### Manual

- [ ] 1.4 Inspect local D1 schema for the `alerts` table shape

### Phase 2: Backend API

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 22c480c
- [x] 2.2 All worker tests pass, including `alerts.test.ts`: `npm run test:worker` — 22c480c

#### Manual

- [ ] 2.3 Manually exercise `POST`/`GET /api/alerts` against the local worker with a valid session cookie

### Phase 3: Frontend — alerts service + list view

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — 415b997
- [x] 3.2 Production build succeeds: `npm run build` — 415b997

#### Manual

- [ ] 3.3 Fresh user login renders the Polish empty-state message with no console errors
- [ ] 3.4 Home's toolbar and copy render in Polish

### Phase 4: Frontend — alert creation dialog

#### Automated

- [x] 4.1 Typecheck passes: `npm run typecheck` — e0ba3a6
- [x] 4.2 Production build succeeds: `npm run build` — e0ba3a6

#### Manual

- [ ] 4.3 Create an alert via the dialog and see it appear in the list without a page reload
- [ ] 4.4 RSI threshold of 150 is blocked by inline validation
- [ ] 4.5 Duplicate alert submission surfaces a visible 409 form error
- [ ] 4.6 Notification email is pre-filled from the account and remains editable
- [ ] 4.7 Selecting VIX offers only "Cena" as the alert type (no RSI option)
- [ ] 4.8 Switching from NASDAQ-100+RSI to VIX resets alert type to Cena instead of keeping an invalid combination
- [ ] 4.9 Expanding an alert shows email, last-edited date, and "Aktualna cena: Brak danych"
- [ ] 4.10 "Aktualne RSI: Brak danych" appears only for a NASDAQ-100/RSI alert, absent otherwise
