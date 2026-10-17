# Close the Remaining Divergent RSI Paths — Plan Brief

> Full plan: `context/changes/rsi-review-fixes/plan.md`

## What & Why

The #211 change made RSI come from one definition, but its review found paths that still compute a different value: the alert create/edit refresh and the history-read failure fallback both write a short-window RSI over the good stored one, and `/history` uses a different query shape than the dashboard. This change closes them so every RSI in the system is derived the same way.

## Starting Point

Cron, dashboard and history share `loadRecentPriceRows` + `rsiFromCloses` (newest 180 closes). `refreshInstruments` with `fullWindow` ignores stored history, `loadStoredCloses` swallows D1 errors and falls back to the 30-day window, `/history` has its own `LIMIT 180` query without the 300-day floor, and the floor's `MAX(date)` scans the whole table.

## Desired End State

Every writer and reader of RSI uses the same 180-close input. A failed history read writes nothing for RSI tickers and reports them as errors. `/history` and `/latest` cannot disagree. `MAX(date)` is index-backed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Loader failure | RSI tickers reported as error, nothing written | No bad number reaches alerts; the cron failure notice already exists | Plan |
| `/history` floor | Use the shared loader (same 300-day floor as the dashboard) | One query shape, values cannot diverge | Plan |
| Date lookup | Index on `price_history(date)` (migration 0017) | Removes the full-table scan with no code semantics change | Plan |
| `fullWindow` | Keeps the 30-day fetch, also loads stored history | Same RSI as the cron path | Plan |

## Scope

**In scope:** `market-refresh.ts` fixes, `/history` unification, migration 0017, tests for fullWindow, loader failure, chunking, floor boundary, parity.

**Out of scope:** RSI formula or constants, per-ticker floor, partial writes on failure, cron schedule (#210), grouped emails (#212).

## Architecture / Approach

Phase 1 changes `refreshInstruments`: stored closes are always loaded for RSI instruments and a load error becomes a per-ticker error instead of a fallback. Phase 2 swaps the `/history` SELECT for `loadRecentPriceRows(db, [ticker])`, adds the index migration and the missing tests.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Consistent RSI in refresh paths | fullWindow and failure paths no longer write short RSI | Simulating a loader failure in tests |
| 2. One read path, index, tests | `/history` on the shared loader, index 0017, coverage | Migration must be applied remotely by hand |

**Prerequisites:** none.
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- A ticker with no closes for 300+ days before the freshest one shows no history (already true on the dashboard).
- On a D1 outage the RSI tickers keep yesterday's data for that day.

## Success Criteria (Summary)

- A new RSI alert on a stale ticker shows the same RSI as the dashboard and history.
- Worker tests, typecheck and lint pass; `0017` applies locally and remotely.
