# Frame Brief: Fetch and validate market data when an instrument is added

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`POST /api/admin/instruments` only inserts a row (`src/worker/routes/admin.ts:224-233`).
No market data is fetched, so a typo in ticker / suffix / currency surfaces only
at the first cron run or the first alert creation (or never, if no alert is
set — the cron only fetches instruments that have an alert). A new instrument
also starts with no `price_history` / `market_data`, so its first RSI is
computed from a short window (GitHub issue #213).

## Initial Framing (preserved)

- **User's stated cause or approach**: fetching data on add doubles as
  validation — if Yahoo returns no data or an error for `ticker + suffix`, the
  entered symbol data is wrong.
- **User's proposed direction**: on creation, fetch ~200 sessions (~300
  calendar days) from Yahoo, store `price_history`, compute and store
  `market_data` (price, high, low, RSI); reject the insert when Yahoo has no
  data; surface a currency mismatch.
- **Pre-dispatch narrowing**: both symptoms (late discovery of bad data, poor
  first RSI) are equal requirements; no bad instrument was added so far — this
  is a precaution; "bad data" = no quotes at all, or a currency different from
  the entered one (too-few-sessions was not selected).
  After the investigation: when currencies disagree, **Yahoo is the source of
  truth** (same as the cron and the backfill today).

## Dimension Map

1. **Error classification** — "no data = bad input" assumes the code can tell an
   unknown symbol from a transient failure. ← initial framing
2. **Write ordering and atomicity** — instrument row, `price_history` and
   `market_data` must land together or not at all.
3. **Window and series length** — ~300 days for a new instrument vs the 30-day
   window used by the cron thin-history rule and by alert-create refresh.
   ← initial framing
4. **Currency policy** — "reject or surface a mismatch" vs the existing
   "Yahoo wins" correction.
5. **Surface and runtime limits** — admin UI error mapping, Workers Free
   limits, existing tests/e2e that POST an instrument.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Code can distinguish unknown symbol from transient failure | Every failure is the same `MarketDataFetchError` with only message text differing (`market-data.ts:8-13, 65, 72, 76, 91, 107, 124`); network error/timeout is not wrapped at all; callers never branch on the error (`admin.ts:79-81` maps all to 502, `market-refresh.ts` retries all identically). Live probe: Yahoo returns **HTTP 404** + `chart.error.code="Not Found"` for an unknown symbol, but the only test models it as HTTP 200 (`test/worker/market-data.test.ts:79-84`), so the 404 path is untested and loses the code at `market-data.ts:65`. Empty `timestamp: []` returns success (`:99-101`), so a window without trading days cannot flag a bad symbol. | STRONG — the premise does **not** hold today |
| 2. Atomic creation is feasible | No FKs on `price_history` / `market_data` (`migrations/0006`, `0007`, `0008`); `DB.batch()` is the established atomic idiom (`market-refresh.ts:196-210`, `admin.ts:273-278`). Only coupling: RSI-eligibility trigger (`0014:51-62`) — put the instrument INSERT first and keep `rsi` NULL for non-eligible. ~15 statements for 200 rows (`ROWS_PER_STATEMENT=16`). `refreshInstruments` cannot be reused as is: no instrument INSERT, fixed 30-day window, swallows errors as `status:'error'`, treats empty closes as `ok`. | STRONG (feasible, needs a dedicated path) |
| 3. A 300-day window is a new constant, no conflict with thin rule | `LONG_LOOKBACK_DAYS=30` is hard-wired (`market-refresh.ts:37`); read floor `RSI_INPUT_MAX_AGE_DAYS=300` and `RSI_INPUT_SESSIONS=180` exist (`price-history.ts`); after a seed the stored count is ~200, so the instrument is never "thin". `to` must be tomorrow's date (`market-refresh.ts:65-71`). The deferral is explicit in `context/archive/2026-10-17-rsi-single-calculation/plan.md:35`. | STRONG (framing holds) |
| 4. "Reject on currency mismatch" fits the current policy | Contradicts "Yahoo always wins" (`market-data.ts:130-149`, roadmap F-04 `:144,:360`); cron would silently overwrite a rejected value later; S-25 prefill can seed a wrong default. User confirmed Yahoo is the source of truth. | STRONG — reframe: mismatch is a correction + visible notice, not a rejection |
| 5. UI / limits / tests | Add form (`add-instrument.ts`) maps unknown codes to a generic message; a specific message needs `$localize` + xlf entries; button is disabled while submitting but no spinner. No default Yahoo timeout in `fetchDailyCloses` (alert path sets 4000 ms). One fetch + ~16-statement batch fits 50 subrequests; CPU for ~300-day parse + RSI unmeasured but small vs the backfill precedent. 7 worker tests (`admin.test.ts` 592-702) and dependent blocks (impact/delete) need a Yahoo stub; e2e specs (`e2e/admin/add-instrument.spec.ts`, `admin-api.ts`) use fabricated `E2E…` tickers and "mock nothing" — they would be rejected. | MEDIUM — implementation cost, not a framing problem |

## Narrowing Signals

- Real Yahoo: unknown symbol -> HTTP 404 + `{"chart":{"result":null,"error":{"code":"Not Found",...}}}`
  (probed live); known symbol -> HTTP 200. Not-found is therefore detectable,
  but only if 404 / `chart.error.code` is surfaced as a distinct failure kind.
- The user ruled out "too few sessions" as an error and chose Yahoo as the
  currency source of truth.
- Production instruments already have >= 179 stored closes (#211 plan), so the
  seeding only matters for newly added instruments.

## Cross-System Convention

Validate-on-create against the upstream provider, with the provider's value
winning for display metadata, matches how this repo already treats currency
(cron + backfill). Distinguishing "not found" (client error) from provider
failure (5xx / timeout) is the standard split for such a gate; this repo has
no such split yet.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: adding an instrument must be an
> atomic "fetch, validate, seed" step, and that validation is only meaningful
> once Yahoo "unknown symbol" can be told apart from "provider unavailable" —
> a distinction the fetch layer does not make today.

The initial framing largely holds (fetch ~300 days on add, seed history and
`market_data`, reject unknown symbols). Two parts of it change: (1) "no data /
error => invalid input" is unsafe as stated, because every Yahoo failure is the
same error class and timeouts are unwrapped, so a transient outage would read
as a bad ticker; (2) a currency mismatch should not reject — consistent with
"Yahoo wins" it is corrected and reported to the admin.

## Confidence

**HIGH** — strong file:line evidence for every dimension, a live probe of the
Yahoo response, and a decisive user answer on the currency policy.

## What Changes for /10x-plan

The plan has to include a failure-kind distinction in the fetch layer
(not-found vs provider/timeout vs empty series) and a dedicated create path
(single `DB.batch` with the instrument INSERT first, 300-day window ending
tomorrow, explicit timeout), not a reuse of `refreshInstruments`. Open design
points for planning: the HTTP status/code for not-found vs provider failure,
how the currency correction is reported in the 201 response and UI, UI error
messages / loading feedback, and the test and e2e strategy (Yahoo stub for
fabricated tickers).

## References

- Source files: `src/worker/routes/admin.ts:185-240`, `src/worker/lib/market-data.ts:8-149`,
  `src/worker/lib/market-refresh.ts:33-45, 119-214`, `src/worker/lib/price-history.ts`,
  `src/worker/routes/alerts.ts:133-155`, `src/app/features/admin/add-instrument/add-instrument.ts`,
  `test/worker/admin.test.ts:478-711`, `test/worker/market-data.test.ts:73-84`,
  `e2e/admin/add-instrument.spec.ts`, `e2e/admin/admin-api.ts`
- Related: GitHub #213, #211, `context/archive/2026-10-17-rsi-single-calculation/plan.md:35`
- Investigation: four parallel read-only Explore agents (error classification,
  write atomicity, window + currency policy, surface + limits) and one live
  Yahoo probe.
