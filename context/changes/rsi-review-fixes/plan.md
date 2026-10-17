# Close the Remaining Divergent RSI Paths Implementation Plan

## Overview

The #211 change made RSI come from one definition (newest 180 closes through `latestRsi`). A review of that change (2026-10-17) found two code paths that still compute a different value, a read path with a different query shape, and several test gaps. This plan closes them so the claim "one RSI calculation everywhere" is true for every path.

## Current State Analysis

Verified against the current code (after #211 and #213):

- **Alert create/edit refresh** — `ensureFreshMarketData` (`src/worker/routes/alerts.ts:147`) calls `refreshInstruments(..., { fullWindow: true })`. In `src/worker/lib/market-refresh.ts:130-131` that option replaces the stored history with an empty map, so RSI is computed from the ~21 closes of the 30-day Yahoo window alone. The result overwrites the converged `market_data.rsi` and seeds the new alert's armed state. This is the original TSM symptom (41 instead of 34). It only runs for a stale or new ticker.
- **Loader failure** — `loadStoredCloses` (`market-refresh.ts:100-112`) swallows a D1 error and clears the map, so every RSI ticker falls back to the 30-day window. The upsert (`market-data.ts:236`) overwrites `rsi` unconditionally, so the short value replaces the good one. The comment "yields the same RSI" is no longer true.
- **History route** — `GET /:ticker/history` (`src/worker/routes/instruments.ts:73-77`) has its own `ORDER BY date DESC LIMIT 180` query without the 300-day floor that `/latest` and the cron loader apply through `loadRecentPriceRows` (`price-history.ts:53-77`). With sparse or old data the three values can differ.
- **Index** — the floor subquery `SELECT date(MAX(date), ...) FROM price_history` scans the whole table on every dashboard load and cron run: the only index is `UNIQUE(ticker, date)`, which is not date-leading. Latest migration is `0016`.
- **Test gaps** — chunking over 90 tickers, loader failure, `fullWindow` RSI and the exact 300-day boundary are untested. The `price-history.test.ts` case "agrees with latestRsi" applies one function twice and asserts equality.

### Key Discoveries:

- `refreshInstruments` has exactly two callers: the cron (`src/worker/scheduled.ts:29`) and `ensureFreshMarketData`. Only the second passes `fullWindow`.
- `fullWindow` is also what widens the Yahoo window to 30 days (`market-refresh.ts:148-149`); that part is correct and stays.
- Per-ticker failures already surface as `TickerResult { status: 'error' }` and feed the existing cron failure notice, so a loader failure needs no new reporting channel.
- `ensureFreshMarketData` ignores the refresh result and catches any throw, so a failed load there still never blocks saving an alert.

## Desired End State

- Every writer of `market_data.rsi` (cron, admin refresh, alert create/edit refresh, instrument add) and every reader (dashboard, history page) derives RSI from the same newest-180-closes input; the alert path no longer overwrites a good value with a short-window one.
- A failed history read never writes an RSI: the affected RSI tickers are reported as errors and keep yesterday's `market_data` row.
- `/history` and `/latest` use the same loader query, so they cannot disagree.
- `MAX(date)` in the floor subquery is served by an index.
- Verified by `npm run test:worker`, `npm run typecheck`, `npm run lint`, plus the manual checks below.

## What We're NOT Doing

- No change to the RSI formula (`rsi.ts`) or to the constants (180 sessions, 300-day floor).
- No per-ticker floor: the floor stays relative to the global newest date. A ticker with no closes for more than 300 days before the freshest ticker shows no data on `/history`, as it already does on the dashboard.
- No new reporting channel for loader failures; the existing per-ticker error and cron failure notice are enough.
- No partial write (price without RSI) on a loader failure.
- Reverting the date tweak in `instruments.test.ts` from #211 (harmless).
- No cron schedule fix (#210), no grouped alert email (#212).

## Implementation Approach

Two phases. Phase 1 fixes the two write-side divergences in `market-refresh.ts`, where the behavior risk is. Phase 2 unifies the read side, adds the index and closes the remaining test gaps. The index needs a migration, which the project does not apply automatically on deploy.

## Critical Implementation Details

- **Loader failure must not become a silent fallback.** When `loadRecentPriceRows` throws, RSI-eligible tickers get `status: 'error'` and are skipped before any Yahoo fetch (no fetch attempts spent, nothing written for them). Non-RSI tickers (VIX) are not loaded at all, so they are unaffected and still refreshed.
- **`fullWindow` keeps its fetch window but gains stored history.** In the `fullWindow` case the stored closes are loaded like in the cron path, then merged with the 30-day fetch (fetched wins), truncated and passed through `rsiFromCloses`. This adds one D1 query to a user-facing request; the alert path already tolerates a refresh failure.
- **Known limitation (accepted in review).** If the stored-history read fails during alert create/edit, the refresh is skipped (RSI tickers are not fetched or written) and the initial armed state is computed from the existing `market_data` row, or defaults to armed when there is none. The cron later refreshes the data but never recomputes `armed`, so at worst one alert mail arrives for a condition that was already true at creation. Writing only the fresh price on such a failure was rejected: it needs a separate upsert variant, helps price alerts only, and contradicts the "no write on failed read" rule.

## Phase 1: Consistent RSI in the refresh paths

### Overview

Make the alert create/edit refresh and the loader-failure case produce the same RSI as the cron, or no RSI write at all.

### Changes Required:

#### 1. Refresh input and failure handling

**File**: `src/worker/lib/market-refresh.ts`

**Intent**: Stop discarding stored history for `fullWindow`, and stop falling back to a short-window RSI when the history read fails.

**Contract**: `loadStoredCloses` no longer catches; it throws on a D1 error. `refreshInstruments` always loads stored closes for the RSI-eligible instruments, including when `fullWindow` is set (`fullWindow` now only forces the 30-day Yahoo window). If the load throws, every RSI-eligible instrument is reported as `{ ticker, status: 'error', error }` (logged with `console.error`), is not fetched and is not written; non-RSI instruments continue as before. The header comment of `loadStoredCloses` and the inline "fall back to the long Yahoo window" wording are rewritten to describe the real behavior. Thin-history rule (`MIN_CLOSES_FOR_RSI`) is unchanged.

#### 2. Tests

**File**: `test/worker/scheduled.test.ts` (and `test/worker/alerts.test.ts` for the alert path)

**Intent**: Pin both fixed behaviors.

**Contract**: (a) with ~180 stored closes, a `fullWindow` refresh stores the same RSI as the history endpoint and the 180-close reference, not the 21-close value (use the existing TSM-style fixture); (b) when the history read fails, the RSI ticker is reported as an error, its `market_data` row is unchanged and no Yahoo fetch is made for it, while a non-RSI ticker in the same run is still written. Simulate the failure by making the loader query throw (for example a `DB` wrapper that rejects the `ROW_NUMBER` statement) rather than dropping the table.

### Success Criteria:

#### Automated Verification:

- `fullWindow` refresh stores the long-series RSI equal to the history endpoint: `npm run test:worker`
- Loader failure reports an error for RSI tickers, leaves their `market_data` unchanged and still refreshes non-RSI tickers: `npm run test:worker`
- Existing scheduled, alerts and admin tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Creating an RSI alert on a ticker whose `market_data` is older than the staleness window leaves the alert list `currentRsi` equal to the dashboard and history RSI (no jump to a short-window value).

**Implementation Note**: After this phase and all automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: One read path, index, remaining test gaps

### Overview

Make `/history` use the shared loader, add the index behind the floor subquery, and close the test gaps found in the review.

### Changes Required:

#### 1. History route

**File**: `src/worker/routes/instruments.ts`

**Intent**: One query shape for every reader of the RSI input.

**Contract**: `GET /:ticker/history` loads rows with `loadRecentPriceRows(c.env.DB, [ticker])` (newest first, floor applied, at most `RSI_INPUT_SESSIONS`) and passes them to `buildHistory`; the route-local SELECT and the `PriceRow` / `RSI_INPUT_SESSIONS` imports it no longer needs are removed. Response shape unchanged; an instrument with no rows inside the floor returns an empty `history`.

#### 2. Index

**File**: `migrations/0017_price_history_date_index.sql`

**Intent**: Serve `MAX(date)` in the floor subquery without scanning the table.

**Contract**: `CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date);` No data change. Applied locally with `npm run migrate:local`; remote application is a separate manual step after deploy (`npm run migrate:remote`).

#### 3. Tests

**File**: `test/worker/price-history.test.ts`, `test/worker/instruments.test.ts`

**Intent**: Close the review's coverage gaps and remove the low-value test.

**Contract**: (a) `loadRecentPriceRows` with more than 90 tickers returns the right rows for tickers in every chunk; (b) a row exactly at the 300-day floor is included and one day older is excluded; (c) `/history` and `/latest` return the same newest RSI for a ticker with sparse data near the floor, and `/history` returns an empty list for a ticker whose rows are all older than the floor; (d) the "agrees with latestRsi" case in `price-history.test.ts` is removed or replaced with a case that adds information (for example `rsiFromCloses` agreement is already covered, so removal is acceptable).

### Success Criteria:

#### Automated Verification:

- Chunking, floor boundary and `/history` vs `/latest` parity tests pass: `npm run test:worker`
- Migration `0017` applies cleanly to a fresh local database: `npm run migrate:local`
- Existing worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- History page and dashboard show the same RSI for a ticker (for example TSM) after the change.
- After deploy, `npm run migrate:remote` applies `0017` without error.

**Implementation Note**: The production migration is applied by the user after `npm run deploy`.

---

## Testing Strategy

### Unit Tests:

- `loadRecentPriceRows`: more than 90 tickers (multi-chunk), exact floor boundary.
- `latestRsi` / `rsiFromCloses` are already covered; no new unit tests beyond the replaced tautology.

### Integration Tests:

- `fullWindow` refresh RSI equals the history endpoint (TSM-style long series).
- Loader failure: error for RSI tickers, unchanged `market_data`, non-RSI ticker still written.
- `/history` and `/latest` parity near the floor.

### Manual Testing Steps:

1. Create an RSI alert on a stale ticker and compare `currentRsi` with the dashboard and history page.
2. After deploy and `npm run migrate:remote`, load the dashboard and the history page for TSM and compare RSI.

## Performance Considerations

`fullWindow` adds one D1 read (up to 180 rows) to alert create/edit when the ticker is stale. The index removes the full-table `MAX(date)` scan from every dashboard load and cron run; it adds one index write per `price_history` insert, which is negligible.

## Migration Notes

`0017` is additive and idempotent (`IF NOT EXISTS`). Per the project's rule, D1 migrations are not applied on deploy: run `npm run migrate:remote` after `npm run deploy`. The code works without the index (only slower), so the order is not critical.

## References

- Review of #211 (done in chat, not saved; the change is archived): `context/archive/2026-10-17-rsi-single-calculation/plan.md`
- Code: `src/worker/lib/market-refresh.ts:98-169`, `src/worker/lib/price-history.ts:53-77`, `src/worker/routes/instruments.ts:62-83`, `src/worker/routes/alerts.ts:133-153`, `src/worker/lib/market-data.ts:231-240`
- Related issues: #211 (parent), #213, #210, #212

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Consistent RSI in the refresh paths

#### Automated

- [x] 1.1 fullWindow refresh stores the long-series RSI equal to the history endpoint — e0647dc
- [x] 1.2 Loader failure reports an error for RSI tickers, leaves their market_data unchanged and still refreshes non-RSI tickers — e0647dc
- [x] 1.3 Existing scheduled, alerts and admin tests pass — e0647dc
- [x] 1.4 Type checking passes — e0647dc
- [x] 1.5 Linting passes — e0647dc

#### Manual

- [x] 1.6 Creating an RSI alert on a stale ticker leaves currentRsi equal to the dashboard and history RSI

### Phase 2: One read path, index, remaining test gaps

#### Automated

- [x] 2.1 Chunking, floor boundary and history vs latest parity tests pass — 5b67619
- [x] 2.2 Migration 0017 applies cleanly to a fresh local database — 5b67619
- [x] 2.3 Existing worker tests pass — 5b67619
- [x] 2.4 Type checking passes — 5b67619
- [x] 2.5 Linting passes — 5b67619

#### Manual

- [x] 2.6 History page and dashboard show the same RSI for a ticker
- [ ] 2.7 After deploy, npm run migrate:remote applies 0017 without error
