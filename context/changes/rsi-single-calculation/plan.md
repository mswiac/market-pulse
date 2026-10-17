# One RSI Calculation Everywhere Implementation Plan

## Overview

Make every RSI value in the system come from one shared definition: the same input (the newest 180 closes of a ticker from `price_history`) fed through the same function. Today two independent code paths compute RSI from two different, too-short inputs, so the stored `market_data.rsi` (used by alerts) disagrees with the dashboard, the history page and TradingView.

## Current State Analysis

Taken from the frame brief (`context/changes/rsi-single-calculation/frame.md`, confidence HIGH):

- **Reported observation**: TSM alert (RSI <= 40) sent no email; stored RSI was 41.38 while the true RSI was about 34.2.
- **Problem statement**: the system has no single definition of how RSI is calculated. Two code paths compute it from two different, too-short inputs, so the stored value used by alerts, the dashboard and the history page can each differ from the true RSI and from each other.
- Formula (`rsi.ts`) is correct; the series is too short for Wilder smoothing to converge (needs about 100+ closes).

### Key Discoveries:

- Write side: `src/worker/lib/market-refresh.ts:105-132` loads stored closes of the last 30 calendar days; `:183-190` merges them with the fetched closes (about 23 closes) and calls `calculateRSI`; the result is upserted into `market_data.rsi`.
- Read side: `src/worker/lib/price-history.ts:9-30` (`LOOKBACK_DAYS = 44` rows) feeds `buildHistory`; used by `GET /api/instruments/:ticker/history` (`src/worker/routes/instruments.ts:90-103`) and `GET /api/instruments/latest` (`:34-80`, window query with a `-70 days` floor).
- Consumers of `market_data.rsi`: `alert-evaluation.ts:176`, `routes/alerts.ts:172` (initial armed state), `routes/alerts.ts:203` (`currentRsi`). The frontend never computes RSI.
- The admin market-data backfill (`routes/admin.ts`) writes only `price_history`, so `market_data.rsi` is refreshed only by the next cron or alert-create refresh.
- All 33 prod instruments already have at least 179 stored closes (checked after the manual backfill).
- Existing tests to keep green or adjust: `test/worker/instruments.test.ts` (history lookback assumptions), `test/worker/scheduled.test.ts` (stored-closes seeding), `test/worker/alerts.test.ts:144` (full-window refresh), `test/worker/rsi.test.ts`.

## Desired End State

- One definition lives in `src/worker/lib/price-history.ts`: RSI period, warm-up length, input length (180 = 30 displayed days + 150 warm-up sessions), the date floor for reading, one function returning the latest RSI of an ascending close series, and one loader that reads the newest rows per ticker.
- History page, dashboard and `market_data.rsi` all use them, so for the same stored data the three values are identical (verified by a parity test).
- For TSM the dashboard, history page and alert list show the same RSI (about 34) and it matches TradingView within rounding.
- Verified by: `npm run test:worker`, `npm run typecheck`, `npm run lint`, plus the manual checks in Phase 2.

## What We're NOT Doing

- No change to the RSI formula (`rsi.ts`).
- No separate tool to recompute `market_data.rsi` silently. The next scheduled cron recomputes it for every ticker with an alert; alerts whose condition is truly met will fire (decided: let them fire).
- No change to "too little history" behavior: RSI is still computed from 15 closes up (less accurate until history fills), and the Yahoo fetch window for a ticker with thin history stays 30 days. Fetching about a year of history and validating when an instrument is added is #213.
- No cron schedule fix (#210), no grouped alert emails (#212).
- No new migration or schema change.

## Implementation Approach

Two phases. Phase 1 introduces the shared definition and moves the read side (history, dashboard) onto it, because the read side already has the full-series code and tests. Phase 2 moves the write side (refresh and cron) onto the same definition and adds the parity test that guards against a third, divergent path.

## Critical Implementation Details

- **Truncate after merge.** In the refresh path, merge stored and freshly fetched closes by date (fetched wins), sort ascending, and then keep only the newest `RSI_INPUT_SESSIONS`. Without the truncation the stored value is computed from a longer series than the history page reads right after the same write, and the two can differ in the second decimal.
- **CPU on `scheduled()`.** Loading up to 180 rows for each ticker with an alert adds work to a handler whose measured CPU is 11-17 ms (PL fetch 11-14, US fetch 14-17) against a 10 ms claim. Read only the tickers being refreshed, in one query per chunk, and check CPU in Observability after the first real cron (Phase 2 manual verification).

## Phase 1: Shared RSI definition and read side

### Overview

Introduce the shared constants, latest-RSI function and row loader in `price-history.ts`; switch the history page and dashboard to a 180-row input.

### Changes Required:

#### 1. Shared definition

**File**: `src/worker/lib/price-history.ts`

**Intent**: Single home for "how RSI is calculated here". Replace the 44-row `LOOKBACK_DAYS` with the 180-session input and add the shared helpers so no other file defines its own window or calls `calculateRSI*` directly for product values.

**Contract**: Exports `RSI_PERIOD` (14), `HISTORY_DAYS` (30), `RSI_WARMUP_SESSIONS` (150), `RSI_INPUT_SESSIONS` (`HISTORY_DAYS + RSI_WARMUP_SESSIONS`, replaces `LOOKBACK_DAYS`), a date-floor constant in calendar days (300, wide enough for 180 sessions including holidays), `latestRsi(closesAscending: number[]): number | null` (last entry of `calculateRSISeries` with `RSI_PERIOD`), and `loadRecentPriceRows(db, tickers | null): Promise<Map<string, PriceRow[]>>` returning newest-first rows, at most `RSI_INPUT_SESSIONS` per ticker, using one `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)` query per chunk of at most 90 tickers (D1 bound-parameter cap), `null` meaning every ticker. `buildHistory` keeps its signature and still returns the last `HISTORY_DAYS` entries.

#### 2. History and dashboard routes

**File**: `src/worker/routes/instruments.ts`

**Intent**: Use the shared loader and constants instead of the route-local window query, so `/latest` and `/history` read the same 180 rows.

**Contract**: `/latest` calls `loadRecentPriceRows(db, null)` and drops its own `-70 days` SQL; `/history` reads `RSI_INPUT_SESSIONS` rows (`LIMIT`) instead of `LOOKBACK_DAYS`. Response shapes unchanged (history still 30 entries).

### Success Criteria:

#### Automated Verification:

- Unit tests for `latestRsi` and `buildHistory` pass, including a 180-row series checked against an independently computed Wilder reference value (not produced by the code under test): `npm run test:worker`
- `instruments.test.ts` is updated for the 180-row input (history still returns 30 entries; early entries have RSI once 15+ rows exist) and passes: `npm run test:worker`
- Dashboard `/latest` RSI equals the newest `/history` entry for the same ticker on a long seeded series: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- After deploying this phase alone, the history page for TSM shows RSI near 34.2 for the latest day and the dashboard shows the same number.

**Implementation Note**: After this phase and all automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Refresh and cron write the same RSI

### Overview

Make the stored `market_data.rsi` use the same loader, window and function, and add the guard test.

### Changes Required:

#### 1. Refresh input

**File**: `src/worker/lib/market-refresh.ts`

**Intent**: Replace `loadStoredCloses` (30 calendar days) with the shared `loadRecentPriceRows` for the tickers being refreshed, and compute the stored RSI with `latestRsi` over the merged-and-truncated series. Remove the now-unused 30-day read window; `LONG_LOOKBACK_DAYS` stays only as the Yahoo fetch window for thin-history tickers.

**Contract**: Per ticker, input = stored rows plus fetched closes, fetched wins on the same date, sorted ascending, truncated to the newest `RSI_INPUT_SESSIONS`, then `latestRsi`. The thin-history rule is unchanged (`MIN_CLOSES_FOR_RSI = 15` stored rows selects the long Yahoo window). A loader failure still means "treat as thin" (falls back to the long fetch window). `calculateRSI` is no longer imported by this file.

#### 2. Parity and regression tests

**File**: `test/worker/scheduled.test.ts` (and `test/worker/instruments.test.ts` if shared fixtures help)

**Intent**: Prove the write and read sides agree and reproduce the reported bug.

**Contract**: (a) seed a long series (about 180 closes) where a 23-close calculation and the full calculation land on opposite sides of a threshold (like TSM: 41 vs 34), run the fetch phase, and assert `market_data.rsi` equals the newest RSI from the history endpoint and the full-series reference; (b) a ticker with fewer than 180 stored rows still gets an RSI (no behavior change for thin history); (c) a fetched revised close for a stored date wins.

### Success Criteria:

#### Automated Verification:

- Parity test: `market_data.rsi` after a refresh equals the newest `/history` RSI and the dashboard RSI for the same data: `npm run test:worker`
- Regression test for the TSM-style case (RSI below threshold only with the long series) passes: `npm run test:worker`
- Existing scheduled, alerts and admin tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- After deploy and the next scheduled cron (or the admin "Force data refresh" button, which also evaluates alerts and can send real emails), the TSM alert fires if its condition is met, and the alert list `currentRsi`, dashboard and history show the same value, matching TradingView within rounding.
- Observability shows PL and US fetch cron CPU times in the same range as before (11-17 ms) and no new subrequest or CPU errors.
- Other armed RSI alerts that now truly meet their condition fire once; no alert fires that should not.

---

## Testing Strategy

### Unit Tests:

- `latestRsi` against independently computed Wilder reference values on 180 closes, and agreement with the last entry of `calculateRSISeries`.
- `buildHistory` on 180 rows returns 30 entries; early entries have RSI.
- `loadRecentPriceRows` returns at most `RSI_INPUT_SESSIONS` newest rows per ticker, newest first, and respects the ticker filter and chunking.

### Integration Tests:

- Parity between refresh-written `market_data.rsi`, `/history` newest entry and `/latest` for the same data.
- TSM-style regression (below threshold only with the long series).

### Manual Testing Steps:

1. Deploy, open TSM in the history page and the dashboard, compare to TradingView (RSI 14, close).
2. After the next cron, compare the alert list `currentRsi` for a ticker with an alert.
3. Check cron CPU in Observability.

## Performance Considerations

The cron now reads up to 180 rows per ticker with an alert (about 33 x 180 = 6k rows worst case) in chunked queries, and the dashboard reads the same on every load. Both are small for D1. The watch item is CPU on `scheduled()` (see Critical Implementation Details); if it regresses, the fallback is to reduce `RSI_WARMUP_SESSIONS` to about 100 (still converged), which is a one-constant change.

## Migration Notes

No schema change. Stored `market_data.rsi` values are corrected by the next refresh of each ticker with an alert; tickers without alerts are refreshed (and corrected) when an alert is first created for them.

## References

- Frame brief: `context/changes/rsi-single-calculation/frame.md`
- Issues: #211 (this change), #213 (fetch and validate on instrument add), #212, #210
- Current code: `src/worker/lib/market-refresh.ts:105-190`, `src/worker/lib/price-history.ts`, `src/worker/routes/instruments.ts:34-103`
- Origins of the old windows: `context/archive/2026-07-24-market-data-pipeline/plan.md:21`, `context/archive/2026-10-08-dashboard-page/plan.md:13,28`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared RSI definition and read side

#### Automated

- [x] 1.1 Unit tests for latestRsi and buildHistory pass, including a 180-row independently computed reference — 9ae1f49
- [x] 1.2 instruments.test.ts updated for the 180-row input and passing — 9ae1f49
- [x] 1.3 Dashboard /latest RSI equals the newest /history entry on a long seeded series — 9ae1f49
- [x] 1.4 Type checking passes — 9ae1f49
- [x] 1.5 Linting passes — 9ae1f49

#### Manual

- [x] 1.6 History page and dashboard show the same RSI for TSM, near 34.2

### Phase 2: Refresh and cron write the same RSI

#### Automated

- [x] 2.1 Parity test: market_data.rsi equals the newest /history RSI and the dashboard RSI
- [x] 2.2 Regression test for the TSM-style case passes
- [x] 2.3 Existing scheduled, alerts and admin tests pass
- [x] 2.4 Type checking passes
- [x] 2.5 Linting passes

#### Manual

- [ ] 2.6 After the next cron, alert list, dashboard and history show the same TSM RSI and the TSM alert fires if its condition is met
- [ ] 2.7 Observability shows cron CPU in the previous 11-17 ms range with no new errors
- [ ] 2.8 No unexpected alerts fire after the deploy
