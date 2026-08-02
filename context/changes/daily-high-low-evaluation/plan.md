# Daily High/Low Alert Evaluation — Implementation Plan

## Overview

Price-type alerts on VIX and NASDAQ-100 currently fire only when the day's *closing* price crosses the threshold. This misses a real case: threshold 100 ("up" alert), price spikes to 102 intraday, closes back at 99 — today this never fires. This plan makes price alerts fire on the day's high (for "up" alerts) or low (for "down" alerts) instead, using data already present in the daily Yahoo Finance fetch (the `close`-only fields simply aren't parsed yet). RSI alerts are unaffected — RSI is inherently close-derived.

## Current State Analysis

- `src/worker/lib/market-data.ts` fetches Yahoo's daily chart response and only types/parses `indicators.quote[0].close` (`YahooChartResult`, `DailyClose`) — Yahoo's response also carries `high`/`low` in the same object, unused today.
- `src/worker/scheduled.ts` writes the parsed closes into `price_history` (`close` column only) and the latest close into `market_data.price`. Neither table has `high`/`low` columns.
- `src/worker/lib/alert-evaluation.ts`'s `evaluateAlerts` reads `market_data.price`/`.rsi` only (never touches `price_history`) and both firing (`conditionMet`) and re-arming (`hasRetreatedPastMargin`) key off one scalar `value`.
- `src/worker/routes/alerts.ts`'s `computeArmed` (decides a new/edited alert's initial `armed` state) independently re-implements the same close-only directional check against `market_data`.
- Three read surfaces show a single point-in-time value today: the alert list (S-04, `currentPrice`/`currentRsi` from `market_data`), trigger history (S-06, `value_at_trigger` from `trigger_events`), and the 30-day instrument history view (S-07, `close`/`rsi` from `price_history`).
- Full current-state code (exact fields, SQL, and line numbers) was verified via direct research in this planning session; see Key Discoveries below.

## Desired End State

Price alerts fire the day the high (up) or low (down) crosses the threshold, even if the close doesn't. The email, the trigger-history table (S-06), and the 30-day instrument history table (S-07) all show High/Low/Close for that day, not just one value. The alert list (S-04) shows today's High/Low alongside the existing Close/RSI. RSI-alert behavior, re-arm behavior, and the overall once-daily batch cadence are unchanged.

**Verification:** create a "down" PRICE alert on a ticker whose current low is already below the threshold but close is above it (or wait for a natural market day where this happens) — the next cron run fires it, the email shows High/Low/Close, and the event appears in both trigger history and (via the ticker's price_history row) the 30-day history view with high/low populated.

### Key Discoveries:

- `src/worker/lib/market-data.ts:13-18` (`YahooChartResult`) and `:1-4` (`DailyClose`) only declare `close` — Yahoo's `quote[0]` object also exposes `high`/`low` arrays at the same index, already present in every response this code already fetches.
- `src/worker/scheduled.ts:38-62` upserts **every** day returned by `fetchDailyCloses` (which requests `range=1mo`) on every cron run, not just the newest day (`ON CONFLICT (ticker, date) DO UPDATE`). This means once `high`/`low` are parsed and written, the last ~21 trading days of `price_history` self-backfill within the first post-deploy cron run — no explicit backfill migration or script is needed (see Migration Notes).
- `src/worker/lib/alert-evaluation.ts:52-58` (`conditionMet`, `hasRetreatedPastMargin`) and `src/worker/routes/alerts.ts:123-136` (`computeArmed`) independently implement the same directional close-only check — the fix must land in both or the initial `armed` state on alert creation will disagree with what the next cron run decides.
- `trigger_events` (`migrations/0011_alert_notifications.sql:72-86`) has one scalar `value_at_trigger` column, populated from the same `value` used to decide firing (`alert-evaluation.ts:78,105`) — extending it to carry high/low needs new columns, not a repurposed one.
- `market_data`'s `ON CONFLICT (ticker) DO UPDATE` (`scheduled.ts:52-55`) and `price_history`'s `ON CONFLICT (ticker, date) DO UPDATE` (`scheduled.ts:44-47`) both need their `SET` clauses extended, or new `high`/`low` values silently won't overwrite on re-runs.
- Three frontend read models are entirely close/price-scoped today with no `high`/`low` fields: `Alert` (`src/app/features/alerts/alerts.service.ts`), `TriggerEvent` (`src/app/features/trigger-history/trigger-history.service.ts`), `InstrumentHistoryEntry` (`src/app/features/instrument-history/instrument-history.service.ts`).

## What We're NOT Doing

- No intraday polling or real-time data — evaluation stays a once-daily batch job on the same single daily Yahoo fetch (PRD FR-012 explicitly distinguishes this from the "no intraday/real-time" Non-Goal).
- No backfill script/migration for `price_history` rows older than ~1 month back — the existing daily upsert already backfills the last `range=1mo` window automatically (see Key Discoveries); anything older stays `NULL` for `high`/`low` permanently.
- No change to re-arm (`hasRetreatedPastMargin`) logic — it stays based on close, not high/low (confirmed decision, avoids daily re-fire thrash on volatile tickers).
- No change to RSI alert evaluation, RSI calculation (`rsi.ts`), or the RSI display anywhere — RSI is inherently close-derived and untouched by this change.
- No new alert-creation form fields — direction/threshold selection is unchanged; only the values *read* during evaluation change.

## Implementation Approach

Follow the natural dependency order: schema → ingestion → evaluation/business-logic → read APIs → frontend. A single new D1 migration adds nullable `high`/`low` columns to `market_data` and `price_history`, and nullable `high_at_trigger`/`low_at_trigger` to `trigger_events` — all plain `ALTER TABLE ADD COLUMN` (no rebuild needed, unlike prior migrations that renamed columns or added CHECK constraints). The fetch/parse layer and cron writer are extended to carry the new fields through. A single shared helper resolves "the value to evaluate a PRICE alert against" (high/low with close fallback) so `alert-evaluation.ts` and `alerts.ts`'s `computeArmed` can't drift apart again. Read APIs and the three frontend surfaces are extended last, since they're purely additive once the data exists.

## Critical Implementation Details

**Null handling asymmetry**: the existing close-parsing loop (`market-data.ts`) drops a day entirely when `close` is null/undefined — that behavior must stay unchanged. `high`/`low` are handled differently: a day with a valid `close` but a null/missing `high` or `low` must still be kept (with `high`/`low` as `null` for that day), not dropped. Reusing the close's "skip the whole day" logic for high/low would incorrectly discard valid close data on a day where Yahoo just omits high/low.

**Self-backfill window is smaller than the 30-day history view's lookback**: the daily fetch requests `range=1mo` (`market-data.ts:32`), which returns roughly 21 trading days — fewer than the 44 trading days (`HISTORY_DAYS` 30 + `RSI_PERIOD` 14) the instrument-history endpoint reads (`instruments.ts:11-15`). Because `scheduled.ts` upserts every day it fetches on every run, `high`/`low` do backfill automatically over time as the rolling `1mo` window slides forward day by day — but this takes on the order of weeks after deploy to cover the full 44-day lookback, not the very next cron run. Until then, older days in the 30-day history view legitimately have `high: null, low: null`. Treat this the same way the view already treats `rsi: null` during its own ramp-up period (see `test/worker/instruments.test.ts`'s partial-lookback case) — nullable types and blank cells, not a bug to "fix" with a wider fetch.

## Phase 1: Database Schema

### Overview

Add nullable `high`/`low` columns to `market_data` and `price_history`, and nullable `high_at_trigger`/`low_at_trigger` to `trigger_events`.

### Changes Required:

#### 1. New migration

**File**: `migrations/0013_daily_high_low.sql` (new)

**Intent**: Store daily high/low alongside close (for evaluation and display), and record them at trigger time (for the email and both history views).

**Contract**: Six `ALTER TABLE ... ADD COLUMN ... REAL` statements (nullable, no `DEFAULT`, no rebuild needed — matches the simple-ALTER style of `migrations/0010_instrument_currency.sql`, unlike the shadow-table rebuilds in `0008`/`0011` which were needed only because those touched renames/CHECK constraints):

```sql
ALTER TABLE market_data ADD COLUMN high REAL;
ALTER TABLE market_data ADD COLUMN low REAL;
ALTER TABLE price_history ADD COLUMN high REAL;
ALTER TABLE price_history ADD COLUMN low REAL;
ALTER TABLE trigger_events ADD COLUMN high_at_trigger REAL;
ALTER TABLE trigger_events ADD COLUMN low_at_trigger REAL;
```

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to local D1: `npx wrangler d1 migrations apply --local <db-name>`
- Existing full test suite still passes post-migration: `npm run test:worker` (or repo's equivalent vitest command for `test/worker/**`)

#### Manual Verification:

- None — schema-only change, covered by automated migration apply + existing suite not breaking.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Market Data Ingestion

### Overview

Parse `high`/`low` from Yahoo's chart response and persist them into `price_history` and `market_data` on every cron run.

### Changes Required:

#### 1. Yahoo fetch/parse layer

**File**: `src/worker/lib/market-data.ts`

**Intent**: Carry `high`/`low` through the same parse this code already does for `close`, without changing which days get dropped.

**Contract**: `YahooChartResult.indicators.quote[0]` gains `high?: Array<number | null>`, `low?: Array<number | null>`. `DailyClose` gains `high: number | null`, `low: number | null`. In the existing per-day loop: keep the current "skip the day if `close` is null/undefined" behavior unchanged; for a kept day, set `high`/`low` to the corresponding array value or `null` if absent (do not drop the day for missing high/low — see Critical Implementation Details).

#### 2. Cron writer

**File**: `src/worker/scheduled.ts`

**Intent**: Persist the newly-parsed `high`/`low` into both tables, including on upsert re-runs.

**Contract**: `price_history` INSERT gains `high, low` columns and values; its `ON CONFLICT (ticker, date) DO UPDATE SET` gains `high = excluded.high, low = excluded.low`. `market_data` INSERT gains `high, low` bound from the latest day's record (`closes[closes.length - 1].high/.low`); its `ON CONFLICT (ticker) DO UPDATE SET` gains `high = excluded.high, low = excluded.low`.

#### 3. Test fixtures and cases

**File**: `test/worker/market-data.test.ts`

**Intent**: Cover the new parsing behavior, especially the null-handling asymmetry.

**Contract**: Extend `validChartBody(timestamps, closes, highs?, lows?)` to optionally build `indicators.quote[0].high`/`.low`. Add cases: high/low are parsed into `DailyClose` correctly; a day with a valid close but null high/low keeps the day with `high: null, low: null` (not dropped); existing all-null-close and malformed-body cases are unaffected.

**File**: `test/worker/scheduled.test.ts`

**Intent**: Cover the cron writer persisting and upserting high/low.

**Contract**: Extend `yahooBody(timestamps, closes, highs?, lows?)` the same way; extend `MarketDataRow` with `high`/`low`; assert `price_history` and `market_data` rows carry the expected `high`/`low` after a run, and that a second overlapping run correctly overwrites them (extends the existing dedupe-on-rerun test).

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including the new/extended cases above
- Type checking passes: `npm run typecheck` (or repo's equivalent for the Workers project)

#### Manual Verification:

- Trigger a local cron run (`wrangler dev` + manual `scheduled` invocation, or the project's existing local-dev cron trigger method) and inspect `price_history`/`market_data` rows via `wrangler d1 execute --local` to confirm `high`/`low` are populated for both tickers.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Alert Evaluation & Armed-State Logic

### Overview

Firing for PRICE alerts switches to high (up) / low (down) with a close fallback when null; re-arming stays close-based; `trigger_events` records the day's high/low; the email lists High/Low/Close; and `computeArmed` is aligned to the same firing rule so alert creation and cron evaluation never disagree.

### Changes Required:

#### 1. Shared value-resolution helper

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: One function decides "what value does a PRICE or RSI alert fire against", shared by both `evaluateAlerts` and (via export) `alerts.ts`'s `computeArmed`, so the two can't drift apart.

**Contract**: New exported function, e.g.:

```ts
export interface MarketSnapshot {
  price: number;
  rsi: number | null;
  high: number | null;
  low: number | null;
}

export function resolveFiringValue(
  alertType: 'PRICE' | 'RSI',
  direction: 'up' | 'down',
  snapshot: MarketSnapshot,
): number | null {
  if (alertType === 'RSI') return snapshot.rsi;
  const directional = direction === 'up' ? snapshot.high : snapshot.low;
  return directional ?? snapshot.price;
}
```

`AlertEvalRow` gains `high: number | null`, `low: number | null`; the `evaluateAlerts` SELECT gains `m.high, m.low`. `conditionMet` is now called with `resolveFiringValue(...)` instead of the raw `alert.price`/`alert.rsi` scalar. `hasRetreatedPastMargin` keeps receiving the existing close/rsi scalar unchanged (re-arm stays close-based, per the confirmed decision).

#### 2. Trigger recording and email

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Record and display High/Low/Close together for PRICE alerts, not just the value that fired.

**Contract**: `trigger_events` INSERT gains `high_at_trigger`, `low_at_trigger` bound from `alert.alert_type === 'PRICE' ? alert.high : null` / `... alert.low : null` (both populated together, independent of direction — not just the crossing side). `buildEmail` for `alert_type === 'PRICE'` replaces the single "Wartość w dniu wyzwolenia" line with three lines (High, Low, Close), omitting High or Low individually when `null` (fallback day); RSI alerts keep the existing single-value line unchanged.

#### 3. Armed-state consistency

**File**: `src/worker/routes/alerts.ts`

**Intent**: `computeArmed` must use the same firing rule as the cron, so a newly created/edited alert's initial `armed` state matches what the very next evaluation would decide.

**Contract**: `CurrentMarketValue` gains `high: number | null`, `low: number | null`; its `SELECT` gains `high, low`. Keep the existing early return unchanged: if `row` is `null` (no `market_data` row exists yet for the ticker — e.g. a freshly-registered instrument with no cron run yet), return `armed = 1` immediately, exactly as today, **before** touching `resolveFiringValue`. Only once `row` is confirmed non-null, call `resolveFiringValue` (imported from `alert-evaluation.ts`) with a `MarketSnapshot` built from `row`, followed by the existing `conditionMet`-equivalent directional check. This preserves the existing "no market data yet → armed" test (`test/worker/alerts.test.ts:73-108`, alert created with no seeded `market_data` row, expects `active: true`). `ALERT_SELECT` additionally gains `m.high AS currentHigh, m.low AS currentLow` (consumed by the frontend in Phase 5).

#### 4. Test coverage

**File**: `test/worker/alert-evaluation.test.ts`

**Intent**: Cover high/low-based firing, close-based re-arm, the fallback path, and a full RSI regression check.

**Contract**: Extend `seedMarketData(ticker, price, rsi?, high?, low?)` with optional `high`/`low` params. Add cases: an "up" PRICE alert fires when `high` crosses the threshold while `price` (close) stays below it; a "down" PRICE alert fires when `low` crosses while `price` stays above it; an alert does **not** re-arm purely because `high`/`low` retreated — re-arm still requires `price` (close) to retreat past the margin; when `high`/`low` are `null`, firing falls back to comparing against `price` (existing close-only behavior); a fired PRICE alert's `trigger_events` row carries the day's `high_at_trigger`/`low_at_trigger`; all 10 existing RSI/PRICE test cases continue to pass unmodified (regression).

**File**: `test/worker/alerts.test.ts`

**Intent**: Cover `computeArmed`'s alignment with the new firing rule.

**Contract**: Add a case mirroring the existing `armed-*-already-met` tests but seeding `market_data` with a `low` below threshold and a `price` (close) above it for a "down" alert — expect `active: false` (armed=0) at creation, proving `computeArmed` now uses `low`, not just `price`.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including all new/extended cases above
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Manually seed a "down" alert scenario (low below threshold, close above) via local D1, create the alert via the UI, and confirm it shows as inactive (`armed = 0`) immediately — no waiting for the next cron run.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: History & Trigger APIs

### Overview

Expose the new `high`/`low` and `high_at_trigger`/`low_at_trigger` fields through the trigger-history and 30-day instrument-history endpoints.

### Changes Required:

#### 1. Trigger history endpoint

**File**: `src/worker/routes/trigger-events.ts`

**Intent**: Return the day's high/low alongside the existing `valueAtTrigger`.

**Contract**: `TriggerEventRow` gains `high_at_trigger: number | null`, `low_at_trigger: number | null`; the `SELECT` gains `te.high_at_trigger, te.low_at_trigger`; the mapped response DTO gains `highAtTrigger`, `lowAtTrigger` (camelCase, matching the existing `valueAtTrigger` convention).

#### 2. Instrument history endpoint

**File**: `src/worker/routes/instruments.ts`

**Intent**: Return per-day high/low in the 30-day history response.

**Contract**: The `/:ticker/history` `SELECT` becomes `SELECT date, close, high, low FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?`; the row type and the `history.map` output gain `high: number | null`, `low: number | null` per entry (nullable — see Critical Implementation Details on the self-backfill window). RSI computation (`calculateRSISeries`) stays close-only, unchanged.

#### 3. Test coverage

**File**: `test/worker/trigger-events.test.ts`

**Intent**: Cover the new response fields.

**Contract**: Extend `TriggerEventOverrides`/`seedTriggerEvent` with optional `highAtTrigger`/`lowAtTrigger`, extend the INSERT column list, add an assertion that `GET /api/trigger-events` returns `highAtTrigger`/`lowAtTrigger` for a seeded row.

**File**: `test/worker/instruments.test.ts`

**Intent**: Cover the new history fields.

**Contract**: Extend `seedPriceHistory(ticker, closes, highs?, lows?)` with optional `high`/`low` arrays, add an assertion (in the existing `^NDX` full-lookback case) that returned history entries carry the seeded `high`/`low` values.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including the new/extended cases above
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- None beyond the automated coverage — this phase is a pure read-path extension with no new business logic.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Frontend Display

### Overview

Show High/Low/Close (or High/Low alongside existing Close/RSI) on the alert list (S-04), trigger history (S-06), and instrument history (S-07).

### Changes Required:

#### 1. Alert list

**File**: `src/app/features/alerts/alerts.service.ts`, `src/app/features/alerts/alert-list/alert-list.ts`, `src/app/features/alerts/alert-list/alert-list.html`

**Intent**: Show today's High/Low next to the existing Close/RSI on each PRICE alert's detail panel.

**Contract**: `Alert` interface gains `currentHigh: number | null`, `currentLow: number | null` (matching the backend's `currentHigh`/`currentLow` from Phase 3). Template adds High/Low lines near the existing "Current price" block (`alert-list.html`, current price block), shown only for PRICE-type alerts (mirroring the existing `showCurrentRsi`-style conditional pattern for RSI).

#### 2. Trigger history

**File**: `src/app/features/trigger-history/trigger-history.service.ts`, `src/app/features/trigger-history/trigger-history.ts`, `src/app/features/trigger-history/trigger-history.html`

**Intent**: Add High/Low columns to the trigger-history table.

**Contract**: `TriggerEvent` interface gains `highAtTrigger: number | null`, `lowAtTrigger: number | null`. `DISPLAYED_COLUMNS` gains `highAtTrigger`/`lowAtTrigger` (positioned next to `valueAtTrigger`); matching `matColumnDef` blocks added to the table template, following the existing column pattern.

#### 3. Instrument history

**File**: `src/app/features/instrument-history/instrument-history.service.ts`, `src/app/features/instrument-history/instrument-history.ts`, `src/app/features/instrument-history/instrument-history.html`

**Intent**: Add High/Low columns to the 30-day history table.

**Contract**: `InstrumentHistoryEntry` gains `high: number | null`, `low: number | null` (nullable — see Critical Implementation Details; the self-backfill window is smaller than this view's 44-day lookback, so older days legitimately have no high/low for weeks after deploy). The `displayedColumns` computed gains `high`/`low` (both `rsiEligible` branches, since high/low apply regardless of RSI eligibility); matching `matColumnDef` blocks added, rendering a blank cell for `null` — following the exact same pattern already used for `rsi: number | null` in this table (see `instrument-history.html`'s existing RSI column).

### Success Criteria:

#### Automated Verification:

- Frontend build succeeds: `npm run build`
- `npm run test:worker` (backend) still green after full-stack wiring

#### Manual Verification:

- Alert list: a PRICE alert on a seeded ticker shows Close, High, and Low values in its detail panel.
- Trigger history: a seeded/real trigger event row shows High and Low columns alongside the existing threshold/value/status columns.
- Instrument history: the 30-day table for both `^VIX` and `^NDX` shows High/Low columns populated for recent days.
- End-to-end: manually cause a "down" alert to fire via a seeded low-below-threshold/close-above-threshold scenario, confirm the received email lists High/Low/Close, and confirm the same event then appears correctly in both S-06 and (via `price_history`) S-07.

**Implementation Note**: This is the final phase — after all automated verification passes, pause here for manual confirmation from the human that the full end-to-end manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `market-data.ts` parsing: high/low extracted correctly; close-null day dropped; close-present/high-low-null day kept with nulls.
- `alert-evaluation.ts`: `resolveFiringValue` for all four combinations (PRICE up/down, RSI), including the null-fallback path.

### Integration Tests:

- `scheduled.test.ts`: full cron run writes high/low to both tables and correctly upserts on re-run.
- `alert-evaluation.test.ts`: high/low-driven firing, close-based re-arm, trigger_events high/low recording, full RSI regression.
- `alerts.test.ts`: `computeArmed` alignment with the new firing rule.
- `trigger-events.test.ts` / `instruments.test.ts`: new response fields present and correct.

### Manual Testing Steps:

1. Run the migration locally and confirm no errors.
2. Run a local cron invocation and inspect `price_history`/`market_data` for populated high/low.
3. Seed a "down" alert scenario (low below threshold, close above) and confirm the alert starts inactive.
4. Force a fire (seed high/low crossing a threshold) and confirm: email shows High/Low/Close; trigger history shows High/Low; alert list shows High/Low for that ticker.
5. Confirm RSI alerts behave identically to before (no High/Low fields shown, no evaluation change).

## Performance Considerations

None beyond the existing pipeline — this adds two extra scalar fields to an already-fetched, already-parsed, already-written daily record for 2 tickers/day. No new network calls, no new cron frequency.

## Migration Notes

The new migration only adds nullable columns — existing `price_history`/`market_data`/`trigger_events` rows get `NULL` for `high`/`low`/`high_at_trigger`/`low_at_trigger` and are otherwise untouched. Because `scheduled.ts` already re-fetches and upserts a full `range=1mo` window on every run (not just the newest day), `price_history` and the current `market_data` row self-backfill `high`/`low` for the days that pass through that rolling ~21-trading-day window — but the 30-day instrument history view (S-07) needs 44 trading days of lookback (30 display + 14 RSI ramp-up), which is *wider* than the self-backfilling window. Full backfill of the display range therefore takes on the order of weeks after deploy, not the first cron run; older days show blank High/Low cells in the meantime (Phase 5.3, mirroring the existing `rsi: null` ramp-up pattern in the same table). No explicit backfill migration is needed to reach a *working* state, only to reach a *fully populated* one — and a future admin-panel capability to trigger an on-demand historical fetch for a specific instrument/date-range (raised during plan review, not yet scoped as its own change) would be a natural way to accelerate that later without any changes to this plan's nullable-safe design.

Per project convention, D1 migrations are not auto-applied on deploy — `wrangler d1 migrations apply --remote` must be run as a separate, human-executed step after this change ships.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-08: daily-high-low-evaluation)
- PRD requirement: `context/foundation/prd.md` (FR-012)
- Existing evaluation logic: `src/worker/lib/alert-evaluation.ts:52-121`
- Existing ingestion: `src/worker/lib/market-data.ts:1-84`, `src/worker/scheduled.ts:1-65`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database Schema

#### Automated

- [x] 1.1 Migration applies cleanly to local D1
- [x] 1.2 Existing full test suite still passes post-migration

### Phase 2: Market Data Ingestion

#### Automated

- [ ] 2.1 `npm run test:worker` passes, including new/extended cases
- [ ] 2.2 Type checking passes

#### Manual

- [ ] 2.3 Local cron run confirmed to populate high/low in price_history/market_data

### Phase 3: Alert Evaluation & Armed-State Logic

#### Automated

- [ ] 3.1 `npm run test:worker` passes, including new/extended cases
- [ ] 3.2 Type checking passes

#### Manual

- [ ] 3.3 Manually seeded "down" alert scenario starts inactive at creation

### Phase 4: History & Trigger APIs

#### Automated

- [ ] 4.1 `npm run test:worker` passes, including new/extended cases
- [ ] 4.2 Type checking passes

### Phase 5: Frontend Display

#### Automated

- [ ] 5.1 Frontend build succeeds
- [ ] 5.2 `npm run test:worker` still green

#### Manual

- [ ] 5.3 Alert list shows Close/High/Low for a PRICE alert
- [ ] 5.4 Trigger history shows High/Low columns
- [ ] 5.5 Instrument history shows High/Low columns for both tickers
- [ ] 5.6 End-to-end fired-alert scenario verified across email, S-06, and S-07
