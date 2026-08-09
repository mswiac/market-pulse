# Admin can add a new instrument to the registry — Implementation Plan

## Overview

Extends the admin panel (`S-09`) with a second action: an admin can add a new row to the `instruments` registry — type (Index / PL companies / US companies), ticker, company name, currency, and an RSI-eligible checkbox. `provider` is derived automatically from type; everything else is admin-entered. Along the way, the plan also unifies the two divergent error-response conventions currently in the backend (`{error}` vs `{error, code}`), since the new endpoint needs to pick one and the inconsistency was surfaced during planning.

## Current State Analysis

- `instruments` table (`migrations/0008_instrument_registry.sql`, extended by `0010`/`0011`) has `ticker TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('index')), rsi_eligible INTEGER NOT NULL, provider TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD'`. Only two rows exist (`^VIX`, `^NDX`), both `type='index'`, `provider='yahoo'`.
- `GET /api/instruments` (`src/worker/routes/instruments.ts:19-39`) is the only route touching this table. No write endpoint exists.
- The admin panel (`src/app/features/admin/`) already has one action ("Fetch market data") and is explicitly built to host more (S-09 outcome). Its backend (`src/worker/routes/admin.ts`) is gated by `sessionMiddleware` + `adminMiddleware` (`src/worker/lib/admin.ts`) applied to the whole router.
- Two incompatible error-response shapes exist side by side: `admin.ts` returns `{error, code}` and the frontend (`admin-panel.ts`) maps `code` → localized text via a lookup table; `alerts.ts` returns `{error}` only, and its frontend consumer (`alert-form.ts:172-186`) matches on HTTP status plus, in one case, the literal English error string (`serverError === VIX_RSI_ERROR`) — fragile, since changing the message text would silently break the match.
- The type→instrument two-combobox pattern (type filters instrument list) appears three times, each with its own local `INSTRUMENT_TYPE_LABELS` map covering only `index`: `admin-panel.ts:20-22`, `alert-form.ts:19-21`, `instrument-history.ts:12-14`.
- `InstrumentsService` (`src/app/features/instruments/instruments.service.ts`) caches `GET /api/instruments` behind a `loaded` flag + `shareReplay(1)`, with no way to invalidate the cache once loaded.
- The Angular build fails (`i18nMissingTranslation: "error"` in `angular.json`) if any `$localize` string with an `@@id` lacks a matching `<trans-unit>` in `src/locale/messages.pl.xlf`. Every new UI string this plan introduces needs an entry there.

## Desired End State

An admin on `/admin` sees a second card, "Add instrument," with five fields (type, ticker, name, currency, RSI-eligible checkbox — checked by default) and a submit button. Submitting calls `POST /api/admin/instruments`, which validates the input, derives `provider` from `type`, inserts the row, and returns it. On success the admin panel reloads the shared instrument cache and shows a confirmation snackbar; the new instrument is immediately available on the instrument-history page, the alert form, and future admin backfills. Duplicate tickers are rejected with a clear message. The `instruments.type` CHECK constraint now allows `'index' | 'pl_stock' | 'us_stock'`. `alerts.ts` and its frontend consumer now use the same `{error, code}` convention as `admin.ts`, with no remaining string-matching on error text.

Verify by: `npm run ci` passes; `POST /api/admin/instruments` as a non-admin returns 403; as an admin, adding a `pl_stock` ticker returns 201 and the ticker subsequently appears in `GET /api/instruments` and in the alert-creation and instrument-history comboboxes.

### Key Discoveries:

- `migrations/0011_alert_notifications.sql` is the exact shadow-table precedent to copy for extending a `CHECK` constraint in SQLite (D1 can't `ALTER ... CHECK`).
- `src/worker/routes/alerts.ts:212-213` / `278-279` already catch `err.message.includes('UNIQUE')` for a different table's PK collision — the same pattern applies directly to `instruments.ticker`.
- Test assertions in `test/worker/alerts.test.ts` use `toMatchObject`, not `toEqual`, for error bodies — adding a `code` field alongside the existing `error` string is additive and won't break the assertions already there.
- `INSTRUMENT_TYPE_LABELS` in the three existing components is keyed only by `type`, used purely for display — extracting it doesn't touch any component's control-flow logic, only its constant import.

## What We're NOT Doing

- Not building `F-04` (Stooq provider fetch support) — a `pl_stock` instrument added here has no working data fetch until that separate roadmap item lands (documented risk on `S-10`/`F-04`, not a gap introduced by this plan).
- Not adding instrument edit/delete from the registry — this plan is add-only, matching the roadmap's S-10 scope.
- Not changing `GET /api/instruments`'s response shape (still omits `provider`) — the new POST response includes it, since the admin action's own success feedback benefits from it, but the shared read endpoint is untouched.
- Not migrating every error response in the codebase to `{error, code}` — only `alerts.ts`, since that's the one call site actively compared against `admin.ts`'s convention during planning. `auth.ts`, `trigger-events.ts`, etc. are out of scope.

## Implementation Approach

Bottom-up: schema first (Phase 1), then the new backend endpoint that depends on it (Phase 2), then the unrelated-but-adjacent `alerts.ts` convention fix (Phase 3, backend half first so Phase 4 has something to consume), then frontend shared constants (Phase 4, including the `alerts.ts` frontend counterpart), then the new form itself (Phase 5), which depends on both the endpoint (Phase 2) and the shared constants (Phase 4).

## Critical Implementation Details

**i18n translation catalog is build-blocking, not optional — but only for the production build.** Every new `$localize:@@id:` string added in Phase 5 (and the `ERROR_MESSAGES`-style entries used for the new endpoint's error codes) needs a matching `<trans-unit id="...">` added to `src/locale/messages.pl.xlf` in the same phase. `npm run build`/`npm run ci` use the `production` Angular config, which sets `i18nMissingTranslation: "error"` (`angular.json`) — these fail outright on any missing id. `npm start` (`ng serve --configuration development-pl`) does NOT set this option and only warns — don't rely on the dev server to catch a missing translation; always confirm with `npm run build` before considering a phase done. Add each `<trans-unit>` next to its sibling ids from the same component (e.g. new `adminPanel.*` entries go near the existing `adminPanel.*` block starting at `messages.pl.xlf:221`).

## Phase 1: Extend the `instruments.type` CHECK constraint

### Overview

Widen the registry's `type` column to accept the two new categories, using the repo's established shadow-table technique.

### Changes Required:

#### 1. New migration

**File**: `migrations/0014_instrument_registry_extended_types.sql`

**Intent**: Rebuild `instruments` with `CHECK (type IN ('index', 'pl_stock', 'us_stock'))`, preserving the two existing rows unchanged. No triggers are bound directly to `instruments` (the RSI-eligibility triggers in `0009` are on `alerts`/`market_data`, only referencing `instruments` via subquery), so none need recreating.

**Contract**: Follow `migrations/0011_alert_notifications.sql`'s shape exactly — `CREATE TABLE instruments_new (...)` with the widened `CHECK`, `INSERT INTO instruments_new SELECT * FROM instruments`, `DROP TABLE instruments`, `ALTER TABLE instruments_new RENAME TO instruments`. Column order/types otherwise unchanged from `0008`+`0010`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npm run migrate:local`
- Existing instrument tests still pass: `npm run test:worker`

#### Manual Verification:

- `wrangler d1 execute marketpulse-db --local --command "SELECT ticker, type FROM instruments"` still returns `^VIX`/`^NDX` unchanged

---

## Phase 2: `POST /api/admin/instruments` endpoint

### Overview

New admin-only route that validates input, derives `provider` from `type`, and inserts the row.

### Changes Required:

#### 1. New route handler

**File**: `src/worker/routes/admin.ts`

**Intent**: Add `adminRoutes.post('/instruments', ...)` alongside the existing `/market-data` handler, reusing the router-level `sessionMiddleware`/`adminMiddleware` already applied at line 15. Validates `type` (must be `'index' | 'pl_stock' | 'us_stock'`), `ticker` and `name` (non-empty strings, trimmed), `currency` (non-empty, normalized to uppercase, must match `^[A-Z]{3}$`), and `rsiEligible` (boolean). Derives `provider`: `'pl_stock'` → `'stooq'`, everything else → `'yahoo'`. Inserts via `INSERT ... RETURNING ticker, name, type, rsi_eligible AS rsiEligible, provider, currency`, coercing `rsiEligible` to a real boolean in the response the same way `instruments.ts:36` does. Catches a `UNIQUE` constraint error the same way `alerts.ts:211-215` does, returning 409.

**Contract**: `POST /api/admin/instruments` body `{ type: string, ticker: string, name: string, currency: string, rsiEligible: boolean }` → `201 { ticker, name, type, rsiEligible, provider, currency }`. Error codes (all `{error, code}`, following the file's existing convention): `invalid_body` (400, unparseable JSON), `instrument_type_invalid` (400), `instrument_ticker_required` (400), `instrument_name_required` (400), `instrument_currency_invalid` (400), `instrument_duplicate_ticker` (409). Distinct code names from the existing `/market-data` codes (e.g. `ticker_required`) — both handlers share the same frontend error-message lookup table (Phase 5), so codes must not collide across the two actions.

#### 2. Tests

**File**: `test/worker/admin.test.ts`

**Intent**: Mirror the existing `describe('POST /api/admin/market-data', ...)` block's structure and helpers (`registerAndLogIn`, `logInAsAdmin`) for a new `describe('POST /api/admin/instruments', ...)` block.

**Contract**: Cover: 401 with no session; 403 non-admin; each validation failure (bad type, empty ticker, empty name, malformed currency) returns its specific `code`; a successful insert returns 201 with the derived `provider`/coerced `rsiEligible`, and the row is subsequently visible via `GET /api/instruments`; inserting a ticker that already exists (e.g. `^VIX`) returns 409 with `code: 'instrument_duplicate_ticker'`. Both `rsiEligible: true` and `rsiEligible: false` must be covered, not just the default-`true` case — the checkbox exists specifically so an `index`-type instrument can be added without RSI (mirroring `^VIX`), so a test must confirm `false` persists and round-trips correctly, not just `true`.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including new `admin.test.ts` cases
- `npm run typecheck` passes

#### Manual Verification:

- Manually POST to `/api/admin/instruments` (e.g. via `curl` with an admin session cookie) and confirm the row appears in `GET /api/instruments`

---

## Phase 3: `alerts.ts` error-code convention fix (backend)

### Overview

Bring `alerts.ts`'s error responses in line with `admin.ts`'s `{error, code}` shape, so both admin-triggered and user-triggered write endpoints follow one convention.

### Changes Required:

#### 1. Add `code` to every error response

**File**: `src/worker/routes/alerts.ts`

**Intent**: Add a `code` field to each of the existing error paths without changing the existing `error` string (avoids touching any consumer that already matches on `error` text, if any exists beyond `alert-form.ts`). Codes: `invalid instrument` → `invalid_instrument`, `invalid alert type` → `invalid_alert_type`, `invalid threshold` → `invalid_threshold`, `invalid notification email` → `invalid_notification_email`, `invalid direction` → `invalid_direction`, `RSI is not available for VIX` → `rsi_not_eligible`, `invalid request body` → `invalid_body`, `duplicate alert` → `duplicate_alert`, `invalid alert id` → `invalid_alert_id`, `alert not found` → `alert_not_found`.

**Contract**: Every `c.json({error: '...'}, status)` call in this file becomes `c.json({error: '...', code: '...'}, status)`. `validateAlertInput`'s return type (`AlertValidationResult`'s `{ok: false, error: string}` branch) gains a parallel `code: string` field so the codes above flow through from validation to the response.

#### 2. Test assertions

**File**: `test/worker/alerts.test.ts`

**Intent**: Add a `code` assertion alongside each existing `toMatchObject({error: '...'})` check (lines listed in Key Discoveries) — additive, since `toMatchObject` doesn't require an exhaustive match.

**Contract**: Each of the ~13 existing error-response assertions gains its corresponding `code` value in the same `toMatchObject({...})` call.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes with updated `alerts.test.ts`
- `npm run typecheck` passes

#### Manual Verification:

- None beyond automated — purely a response-shape addition, not user-visible yet (frontend consumes it in Phase 4)

---

## Phase 4: Shared instrument-type constants + `alert-form.ts` code-based matching (frontend)

### Overview

Removes the three-way `INSTRUMENT_TYPE_LABELS` duplication and switches `alert-form.ts`'s error handling from status/string-matching to the `code` field now available from Phase 3.

### Changes Required:

#### 1. Shared constants module

**File**: `src/app/features/instruments/instrument-types.ts` (new)

**Intent**: Single source of truth for instrument-type display labels and for the fixed set of types offered when *creating* an instrument (distinct from `InstrumentsService.types()`, which only reflects types already present in loaded data — `pl_stock`/`us_stock` won't exist there until the first one is added). This is a new, small constants-module pattern for this codebase — no `*-types.ts`/constants-only file exists elsewhere under `src/app/features/` today, so this isn't following an established precedent, just introducing one.

**Contract**: Exports `CREATABLE_INSTRUMENT_TYPES: readonly string[]` (`['index', 'pl_stock', 'us_stock']`) and `INSTRUMENT_TYPE_LABELS: Record<string, string>` with three entries (`index`, `pl_stock`, `us_stock`), each a `$localize` string with a unique `@@id` (new ids, since the three existing per-component ids like `adminPanel.type.index` would collide if reused verbatim — use a shared id prefix, e.g. `instrumentType.index` / `instrumentType.plStock` / `instrumentType.usStock`).

#### 2. Update existing components to import the shared constant

**Files**: `src/app/features/admin/admin-panel.ts`, `src/app/features/alerts/alert-form/alert-form.ts`, `src/app/features/instrument-history/instrument-history.ts`

**Intent**: Delete each file's local `INSTRUMENT_TYPE_LABELS` and import the shared one instead. No behavioral change for these three — `index` is still the only type with existing data until Phase 5 lands, but the map now also carries the two new labels for when Phase 5's created instruments start appearing in these same comboboxes.

**Contract**: `instrumentTypeLabel(type)` methods keep their existing signature and call site — only the backing constant's import changes.

#### 3. `alert-form.ts` code-based error matching

**File**: `src/app/features/alerts/alert-form/alert-form.ts`

**Intent**: Replace the `serverError === VIX_RSI_ERROR` string comparison (lines 180-182) with a check against `err.error.code === 'rsi_not_eligible'` (the code introduced in Phase 3), removing the `VIX_RSI_ERROR` constant. The 409/404 status-based branches are unaffected — they're not part of this convention (no `code` needed to distinguish a single, unambiguous status).

**Contract**: `messageFor(err)`'s 400-branch reads `(err.error as {code?: string} | null)?.code` instead of `.error`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` passes (catches any missing `messages.pl.xlf` entries for the new `@@id`s, per Critical Implementation Details)

#### Manual Verification:

- Instrument-history page and alert-creation form still show "Index" (Polish: "Indeks") as the only type option, unchanged from before this phase
- Triggering the VIX+RSI validation error in the alert form still shows the existing localized message

---

## Phase 5: "Add instrument" form in the admin panel

### Overview

The user-facing feature: a second card in `/admin` that calls the Phase 2 endpoint.

### Changes Required:

#### 1. Service method

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Add `addInstrument(...)` mirroring `fetchMarketData`'s shape.

**Contract**: `addInstrument(type: string, ticker: string, name: string, currency: string, rsiEligible: boolean): Observable<{ticker: string; name: string; type: string; rsiEligible: boolean; provider: string; currency: string}>`, POSTing to `/api/admin/instruments`.

#### 2. Cache invalidation in `InstrumentsService`

**File**: `src/app/features/instruments/instruments.service.ts`

**Intent**: Add a way to force a fresh `GET /api/instruments` after a successful admin insert, since the existing `loaded`/`shareReplay(1)` cache has no invalidation path today.

**Contract**: `reload(): Observable<Instrument[]>` — resets `loaded = false` and `inFlight = null`, then delegates to `ensureLoaded()`.

#### 3. Form state, submission, and error handling

**File**: `src/app/features/admin/admin-panel.ts`

**Intent**: Add signals for the five new-instrument fields (`newType`, `newTicker`, `newName`, `newCurrency`, `newRsiEligible`, defaulting `newRsiEligible` to `true` and `newType` to the first entry of `CREATABLE_INSTRUMENT_TYPES`), a `canSubmitInstrument` computed (non-empty ticker/name; `newCurrency` matching `^[A-Z]{3}$`, checked against the value after the blur-time uppercase transform), and an `onSubmitInstrument()` handler calling `adminService.addInstrument(...)`. On success: call `instrumentsService.reload()`, reset the form fields, show a success snackbar. On error: reuse the existing `showError`/`ERROR_MESSAGES` mechanism (`admin-panel.ts:132-136`), extended with the five new codes from Phase 2. Currency input gets an `onCurrencyBlur()` handler that uppercases the typed value in place, mirroring the existing reformat-on-blur pattern for threshold (`alert-form.ts:142-149`) — gives the admin instant feedback on format instead of a round-trip 400.

**Contract**: `ERROR_MESSAGES` gains entries for `invalid_body`, `instrument_type_invalid`, `instrument_ticker_required`, `instrument_name_required`, `instrument_currency_invalid`, `instrument_duplicate_ticker`. Type combobox options come from `CREATABLE_INSTRUMENT_TYPES` (Phase 4), not `instrumentsService.types()` (which wouldn't yet include `pl_stock`/`us_stock` before any exist).

#### 4. Template

**File**: `src/app/features/admin/admin-panel.html`

**Intent**: A second `mat-card`, structurally parallel to the existing "Fetch market data" card — `mat-select` for type, `matInput` text fields for ticker/name/currency (currency wired to `(blur)="onCurrencyBlur($event)"`, same wiring style as `admin-panel.html`'s existing date fields), a `mat-checkbox` for RSI-eligible (checked by default), and a submit button disabled until `canSubmitInstrument()`.

**Contract**: New i18n ids for every label/placeholder/button text (`adminPanel.addInstrument.*`), each needing a `messages.pl.xlf` entry per Critical Implementation Details. Requires adding `MatCheckboxModule` to the component's `imports` array (not currently imported anywhere in `admin-panel.ts`).

#### 5. Translation catalog

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add `<trans-unit>` entries for every new `@@id` introduced across Phases 4 and 5 (the three `instrumentType.*` ids, the `adminPanel.addInstrument.*` ids, and none needed for `ERROR_MESSAGES`/`INSTRUMENT_TYPE_LABELS` beyond what's already covered — those are TS-level `$localize` calls, same requirement).

**Contract**: Polish translations following the existing tone in the file (e.g. `adminPanel.title` → "Panel administratora"). Suggested: type combobox "PL companies"/"US companies" → "Spółki PL"/"Spółki USA" (per the roadmap's resolved naming), "Add instrument" → "Dodaj instrument", "RSI eligible" → "RSI dostępne".

### Success Criteria:

#### Automated Verification:

- `npm run ci` passes (typecheck + `test:worker` + build, which also validates the i18n catalog is complete)

#### Manual Verification:

- As a logged-in admin, open `/admin`, fill in the "Add instrument" card with a `pl_stock` ticker (e.g. type=Spółki PL, ticker=`CDR`, name=`CD Projekt`, currency=`PLN`, RSI checked), submit, and confirm a success snackbar appears
- Confirm the new instrument immediately appears as a selectable option on `/history` (instrument-history page) and in the alert-creation form's type/instrument comboboxes, without a page refresh
- Attempt to add a ticker that already exists (e.g. `^VIX`) and confirm a clear "already exists" message is shown, not a generic error
- Attempt to submit with an empty ticker/name/currency and confirm the submit button is disabled (client-side) rather than relying on the server error
- As a non-admin, confirm `/admin` remains inaccessible (unchanged from S-09, but worth re-confirming nothing in this phase weakened it)

---

## Testing Strategy

### Unit Tests:

- Backend: `test/worker/admin.test.ts` covers the new endpoint's validation, success, and duplicate-ticker paths (Phase 2); `test/worker/alerts.test.ts` covers the added `code` fields (Phase 3).

### Integration Tests:

- The Phase 2 tests run against the real D1 test binding end-to-end (per this repo's `@cloudflare/vitest-pool-workers` convention), so "integration" and "unit" are effectively the same suite here — no separate layer needed.

### Manual Testing Steps:

1. Run the full flow once all phases land: add a `pl_stock` instrument, confirm it shows up in instrument-history and alert-creation comboboxes.
2. Confirm the Polish (`development-pl`) build renders all new strings correctly, not raw `@@id`s or English fallbacks.
3. Confirm an existing alert's VIX+RSI validation error still displays correctly after the Phase 3/4 code-based rewiring.

## Migration Notes

Phase 1's migration is additive/widening only (no existing row is altered in meaning, `type IN (...)` gains two new allowed values) — safe to run on production D1 with no downtime. Must be applied via `npm run migrate:remote` before Phase 2's endpoint is deployed and exercised (per this project's standing note that migrations aren't auto-applied on deploy).

## References

- Prior shadow-table migration: `migrations/0011_alert_notifications.sql`
- Existing `{error, code}` convention: `src/worker/routes/admin.ts:35-84`
- Existing duplicate-key handling pattern: `src/worker/routes/alerts.ts:211-216`
- Roadmap outcome (source of truth for scope): `context/foundation/roadmap.md`, `S-10` section

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extend the `instruments.type` CHECK constraint

#### Automated

- [x] 1.1 Migration applies cleanly locally: `npm run migrate:local` — c0bf390
- [x] 1.2 Existing instrument tests still pass: `npm run test:worker` — c0bf390

#### Manual

- [ ] 1.3 `^VIX`/`^NDX` rows unchanged after migration

### Phase 2: `POST /api/admin/instruments` endpoint

#### Automated

- [x] 2.1 `npm run test:worker` passes, including new `admin.test.ts` cases
- [x] 2.2 `npm run typecheck` passes

#### Manual

- [ ] 2.3 Manual POST via admin session confirms row appears in `GET /api/instruments`

### Phase 3: `alerts.ts` error-code convention fix (backend)

#### Automated

- [ ] 3.1 `npm run test:worker` passes with updated `alerts.test.ts`
- [ ] 3.2 `npm run typecheck` passes

### Phase 4: Shared instrument-type constants + `alert-form.ts` code-based matching (frontend)

#### Automated

- [ ] 4.1 `npm run typecheck` passes
- [ ] 4.2 `npm run build` passes (i18n catalog complete)

#### Manual

- [ ] 4.3 Instrument-history and alert-form type comboboxes unchanged (still show only "Indeks")
- [ ] 4.4 VIX+RSI validation error still shows the correct localized message

### Phase 5: "Add instrument" form in the admin panel

#### Automated

- [ ] 5.1 `npm run ci` passes

#### Manual

- [ ] 5.2 Add a `pl_stock` instrument end-to-end, success snackbar shown
- [ ] 5.3 New instrument appears in instrument-history and alert-form comboboxes without refresh
- [ ] 5.4 Duplicate ticker shows a clear "already exists" message
- [ ] 5.5 Empty required fields keep submit disabled client-side
- [ ] 5.6 Non-admin still can't access `/admin`
