# One RSI Calculation Everywhere - Plan Brief

> Full plan: `context/changes/rsi-single-calculation/plan.md`
> Frame brief: `context/changes/rsi-single-calculation/frame.md`

## What & Why

The system has no single definition of how RSI is calculated. Two code paths compute it from two different, too-short inputs, so the stored value used by alerts, the dashboard and the history page can each differ from the true RSI and from each other. This is why the TSM alert (RSI <= 40) sent no email while the real RSI was about 34 (issue #211).

## Starting Point

The refresh/cron path computes the stored `market_data.rsi` from about 23 closes (last 30 calendar days). The history page and dashboard compute RSI from 44 rows. The formula is correct; Wilder smoothing needs about 100+ closes to converge. All 33 prod instruments already have 179+ stored closes.

## Desired End State

Alerts, the dashboard and the history page show the same RSI for a ticker, matching TradingView within rounding. One shared definition (180-close input, one function, one loader) is used everywhere, guarded by a parity test.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Invariant | RSI is calculated the same way in every place | User requirement, not just alerts + history | Frame |
| Input length | Newest 180 closes (30 shown + 150 warm-up) | Converged Wilder value, small read cost | Plan |
| Single definition location | `price-history.ts` (constants, `latestRsi`, row loader) | Already shared by history and dashboard | Plan |
| After deploy | Let alerts that truly meet their condition fire on the next cron | That is the bug being fixed; no extra tooling | Plan |
| Thin history | Keep computing from 15 closes up; keep the 30-day Yahoo fetch | New-instrument handling belongs to #213 | Plan |
| Third-path guard | Parity test between stored RSI and history RSI | Less brittle than an import-scan lint | Plan |

## Scope

**In scope:** shared RSI definition, history/dashboard read side, refresh/cron write side, parity and regression tests.

**Out of scope:** formula change, silent recompute tool, fetch and validation on instrument add (#213), grouped alert emails (#212), cron schedule fix (#210), schema changes.

## Architecture / Approach

`price-history.ts` owns RSI period, warm-up, input length, date floor, `latestRsi` and `loadRecentPriceRows`. History/dashboard and the refresh path read the newest 180 rows through the same loader and compute with the same function. Refresh merges fetched closes over stored ones, truncates to 180, then computes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared definition and read side | History and dashboard on the 180-row shared definition | Existing history tests assume the 44-row window |
| 2. Refresh and cron write side | Stored `market_data.rsi` from the same input, parity test | Extra CPU on `scheduled()` (measured 11-17 ms vs 10 ms claim) |

**Prerequisites:** none (branch `feat/rsi-single-calculation` from current main).
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- CPU on the cron may rise with 180-row reads; fallback is a smaller warm-up (about 100), one constant.
- After deploy, several alerts may fire at once (accepted).
- Assumes the 30-day Yahoo fetch window is enough to keep `price_history` complete for tickers that already have long history.

## Success Criteria (Summary)

- TSM shows the same RSI (about 34) in the alert list, dashboard and history, matching TradingView.
- The TSM alert fires once its condition is truly met.
- Cron CPU stays in the previous range.
