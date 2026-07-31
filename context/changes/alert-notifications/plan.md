# Alert Notifications (S-05) Implementation Plan

## Overview

Implement the daily notification pipeline: after the existing cron fetches market data, evaluate every user's active alerts against the freshly written price/RSI values, send an email via Resend when a threshold is genuinely crossed (respecting a user-chosen direction and a re-arm buffer), and record every trigger — successful or not — in a new `trigger_events` table. The alert form and list also gain an explicit direction field and an active/inactive status so users understand what their alert is currently watching for.

## Current State Analysis

- The cron handler (`src/worker/scheduled.ts:25-62`) fetches closes from Yahoo Finance, computes RSI, and upserts `price_history`/`market_data`. It does not evaluate alerts — that logic doesn't exist yet.
- `alerts` (`migrations/0005_create_alerts.sql`, rebuilt in `migrations/0008_instrument_registry.sql`) has columns `id, user_id, ticker, alert_type, threshold, notification_email, created_at, updated_at`, `UNIQUE(user_id, ticker, alert_type, threshold)`. There is no direction, no "armed"/active state, and no history of past triggers.
- `instruments.rsi_eligible` is enforced on `alerts`/`market_data` writes via triggers added in `migrations/0009_rsi_eligibility_triggers.sql` (`trg_alerts_rsi_eligibility_insert/update`, `trg_market_data_rsi_eligibility_insert/update`) — these are bound to the `alerts`/`market_data` tables by name and are dropped whenever those tables are rebuilt.
- Resend is entirely unwired: `src/worker/lib/email.ts` only has `EMAIL_PATTERN`/`normalizeEmail`; there's no SDK, no API call, and no `RESEND_API_KEY` in the `Env` interface (`src/worker/index.ts:7-11`).
- The alert form (`src/app/features/alerts/alert-form/alert-form.ts`) and list (`src/app/features/alerts/alert-list/alert-list.ts`) already follow an established pattern: reactive form with type-driven validators, a Material-themed accordion list backed by `ALERT_SELECT` (`src/worker/routes/alerts.ts:94-111`), Polish UI copy via `$localize`/`i18n` attributes translated in `src/locale/messages.pl.xlf`.
- Tests use Vitest + `@cloudflare/vitest-pool-workers` (`vitest.config.mts`); `test/worker/scheduled.test.ts` stubs global `fetch` and imports the worker's `scheduled` export directly (required — `ScheduledController` isn't structured-cloneable across the `cloudflare:workers` exports RPC boundary).

## Desired End State

After the daily cron runs:
- Every alert whose direction/threshold condition is newly crossed (accounting for its armed state) gets an email attempt and a `trigger_events` row recording the outcome (`sent` or `failed`, with a reason).
- An alert that fires becomes disarmed; it re-arms only once the value retreats at least 10% of the threshold back past the threshold on the safe side — preventing repeated emails from noise right at the line.
- The user can select a direction ("rises above" / "falls below") when creating or editing an alert; the list visually distinguishes armed ("active") alerts from disarmed ("inactive") ones and shows the status explicitly in the detail panel.
- Email delivery is verified by:
  1. Creating a Resend account (manual, human-only step) and generating an API key.
  2. Creating an alert whose direction/threshold is already satisfied by the current market value (so it starts disarmed) and one that isn't (so it starts armed), running the cron locally (`wrangler dev` + manually invoking the scheduled handler, or the existing test suite), and confirming: an email is delivered to the Resend-verified address, a `trigger_events` row is written for both a successful and a sandbox-rejected recipient, and the alert list reflects the new armed/disarmed state after re-running the cron with values that cross back and forth.

### Key Discoveries

- The `alerts` table has been rebuilt twice already (`migrations/0008`, then triggers added in `0009`) using a create-`_new`/copy/drop/rename pattern — this migration follows the same convention because SQLite can't add a `UNIQUE` constraint to an existing table via `ALTER TABLE`, and the constraint needs to grow to include `direction`.
- Rebuilding `alerts` **drops** the `trg_alerts_rsi_eligibility_insert/update` triggers from `migrations/0009` (triggers are bound to the table, not the schema name) — they must be recreated verbatim on the new table in this same migration, or RSI-eligibility enforcement silently disappears.
- Resend's sandbox mode (no verified domain) can only deliver to the Resend account's own verified email address — confirmed against Resend's docs (`resend.com/docs/dashboard/domains/introduction`: "You must add and verify at least one domain... to send and receive emails"). This project stays on the sandbox (no domain purchase); a pre-flight check in the app itself (comparing the alert's `notification_email` to a configured `RESEND_VERIFIED_EMAIL`) substitutes for parsing Resend's rejection response, which is both more explicit and avoids depending on the wording of a third-party error message.
- General hysteresis/deadband practice for threshold alerting uses roughly a 10-20% band to meaningfully suppress noise; RSI traders widen thresholds by a comparable margin to avoid whipsaw. The project settled on **10% of the threshold value** as the re-arm margin, applied uniformly to price and RSI alerts.
- The rest of the codebase avoids third-party SDKs for outbound HTTP (Yahoo Finance is called via raw `fetch` in `src/worker/lib/market-data.ts`) — Resend is called the same way (`https://api.resend.com/emails` via `fetch`), avoiding a new npm dependency and the `nodejs_compat` SDK edge cases noted in `context/foundation/infrastructure.md`'s risk register.

## What We're NOT Doing

- No custom domain purchase or Resend domain verification — email delivery stays sandboxed to a single verified address; delivery to arbitrary recipients (e.g., a course grader with their own account) is out of scope for this change.
- No retry logic for failed Resend sends — a failed send is recorded in `trigger_events` and not retried automatically (consistent with the best-effort, per-alert error handling already used for market data fetches).
- No demo-data seed script — the user will manually create a test account and alerts positioned to trigger naturally; this plan does not add seeding tooling.
- No push/SMS/webhook notification channels (unchanged non-goal from the PRD).
- No changes to the RSI calculation itself (`src/worker/lib/rsi.ts`) — evaluation reads the already-computed `market_data.rsi`/`market_data.price`.
- S-06 (trigger history UI) is a separate, later slice — this plan only creates and populates `trigger_events`; it does not build a UI to browse it.

## Implementation Approach

Extend the existing daily cron with a second stage that runs after market data is written: load all alerts joined to their instrument's current `market_data` row, apply a direction- and margin-aware armed/disarmed state machine per alert, and for every alert whose condition newly fires, attempt a Resend email (skipping the API call up-front if the recipient isn't the sandbox-verified address) and record the outcome in `trigger_events`. Direction and armed state live directly on `alerts` (a schema extension, not a derived/recomputed-per-run value), computed automatically by the backend at create/edit time from the current market value — the user picks the direction, the server decides whether the alert starts armed or disarmed. The frontend surfaces both: a direction selector in the form, and an active/inactive indicator (color + explicit status field) in the list.

## Critical Implementation Details

**Direction and armed state must be computed from `market_data`, not asserted from the request.** On both create and edit, the server looks up the current `market_data.price`/`market_data.rsi` for the alert's ticker (the same row `ALERT_SELECT` already joins), and sets `armed = 0` if the user's chosen direction's condition is already true against that value (e.g., direction `up` and current price already `>= threshold`), or `armed = 1` otherwise. If no `market_data` row exists yet for the ticker (only possible before the very first cron run in a fresh environment), default to `armed = 1`. Edits always recompute both fields from the alert's (possibly new) ticker/threshold/direction — there is no partial-recompute path based on which fields changed, keeping the create and edit code paths identical.

**Trigger firing and re-arming are evaluated in the same pass, but are mutually exclusive per alert per run**: an armed alert can fire (and becomes disarmed); a disarmed alert can re-arm (but does not fire on the same run it re-arms — re-arming only clears the way for the *next* crossing).

## Phase 1: Schema and Migration

### Overview

Add `direction`/`armed` to `alerts` (via the established create-`_new`/copy/drop/rename rebuild, since the `UNIQUE` constraint must grow), recreate the RSI-eligibility triggers on the rebuilt table, and create `trigger_events`.

### Changes Required:

#### 1. New migration

**File**: `migrations/0011_alert_notifications.sql`

**Intent**: Rebuild `alerts` with `direction` (`'up'`/`'down'`) and `armed` (0/1, default 1) columns and a `UNIQUE(user_id, ticker, alert_type, threshold, direction)` constraint; backfill `direction` for existing rows from their current `market_data` value vs. threshold (best-effort — there's no historical "value at creation" for pre-existing rows); recreate the two `trg_alerts_rsi_eligibility_*` triggers from `migrations/0009_rsi_eligibility_triggers.sql` on the new table; create `trigger_events`.

**Contract**:
- `alerts_new` mirrors the current `alerts` shape plus `direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down'))` and `armed INTEGER NOT NULL DEFAULT 1`. The `DEFAULT 'up'` matters beyond the backfill: `test/worker/rsi-eligibility-triggers.test.ts:22,32,48` inserts directly into `alerts` via raw SQL without a `direction` column (it bypasses `alerts.ts` validation on purpose, to test the DB-level triggers) — without a default, those existing inserts would start failing a `NOT NULL` violation unrelated to what they're testing. The application layer (`alerts.ts`) always supplies an explicit, validated `direction` on every INSERT/UPDATE it issues, so this default is only ever exercised by out-of-band raw SQL, never through the API.
- Backfill expression for existing rows (one `INSERT ... SELECT` with a `LEFT JOIN market_data`):
  ```sql
  direction = CASE
    WHEN (CASE alerts.alert_type WHEN 'RSI' THEN market_data.rsi ELSE market_data.price END) < alerts.threshold
      OR (CASE alerts.alert_type WHEN 'RSI' THEN market_data.rsi ELSE market_data.price END) IS NULL
    THEN 'up' ELSE 'down' END
  ```
  (missing market data defaults to `'up'`, matching the same default used for brand-new alerts with no market data yet). `armed` defaults to `1` for all pre-existing rows — their historical trigger state is unknown, so they start fresh.
- `trigger_events` columns: `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL, ticker TEXT NOT NULL, alert_type TEXT NOT NULL, direction TEXT NOT NULL, threshold REAL NOT NULL, value_at_trigger REAL NOT NULL, notification_email TEXT NOT NULL, email_status TEXT NOT NULL CHECK (email_status IN ('sent','failed')), email_error TEXT, triggered_at INTEGER NOT NULL DEFAULT (unixepoch())`. `alert_id` uses `ON DELETE SET NULL` (not `CASCADE`) so a later alert deletion doesn't erase trigger history. Index `idx_trigger_events_user_id ON trigger_events(user_id)`.
- Recreate `idx_alerts_user_id` and both `trg_alerts_rsi_eligibility_insert`/`trg_alerts_rsi_eligibility_update` triggers verbatim (same `WHEN`/body as `migrations/0009_rsi_eligibility_triggers.sql:7-21`) on the rebuilt `alerts` table — omitting this silently removes RSI-eligibility enforcement.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npm run migrate:local`
- Existing alert tests still pass post-migration: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- `wrangler d1 execute marketpulse-db --local --command "SELECT direction, armed FROM alerts"` shows sensible values for any pre-existing local alerts.
- Applying the migration to remote D1 (`npm run migrate:remote`) is a separate, explicit step the user runs — not assumed to happen automatically on deploy.

---

## Phase 2: Backend Alert CRUD Updates

### Overview

Accept and validate an explicit `direction` field on create/edit, compute `armed` server-side from the current market value, and expose both on the API response.

### Changes Required:

#### 1. Alert validation and persistence

**File**: `src/worker/routes/alerts.ts`

**Intent**: Extend `validateAlertInput` to require and validate `direction`; add a helper that looks up the current `market_data` row for the ticker and computes the initial `armed` value; include both fields in the `INSERT`/`UPDATE` statements and in `ALERT_SELECT`.

**Contract**:
- New `VALID_DIRECTIONS = ['up', 'down'] as const`, mirroring the existing `VALID_ALERT_TYPES` pattern (`alerts.ts:7`); `normalizeDirection(direction: unknown): Direction | null`.
- `validateAlertInput`'s return type gains `direction: Direction`; `body.direction` is validated the same way as `alertType` — reject with `{ error: 'invalid direction' }` on a bad value.
- A new function computes `armed` from the ticker + `alertType` + `threshold` + `direction`, reading `market_data.price`/`market_data.rsi` for that ticker (same table `ALERT_SELECT` already joins): `armed = 0` if the direction's condition already holds against the current value, `armed = 1` otherwise (including when there's no `market_data` row yet).
- `ALERT_SELECT` gains `a.direction AS direction, a.armed AS active` — the route handler maps `active` from `0`/`1` to a JSON boolean before responding (D1 returns raw integers for `INTEGER` columns).
- POST/PUT `INSERT`/`UPDATE` statements bind `direction` and the freshly computed `armed`, in both cases (edits always recompute, not just when threshold/ticker changed — see Critical Implementation Details).
- The `409 duplicate alert` path stays as-is; the `UNIQUE` constraint (now including `direction`) makes the existing `err.message.includes('UNIQUE')` check cover the extended key automatically.

### Success Criteria:

#### Automated Verification:

- `test/worker/alerts.test.ts` covers: creating an alert with each direction, rejecting an invalid direction, `armed` computed correctly against a seeded `market_data` row (both "already crossed" and "not yet crossed" cases), and `armed` recomputed on edit when direction/threshold changes: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Creating an alert via the running app with a threshold already crossed by the current value results in an "inactive" alert (verified once Phase 5 UI lands — cross-reference here after that phase).

---

## Phase 3: Resend Integration

### Overview

Add a minimal, dependency-free Resend client (raw `fetch`, no SDK) with the sandbox pre-flight check, plus the manual account setup and secret configuration this depends on.

### Changes Required:

#### 1. Manual prerequisite (human-only)

**Intent**: Create a Resend account (resend.com), note the account's verified email address, and generate an API key from the Resend dashboard. This cannot be automated — there is no API for account creation.

#### 2. Resend client

**File**: `src/worker/lib/resend.ts` (new)

**Intent**: Send a plain-text email via the Resend REST API, with a pre-flight check that skips the network call entirely when the recipient isn't the sandbox-verified address — avoiding any dependency on parsing Resend's rejection error text.

**Contract**: `sendAlertEmail(env: Env, { to, subject, text }: { to: string; subject: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }>`. If `to.toLowerCase() !== env.RESEND_VERIFIED_EMAIL.toLowerCase()`, return `{ ok: false, error: 'recipient not verified in Resend sandbox' }` without calling `fetch`. Otherwise `POST https://api.resend.com/emails` with `Authorization: Bearer ${env.RESEND_API_KEY}`, body `{ from: 'onboarding@resend.dev', to, subject, text }`; a non-2xx response returns `{ ok: false, error: <parsed body message or status text> }`.

#### 3. Env and secrets

**File**: `src/worker/index.ts`

**Intent**: Add the two new bindings the Resend client and pre-flight check need.

**Contract**: `Env` gains `RESEND_API_KEY: string; RESEND_VERIFIED_EMAIL: string;`.

**File**: `.dev.vars` (gitignored, local-only)

**Intent**: Add local-dev values for the two new vars so `wrangler dev` and manual local testing work.

**File**: `vitest.config.mts`

**Intent**: Add dummy values for both vars to `miniflare.bindings` (alongside the existing `PASSWORD_PEPPER`) so tests don't need real Resend credentials — Phase 6 stubs `fetch`, so these values are never actually sent anywhere in tests.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`

#### Manual Verification:

- A Resend account exists; `wrangler secret put RESEND_API_KEY` and `wrangler secret put RESEND_VERIFIED_EMAIL` have been run against the deployed Worker.
- A manual `sendAlertEmail` call (e.g., via a temporary local script or `wrangler dev` console) to the verified address delivers an email to that inbox; a call to any other address returns the pre-flight rejection without hitting the network.

---

## Phase 4: Cron Evaluation and Notification Logic

### Overview

Extend the daily cron to evaluate every alert against the freshly written market data and drive the fire/re-arm state machine, sending emails and recording `trigger_events`.

### Changes Required:

#### 1. Evaluation module

**File**: `src/worker/lib/alert-evaluation.ts` (new)

**Intent**: For every alert joined to its current `market_data` row, apply the direction + armed + 10%-margin state machine described in Desired End State: an armed alert whose direction condition is met fires (send email, record `trigger_events`, disarm); a disarmed alert whose value has retreated past the threshold by the margin re-arms (no email, no `trigger_events` row — just a state flip). Skip alerts with no `market_data` value yet (`price`/`rsi` is `null`). Wrap each alert's processing in try/catch so one alert's failure (a bad email address, a Resend outage) doesn't stop the rest — mirroring `scheduled.ts:58-60`'s existing per-ticker error handling.

**Contract**: `evaluateAlerts(env: Env): Promise<void>`. Query: `SELECT a.id, a.user_id, a.ticker, a.alert_type, a.threshold, a.direction, a.armed, a.notification_email, i.name AS instrumentName, i.currency, m.price, m.rsi FROM alerts a JOIN instruments i ON i.ticker = a.ticker JOIN market_data m ON m.ticker = a.ticker`. Margin = `threshold * 0.10`. Fire condition (armed only): `direction = 'up' ? value >= threshold : value <= threshold`. Re-arm condition (disarmed only): `direction = 'up' ? value <= threshold - margin : value >= threshold + margin`. On fire: build the email body per Phase 4 item 2, call `sendAlertEmail` (outside any batch — it's a network call, not a DB write), then write the `trigger_events` INSERT and the `alerts SET armed = 0` UPDATE together in a single `env.DB.batch([...])` call, exactly like the atomic INSERT+SELECT pairing already used in `alerts.ts:133-143,193-198` — never as two independent sequential `await`s, since a failure between them would leave a trigger recorded but the alert still armed, risking a duplicate email on a later run for the same crossing. On re-arm: `UPDATE alerts SET armed = 1 WHERE id = ?` only (no batch needed — it's a single statement).

#### 2. Email content

**Intent**: Plain-text body mirroring the fields and Polish labels already shown in the alert list detail panel (`alert-list.html:41-63`), so the email reads consistently with the app.

**Contract**: Subject and body are plain text, composed in Polish (this is user-facing product copy shown to the app's Polish-speaking users, the same category as the `.html` template strings referenced in the project's UI-copy language exception). Fields, in order: instrument name + ticker ("Walor"), alert type label ("Typ alertu": "Próg cenowy"/"Próg RSI"), threshold with currency suffix for PRICE only ("Próg"), the triggering value with the same currency rule ("Wartość w dniu wyzwolenia"), and the trigger timestamp formatted `dd.MM.yyyy` ("Data wyzwolenia").

#### 3. Wire into the cron

**File**: `src/worker/scheduled.ts`

**Intent**: Call the new evaluation step after the existing market-data loop completes, so it always reads that day's freshly written values.

**Contract**: `handleScheduled` calls `await evaluateAlerts(env)` as its last step, after the `for (const { ticker, rsi_eligible } of instruments)` loop (`scheduled.ts:37-61`).

### Success Criteria:

#### Automated Verification:

- New `test/worker/alert-evaluation.test.ts` covers: an armed alert fires when its direction's condition is met and does not fire otherwise; a fired alert disarms and does not fire again on a subsequent run with the same value; a disarmed alert re-arms once the value crosses back past the 10% margin (and not before); `trigger_events` is written with `email_status = 'sent'` for the verified recipient and `'failed'` (with a reason, no `fetch` call made) for any other recipient, using a stubbed `fetch` matching the pattern in `test/worker/scheduled.test.ts`; one alert throwing (e.g., a malformed row) doesn't prevent other alerts in the same run from being evaluated: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Create one alert whose condition is already met by the current market value and one that isn't; run the cron locally (`wrangler dev` with a manual trigger, or re-running `npm run test:worker`'s scenarios against real data); confirm an email arrives at the Resend-verified address for the alert that fires, and a `trigger_events` row exists for both.
- Re-run the cron with a value that retreats past the margin, then crosses again; confirm the alert re-arms and fires a second time.

---

## Phase 5: Frontend — Alert Form and List

### Overview

Add the direction selector to the alert form and the active/inactive indicator to the alert list.

### Changes Required:

#### 1. Alert model and service

**File**: `src/app/features/alerts/alerts.service.ts`

**Intent**: Add the two new fields to the client-side model.

**Contract**: `Alert` gains `direction: string; active: boolean;`. `CreateAlertPayload` gains `direction: string;`.

#### 2. Alert form

**File**: `src/app/features/alerts/alert-form/alert-form.ts` and `alert-form.html`

**Intent**: Add a required direction `mat-select`, pre-filled from the edited alert in edit mode, included in the submitted payload.

**Contract**: New form control `direction: [this.data?.alert?.direction ?? 'up', Validators.required]`; new `mat-select` with two `mat-option`s labeled (new i18n keys) `"Wzrost powyżej progu"` (`up`) / `"Spadek poniżej progu"` (`down`); `onSubmit`'s destructured payload gains `direction`.

#### 3. Alert list

**File**: `src/app/features/alerts/alert-list/alert-list.html` and `alert-list.scss`

**Intent**: Gray out the header of an inactive (disarmed) alert and add an explicit status line in the detail panel, reusing existing Material tokens rather than introducing new hardcoded colors.

**Contract**: `mat-expansion-panel-header` gets `[class.inactive]="!alert.active"`; new SCSS rule `mat-expansion-panel-header.inactive { background-color: var(--mat-sys-surface-container-low) !important; color: var(--mat-sys-on-surface-variant); }` (matching `alert-list.scss:9-18`'s panel body / `:25-33`'s muted text tokens — no new colors introduced). New detail row after the existing ones (`alert-list.html:60-62`): `"Status:"` + `"Aktywny"`/`"Nieaktywny"` (new i18n keys), and a `"Kierunek:"` row showing the same two direction labels used in the form.

#### 4. Translations

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add Polish `<target>` entries for every new `i18n`/`i18n-*` key introduced above, following the existing file's format.

**Contract**: Run `npm run extract-i18n` after the template changes to regenerate the source-language entries, then add the Polish translations by hand (same workflow implied by the existing populated file).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Creating an alert whose condition is already met by the current market value shows it immediately as inactive (gray header, "Nieaktywny" status) in the list.
- Editing an alert's threshold or direction across the current market value flips its active/inactive display accordingly.
- Both direction options are selectable and persist correctly through create, edit, and page reload.

---

## Phase 6: Documentation

### Overview

Document the new manual/operational steps so they aren't lost between sessions.

### Changes Required:

#### 1. Infrastructure doc

**File**: `context/foundation/infrastructure.md`

**Intent**: Extend the existing "Getting Started" step 4 (`wrangler secret put RESEND_API_KEY`) to also cover `RESEND_VERIFIED_EMAIL` and the sandbox limitation, so a future reader (human or agent) understands why delivery is restricted to one address.

**Contract**: Add a short note under "Getting Started" step 4: both secrets required, sandbox mode restricts delivery to the Resend account's own verified address, and that a custom domain would be needed to lift that restriction (deliberately out of scope per this plan's "What We're NOT Doing").

### Success Criteria:

#### Automated Verification:

- N/A (documentation only)

#### Manual Verification:

- The updated doc accurately reflects the two required secrets and the sandbox constraint.

---

## Testing Strategy

### Unit Tests:

- Direction/armed computation on alert create and edit (`test/worker/alerts.test.ts`).
- Fire/re-arm state machine edge cases in isolation: exactly-at-threshold, exactly-at-margin-boundary, missing `market_data` (`test/worker/alert-evaluation.test.ts`).

### Integration Tests:

- Full cron run (`test/worker/alert-evaluation.test.ts`, following the `runScheduled()` helper pattern from `test/worker/scheduled.test.ts`) covering fire → disarm → re-arm → fire-again across multiple simulated days, with `fetch` stubbed for both Yahoo Finance and Resend.

### Manual Testing Steps:

1. Create an alert with a threshold not yet crossed; confirm it shows as active.
2. Create an alert with a threshold already crossed by the current value; confirm it shows as inactive immediately.
3. Run the cron against data that crosses the first alert's threshold; confirm an email arrives and the alert becomes inactive.
4. Run the cron again with the same data; confirm no second email is sent.
5. Run the cron with data retreating past the 10% margin, then crossing again; confirm the alert re-arms and fires a second time.
6. Create an alert with a `notification_email` other than the Resend-verified address; confirm it still evaluates and disarms correctly, with a `trigger_events` row showing `email_status = 'failed'`.

## Performance Considerations

Alert evaluation runs once per day against at most a few dozen rows (single-user MVP scale) — no batching or pagination concerns beyond what the existing cron already does. The per-alert try/catch adds negligible overhead; the Resend `fetch` call is the only new I/O per firing alert, bounded by the (small) number of alerts that actually cross a threshold on a given day.

## Migration Notes

`migrations/0011_alert_notifications.sql` is forward-only, consistent with every prior migration in this project. Applying it to production D1 (`npm run migrate:remote`) is a separate, explicit step the user runs after deploying — it is not triggered automatically by `npm run deploy`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05, lines 183-193)
- PRD requirements: `context/foundation/prd.md` (FR-008, FR-008a)
- Existing cron pattern: `src/worker/scheduled.ts:25-62`
- Existing alert CRUD: `src/worker/routes/alerts.ts`
- Existing cron test pattern: `test/worker/scheduled.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema and Migration

#### Automated

- [x] 1.1 Migration applies cleanly locally: `npm run migrate:local` — c48525d
- [x] 1.2 Existing alert tests still pass post-migration: `npm run test:worker` — c48525d
- [x] 1.3 Type checking passes: `npm run typecheck` — c48525d

#### Manual

- [x] 1.4 Pre-existing local alerts show sensible `direction`/`armed` values — c48525d
- [x] 1.5 Migration applied to remote D1 as a separate explicit step — c48525d

### Phase 2: Backend Alert CRUD Updates

#### Automated

- [x] 2.1 `alerts.test.ts` covers direction validation and armed computation: `npm run test:worker` — 6e15c5e
- [x] 2.2 Type checking passes: `npm run typecheck` — 6e15c5e

#### Manual

- [ ] 2.3 Alert created with an already-crossed threshold is inactive (cross-check after Phase 5)

### Phase 3: Resend Integration

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 7c8bc2a

#### Manual

- [x] 3.2 Resend account created; both secrets set on the deployed Worker — 7c8bc2a
- [x] 3.3 Manual send to the verified address delivers; send to any other address is pre-flight-rejected — 7c8bc2a

### Phase 4: Cron Evaluation and Notification Logic

#### Automated

- [x] 4.1 `alert-evaluation.test.ts` covers fire/disarm/re-arm/fire-again and best-effort per-alert error handling: `npm run test:worker`
- [x] 4.2 Type checking passes: `npm run typecheck`

#### Manual

- [ ] 4.3 Email arrives at the verified address when an alert fires; `trigger_events` recorded for both a successful and a rejected recipient
- [ ] 4.4 Alert re-arms and fires again after a margin-crossing retreat and re-cross

### Phase 5: Frontend — Alert Form and List

#### Automated

- [ ] 5.1 Type checking passes: `npm run typecheck`
- [ ] 5.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 5.3 Already-crossed alert shows inactive immediately on creation
- [ ] 5.4 Editing threshold/direction across the current value flips active/inactive display
- [ ] 5.5 Both direction options persist through create, edit, and reload

### Phase 6: Documentation

#### Manual

- [ ] 6.1 Infrastructure doc accurately documents both secrets and the sandbox constraint
