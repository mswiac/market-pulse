# Reduce CPU time of GET /api/instruments/latest Implementation Plan

## Overview

`GET /api/instruments/latest` (the dashboard endpoint) costs 10–12 ms CPU per request on prod, at or above the Workers Free 10 ms budget, while the other user-facing endpoints cost 0–3 ms (GitHub issue #227). The route loads up to 180 rows per instrument as objects, runs `buildHistory` per instrument (reverse, full RSI series, one object per day) and then keeps only `.at(-1)`. This change gives `/latest` a lighter read path that materialises only what the dashboard shows — the newest day and its RSI — without touching the RSI definition.

## Current State Analysis

- `src/worker/routes/instruments.ts:45-70` — `/latest` calls `loadRecentPriceRows(db, null)` and, per instrument, `buildHistory(rows, rsiEligible).at(-1)`.
- `src/worker/lib/price-history.ts:57-77` — `loadRecentPriceRows` runs a `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)` query with `rn <= RSI_INPUT_SESSIONS` (180) and a 300-day age floor, and reads rows with `.all<PriceRow & { ticker }>()`, i.e. one object per row. It is shared by `/latest`, `/history` and the cron (`loadStoredCloses` in `market-refresh.ts`).
- `src/worker/lib/price-history.ts:81-92` — `buildHistory` reverses the rows, computes the whole RSI series and builds one object per day before slicing to `HISTORY_DAYS`.
- `latestRsi(closesAscending)` (`price-history.ts:35`) already exists and is what `rsiFromCloses` uses for the cron path.
- Parity with `/history` is already guarded: `test/worker/instruments.test.ts` ("matches the history endpoint when the age floor cuts into the ticker series", "matches the newest entry of the history endpoint, including rsi"), `test/worker/price-history.test.ts` (`rsiFromCloses` equals `latestRsi`; `latestRsi` matches an independent reference over 180 closes).

## Desired End State

`/latest` returns exactly the same JSON as today, but its handler no longer builds per-day history objects or full per-instrument arrays of row objects. After deploy, the CPU time shown in the Cloudflare Workers logs for `GET /api/instruments/latest` is measurably lower than the 10–12 ms observed on 2026-10-18. No numeric target: success is a measurable drop with unchanged behaviour.

### Key Discoveries:

- `loadRecentPriceRows` is shared by three callers, so its return shape stays untouched; the lighter path is a new function.
- D1 time is wall time, not Worker CPU; the Worker CPU cost is row deserialisation, object allocation and the RSI loop. The effect of `.raw()` is a hypothesis, not a measured fact — hence the prod measurement in Phase 2.
- CPU of a Worker cannot be measured reliably locally (`wrangler dev` and vitest-pool-workers do not report it like Cloudflare does), so the only trustworthy measurement is the prod logs.

## What We're NOT Doing

- Persisting the latest RSI in `price_history` / `market_data` (option B) — it would change the "one RSI calculation everywhere" design from #211. If A is not enough, that is a separate issue.
- Caching the `/latest` response.
- Changing `loadRecentPriceRows`, `buildHistory`, `/history`, the cron, or the RSI definition / input window.
- Local CPU benchmarking scripts (decided: prod logs only).
- Upgrading off the Workers Free plan.

## Implementation Approach

Add one function to `price-history.ts` that reads the same window with the same SQL but through `.raw()`, and folds each ticker's rows into a small snapshot (newest row fields plus `latestRsi` over that ticker's closes, only for RSI-eligible tickers). The route then maps instruments to snapshots. To keep the window defined in exactly one place, the SQL (age floor, `rn <= RSI_INPUT_SESSIONS`, ordering) is shared with `loadRecentPriceRows` rather than copy-pasted.

## Critical Implementation Details

- **Row order contract**: the query returns rows ordered by `ticker, date DESC`, so the first row seen for a ticker is its newest. The new function relies on that, exactly like `loadRecentPriceRows` does; closes must be reversed to ascending before `latestRsi`.
- **Parity**: the result must equal `buildHistory(rows, eligible).at(-1)` field for field, including the `null` cases (no rows, ineligible instrument, fewer than 15 closes).

## Phase 1: Lighter read path for /latest

### Overview

New raw-read function in `price-history.ts`, route switched to it, tests added; behaviour unchanged.

### Changes Required:

#### 1. Shared window query

**File**: `src/worker/lib/price-history.ts`

**Intent**: Make the SQL text of the 180-session / age-floor window reusable so `loadRecentPriceRows` and the new function cannot drift apart.

**Contract**: A module-private helper that builds the statement (and its bind list) for a ticker group or for all tickers; `loadRecentPriceRows` keeps its signature and return shape and uses it.

#### 2. Latest-snapshot loader

**File**: `src/worker/lib/price-history.ts`

**Intent**: Read the window with `.raw()` (arrays, not objects) and fold it per ticker into the newest row plus its RSI, skipping RSI for ineligible tickers.

**Contract**:

```ts
export interface LatestSnapshot {
  date: string;
  close: number;
  high: number | null;
  low: number | null;
  rsi: number | null;
}
export async function loadLatestSnapshots(
  db: D1Database,
  rsiTickers: ReadonlySet<string>,
): Promise<Map<string, LatestSnapshot>>;
```

A ticker with no rows is absent from the map. `rsi` is `latestRsi(closesAscending)` when the ticker is in `rsiTickers`, otherwise `null`.

#### 3. Route

**File**: `src/worker/routes/instruments.ts`

**Intent**: `/latest` uses `loadLatestSnapshots` instead of `loadRecentPriceRows` + `buildHistory`; the JSON shape (including `null` fields for a ticker without data) is unchanged.

**Contract**: Same response fields as today: `ticker, name, type, currency, rsiEligible, date, close, high, low, rsi`.

#### 4. Tests

**File**: `test/worker/price-history.test.ts`

**Intent**: Cover `loadLatestSnapshots` directly: newest row wins, RSI equals `latestRsi` over the ticker's closes, ineligible ticker gets `null` RSI, ticker without rows is absent, and the result equals `buildHistory(...).at(-1)` for the same rows.

**Contract**: The existing `/latest` vs `/history` parity tests in `test/worker/instruments.test.ts` stay as they are and must keep passing.

### Success Criteria:

#### Automated Verification:

- Types check: `npm run typecheck`
- Lint passes: `npm run lint`
- Worker tests pass (including the existing `/latest` parity tests): `npm run test:worker`

#### Manual Verification:

- Dashboard in the local app shows the same values as before for every instrument (close, RSI, high/low).

---

## Phase 2: Measure on prod

### Overview

After merge and deploy (a human action), compare the CPU of `/latest` with the pre-change baseline.

### Changes Required:

None in code. Record the result in the PR description and as a comment on issue #227.

### Success Criteria:

#### Automated Verification:

None — CPU of a Worker cannot be measured reliably outside Cloudflare.

#### Manual Verification:

- Open the dashboard 3 times on prod and read CPU time for `GET /api/instruments/latest` in the Cloudflare Workers logs; it is measurably below the 10–12 ms baseline from 2026-10-18 (11, 12, 10, 10 ms)
- If the drop is negligible, leave the change deployed and report the numbers on #227; further options (persisting RSI, caching) are discussed there, not in this change

---

## Testing Strategy

### Unit Tests:

- `loadLatestSnapshots`: newest row, RSI equal to `latestRsi`, ineligible ticker, empty ticker, equality with `buildHistory(...).at(-1)`.

### Integration Tests:

- Existing `/latest` endpoint tests: basic shape and nulls, ineligible RSI null, parity with `/history` (including the age-floor case), stale ticker shows no data.

### Manual Testing Steps:

1. Run the app locally and compare the dashboard values before/after the change.
2. After deploy, load the dashboard 3 times and read the CPU values from the Cloudflare logs.

## Performance Considerations

The gain from `.raw()` and from dropping `buildHistory` is estimated from reading the code, not measured. The work still scales with the instrument count × 180 rows; this change reduces the constant, not the growth.

## References

- GitHub issue #227
- Related changes: `context/archive/2026-10-17-rsi-single-calculation`, `context/archive/2026-10-17-rsi-review-fixes`
- Code: `src/worker/routes/instruments.ts:45`, `src/worker/lib/price-history.ts:35`, `src/worker/lib/price-history.ts:57`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Lighter read path for /latest

#### Automated

- [x] 1.1 Types check: `npm run typecheck` — d3abd95
- [x] 1.2 Lint passes: `npm run lint` — d3abd95
- [x] 1.3 Worker tests pass (including the existing `/latest` parity tests): `npm run test:worker` — d3abd95

#### Manual

- [ ] 1.4 Dashboard in the local app shows the same values as before for every instrument

### Phase 2: Measure on prod

#### Manual

- [ ] 2.1 Open the dashboard 3 times on prod and read CPU time for `GET /api/instruments/latest` in the Cloudflare logs; it is measurably below the 10–12 ms baseline
- [ ] 2.2 Record the numbers in the PR description and as a comment on issue #227
