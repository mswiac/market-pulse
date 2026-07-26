# Instrument Currency Display Implementation Plan

## Overview

Add a `currency` column to the `instruments` table and surface it wherever a price or threshold value is shown — the alert list (summary row + detail panel), the alert create/edit form (read-only), and the instrument history table — so numeric values aren't shown bare with no unit. Currency is manually curated per instrument (same as `ticker`/`name`/`type`), not fetched from Yahoo Finance or written by the daily cron.

## Current State Analysis

- `instruments` (migration `0008_instrument_registry.sql`) holds `ticker`, `name`, `type`, `rsi_eligible`, `provider` — all hand-seeded via `INSERT` statements for `^VIX`/`^NDX`. There is no per-row fetch or update path for these columns; they only change via a new migration.
- `src/worker/lib/market-data.ts` (`fetchDailyCloses`) and `src/worker/scheduled.ts` (`handleScheduled`) only read/write `price_history` and `market_data` (price, rsi) — confirmed out of scope for this change; currency does not flow through the Yahoo fetch or cron write path.
- Three worker routes currently join or select from `instruments` and would need `currency` added to their response shape:
  - `src/worker/routes/instruments.ts` `GET /` — selects `ticker, name, type, rsi_eligible AS rsiEligible`.
  - `src/worker/routes/instruments.ts` `GET /:ticker/history` — looks up `instrument.rsi_eligible` via `InstrumentRow` (`src/worker/lib/instruments.ts`), returns `{ ticker, rsiEligible, history }`.
  - `src/worker/routes/alerts.ts` — `ALERT_SELECT` joins `alerts a JOIN instruments i` and already selects `i.name AS instrumentName`, `i.type AS instrumentType`; used by `POST /`, `GET /`, `PUT /:id`.
- `InstrumentRow` (`src/worker/lib/instruments.ts`) is `{ ticker: string; rsi_eligible: number }` — used by `alerts.ts` (`lookupTicker`) and `instruments.ts` (`/:ticker/history`). Both call sites only read `rsi_eligible`/`ticker` today, so adding a field here is additive and safe.
- Frontend `Instrument` interface (`src/app/features/instruments/instruments.service.ts`) is `{ ticker, name, type, rsiEligible }`, populated once from `GET /api/instruments` and cached in a signal; consumed by `alert-form.ts` (type→ticker cascade) and `instrument-history.ts` (type→ticker cascade, near-identical pattern).
- `Alert` interface (`src/app/features/alerts/alerts.service.ts`) is populated from `GET /api/alerts` (which uses `ALERT_SELECT`); `alert-list.html` renders `alert.threshold`, `alert.currentPrice`, `alert.currentRsi` with `| number: '1.2-2'` and no unit.
- `instrument-history.html`/`.ts` (from S-07) renders a `mat-table` over `sortedHistory()` with `date`/`close`/`rsi` columns; `InstrumentHistoryResponse` (`instrument-history.service.ts`) is `{ ticker, rsiEligible, history }` — has no instrument-level metadata beyond what's already there.
- `alert-form.ts` already computes `instrumentOptions` (client-side filter by `selectedInstrumentType`) and looks up the selected instrument by ticker in `showRsiOption()` — the same lookup pattern extends directly to reading `currency` for the selected ticker.
- Latest migration is `0009_rsi_eligibility_triggers.sql`; next is `0010`.

## Desired End State

Every place a price or threshold value is displayed shows its currency as an ISO-code suffix (e.g. `150.25 USD`): the alert list's summary row and detail panel, the instrument history table's Close column (every row), and the alert form's threshold field (read-only, informational — the field itself stays numeric-only and non-editable for currency). Verify by: viewing the alert list for both `^VIX` and `^NDX` alerts and confirming `USD` appears next to threshold/current price/current RSI-adjacent price values, opening the alert form and seeing `USD` shown next to the threshold input without it being part of the editable value, and viewing `/history` for both instruments and confirming every Close row shows the suffix.

### Key Discoveries:

- `migrations/0008_instrument_registry.sql:1-8` — the exact pattern for hand-seeding a new instrument column: plain `INSERT ... VALUES` for the two existing tickers, no fetch/backfill logic anywhere.
- `src/worker/routes/alerts.ts:94-110` (`ALERT_SELECT`) — single shared SQL fragment used by `POST`, `GET`, `PUT`; adding `i.currency AS currency` here covers all three endpoints in one edit.
- `src/worker/lib/instruments.ts:1-4` (`InstrumentRow`) — minimal shared type; extending it with `currency: string` flows automatically into both of its call sites without touching their logic.
- `src/app/features/alerts/alert-form/alert-form.ts:98-103` — `ticker.valueChanges` already looks up the selected instrument from `instrumentOptions()`; the same lookup gives read-only access to `currency` for a computed display value.

## What We're NOT Doing

- No changes to `src/worker/lib/market-data.ts`, `fetchDailyCloses`, or `src/worker/scheduled.ts` — currency is not parsed from Yahoo's `meta.currency` and not written by the cron.
- No currency conversion, formatting via `Intl.NumberFormat` currency style, or locale-aware symbol lookup — plain ISO code suffix only.
- No admin UI or user-facing way to add/edit instruments or their currency — still exclusively migration-seeded, matching how `ticker`/`name`/`type` work today.
- No editable currency field anywhere — the alert form shows it as read-only, informational text next to the threshold input.
- No backfill/migration tooling for future non-USD instruments beyond documenting the convention (hand-seed alongside the new instrument's other columns, same as today).

## Implementation Approach

Backend-first: add the schema column and thread it through the three existing route responses and their tests (Phase 1), then update the frontend types and templates to display it everywhere a price/threshold value already appears (Phase 2).

## Phase 1: Schema and backend responses

### Overview

Add `instruments.currency`, seed it for `^VIX`/`^NDX`, and expose it from `GET /api/instruments`, `GET /api/instruments/:ticker/history`, and all three `alerts.ts` endpoints.

### Changes Required:

#### 1. Migration

**File**: `migrations/0010_instrument_currency.sql`

**Intent**: Add a `currency` column to `instruments`, backfilled for the two existing rows via `DEFAULT 'USD'` (both `^VIX` and `^NDX` are USD-denominated today) so the column is `NOT NULL` from the start with no separate `UPDATE` statement needed. Include a short comment documenting that future instruments must supply their own `currency` value as part of their seed `INSERT`, the same way `name`/`type` are supplied today.

**Contract**: `ALTER TABLE instruments ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';` — additive-only, no existing rows' other columns touched.

#### 2. Shared instrument row type

**File**: `src/worker/lib/instruments.ts`

**Intent**: Add `currency: string` to `InstrumentRow`.

**Contract**: `export interface InstrumentRow { ticker: string; rsi_eligible: number; currency: string; }`

#### 3. Instruments list and history endpoints

**File**: `src/worker/routes/instruments.ts`

**Intent**: `GET /` selects `currency` alongside the existing columns and includes it verbatim (already a plain string, no coercion needed like `rsiEligible`'s boolean cast) in the mapped response. `GET /:ticker/history`'s existing `SELECT ticker, rsi_eligible ... FROM instruments` gains `currency`, and the response body includes `currency` alongside `ticker`/`rsiEligible`/`history`.

**Contract**: `GET /api/instruments` response items gain `currency: string`. `GET /api/instruments/:ticker/history` response gains a top-level `currency: string` field.

#### 4. Alerts endpoints

**File**: `src/worker/routes/alerts.ts`

**Intent**: Add `i.currency AS currency` to the shared `ALERT_SELECT` fragment so `POST /`, `GET /`, and `PUT /:id` all return it without separate edits per route.

**Contract**: Every `Alert`-shaped JSON response (create, list, update) gains a `currency: string` field.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker` (update existing `instruments.test.ts` expectations for the new `currency` field on `GET /`, `GET /:ticker/history`, and add/extend `alerts.test.ts` coverage for `currency` on create/list/update responses)

#### Manual Verification:

- Apply the migration locally (`wrangler d1 migrations apply` against the local dev DB) and confirm `^VIX`/`^NDX` both read back `currency = 'USD'`

---

## Phase 2: Frontend display

### Overview

Thread `currency` through the frontend `Instrument`/`Alert`/history types and render the ISO-code suffix everywhere a price or threshold value is shown: alert list summary + detail, instrument history table (every row), and the alert form's threshold field (read-only).

### Changes Required:

#### 1. Frontend types

**Files**: `src/app/features/instruments/instruments.service.ts`, `src/app/features/alerts/alerts.service.ts`, `src/app/features/instrument-history/instrument-history.service.ts`

**Intent**: Add `currency: string` to `Instrument`, `Alert`, and `InstrumentHistoryResponse` (and its per-entry or top-level shape, matching whatever Phase 1 landed — top-level on the history response, per Phase 1 item 3's contract).

**Contract**: All three interfaces gain a required `currency: string` field; no signal/computed logic changes needed since these are pass-through DTOs already populated from their respective HTTP calls.

#### 2. Alert list display

**Files**: `src/app/features/alerts/alert-list/alert-list.html`

**Intent**: Append the ISO currency code after the threshold value in the summary row (`mat-panel-title`) and after both `currentPrice` and `currentRsi` values in the detail panel — matching the existing `| number: '1.2-2'` formatting, suffixed with a space and `{{ alert.currency }}`. RSI is a dimensionless indicator (0-100), not a monetary value, but the earlier round of questions confirmed "everywhere" (summary + detail) as the intended placement, so `currentRsi` keeps the suffix per that instruction rather than being special-cased out — call this out in the manual verification step so it's consciously checked, not just implemented on autopilot.

**Contract**: Summary row reads e.g. `150.25 USD`; detail panel's "Current price"/"Current RSI" lines each read e.g. `150.25 USD`. No `i18n` string changes needed — `currency` is data, not template copy.

#### 3. Instrument history table display

**File**: `src/app/features/instrument-history/instrument-history.html`

**Intent**: Append the currency suffix to every row's Close cell (the `numeric-cell` `td` in the `close` `matColumnDef`), reading from the response's top-level `currency` (exposed via a new field/getter on `InstrumentHistory` sourced from the `getHistory()` response, alongside the existing `rsiEligible`/`history` signals).

**Contract**: Each row's Close cell reads e.g. `150.25 USD` instead of `150.25`.

#### 4. Alert form read-only currency display

**Files**: `src/app/features/alerts/alert-form/alert-form.ts`, `src/app/features/alerts/alert-form/alert-form.html`

**Intent**: Add a `computed()` (e.g. `selectedInstrumentCurrency`) that looks up the currently-selected ticker in `instrumentOptions()` the same way `showRsiOption()` does, returning its `currency`. Render it next to the threshold `mat-form-field` as a `mat-hint` (or adjacent read-only text) — informational only, not part of the `formControlName="threshold"` input's editable value, and not submitted as part of the form payload.

**Contract**: The threshold field shows its instrument's currency code alongside it; `form.getRawValue()` and the submitted `CreateAlertPayload` are unchanged (no `currency` key added to the payload — the backend already knows the instrument's currency via `ticker`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Production build succeeds: `npm run build`
- Full CI script passes: `npm run ci`

#### Manual Verification:

- Alert list: both `^VIX` and `^NDX` alerts show `USD` next to the threshold in the summary row
- Alert list detail panel: `USD` appears next to both "Current price" and "Current RSI" values (confirm this reads sensibly for an RSI alert, since RSI isn't a monetary value — flag if it looks wrong so we can revisit)
- Alert form: opening create/edit shows `USD` next to the threshold field, read-only, and submitting the form still works (currency isn't part of the editable input or the request payload)
- Instrument history page: `/history` for both `^VIX` and `^NDX` shows `USD` suffixed on every row's Close value

---

## Testing Strategy

### Unit Tests:

- `alerts.test.ts`: `POST /`, `GET /`, `PUT /:id` responses include `currency: 'USD'` for both `^VIX` and `^NDX` alerts.
- `instruments.test.ts`: `GET /` response items include `currency: 'USD'`; `GET /:ticker/history` response includes top-level `currency: 'USD'` for both tickers.

### Integration Tests:

- None beyond the existing `@cloudflare/vitest-pool-workers` HTTP-round-trip tests in `test/worker/alerts.test.ts` and `test/worker/instruments.test.ts`, extended to assert the new field.

### Manual Testing Steps:

1. Apply migration `0010` locally, confirm `^VIX`/`^NDX` currency backfilled to `USD`.
2. `npm run worker:dev` + `npm start` — walk the full alert list, alert form, and instrument history flows described in each phase's Manual Verification.

## Performance Considerations

None — `currency` is a single extra `TEXT` column read via existing indexed lookups (`ticker` primary key / join), no additional queries introduced.

## Migration Notes

Migration `0010_instrument_currency.sql` adds the column with `DEFAULT 'USD'`, backfilling both existing rows in the same statement — no separate data migration step. Future instruments must supply `currency` explicitly in their seed `INSERT`, same convention as `name`/`type`/`rsi_eligible` today (see `project_instrument_currency_manual` decision — currency is never fetched from Yahoo or written by the cron).

## References

- Issue: [#45 — Surface instrument currency from Yahoo Finance data](https://github.com/mswiac/market-pulse/issues/45) (scope narrowed during planning: manual/migration-seeded currency instead of Yahoo-fetched, per user decision)
- Related pattern: `migrations/0008_instrument_registry.sql` (hand-seeded instrument columns)
- Related pattern: `src/app/features/alerts/alert-form/alert-form.ts:98-103` (selected-instrument lookup by ticker, reused for the read-only currency display)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema and backend responses

#### Automated

- [ ] 1.1 Type checking passes: npm run typecheck
- [ ] 1.2 Worker unit tests pass: npm run test:worker

#### Manual

- [ ] 1.3 Apply migration 0010 locally and confirm ^VIX/^NDX read back currency = 'USD'

### Phase 2: Frontend display

#### Automated

- [ ] 2.1 Type checking passes: npm run typecheck
- [ ] 2.2 Production build succeeds: npm run build
- [ ] 2.3 Full CI script passes: npm run ci

#### Manual

- [ ] 2.4 Alert list summary row shows USD next to threshold for both instruments
- [ ] 2.5 Alert list detail panel shows USD next to Current price and Current RSI
- [ ] 2.6 Alert form shows USD read-only next to threshold field; submit still works
- [ ] 2.7 Instrument history table shows USD suffix on every row's Close value for both instruments
