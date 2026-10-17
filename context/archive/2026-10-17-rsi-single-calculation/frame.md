# Frame Brief: RSI calculation consistency and series length

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

An RSI <= 40 alert for TSM sent no email. After a manual refresh `market_data.rsi` was 41.38, while TradingView (RSI 14, close) showed about 34.2. The stored value is therefore not the value users see on a chart.

## Initial Framing (preserved)

- **User's stated cause or approach**: RSI is computed from too short a series (about 23 closes from the last 30 calendar days). Wilder smoothing is recursive, so the result depends on series length.
- **User's proposed direction**: use about 100-150 sessions for the Wilder RSI, shared between refresh/cron and the history view, and recompute `market_data.rsi` for all instruments.
- **Pre-dispatch narrowing**: alerts and instrument history must show an identical RSI. Beyond those two, the requirement is system-wide: RSI must be calculated the same way in every place in the system, stated explicitly. Fetching and validating data when an instrument is added is out of scope (split into #213).

## Dimension Map

1. **Formula** (`rsi.ts`) - Wilder RSI(14) implemented incorrectly.
2. **Input series length** - the series fed to the formula is too short to converge.  <- initial framing
3. **Number of calculation paths** - RSI is computed in more than one place, each with its own input.
4. **Input data quality** - gaps, unfinished bars, adjusted vs raw closes.
5. **Stored value lifecycle** - `market_data.rsi` is written only by refresh, so it stays stale after any fix or backfill.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Formula wrong | `src/worker/lib/rsi.ts:11-41`: SMA seed over the first 14 changes, then Wilder smoothing; matches the standard definition. Recomputing TSM from 179+ prod closes gave about 34.2, matching TradingView. | NONE |
| Series too short (initial framing) | `market-refresh.ts:109,189`: stored closes of the last 30 calendar days merged with fetched ones, about 23 closes. `price-history.ts:9`, `instruments.ts:98`: history view uses 44 rows. Wilder stabilises from about 100 closes. | STRONG |
| Several calculation paths | Two independent code paths: `market-refresh.ts:189` (`calculateRSI`, written to `market_data.rsi`) and `price-history.ts:25` (`calculateRSISeries`, used by `/history` and `/latest`, i.e. the dashboard). Different inputs (about 23 calendar-day closes vs 44 rows), so dashboard and alerts can already disagree. No RSI calculation exists in `src/app` (frontend only displays). | STRONG |
| Data quality | All 33 prod instruments have at least 179 stored closes after the backfill; fetched bars overwrite stored ones, so a not-yet-final bar self-corrects. No evidence of a gap. | WEAK |
| Stored value lifecycle | `alert-evaluation.ts:176`, `alerts.ts:172,203` read `market_data.rsi`. The admin backfill (`admin.ts`) writes only `price_history`, so `market_data.rsi` stays stale until the next refresh. | STRONG |

## Narrowing Signals

- User: alerts and history must be identical; the rule must hold for every place RSI is calculated, not only those two.
- Inventory of RSI consumers: alert evaluation, alert create (initial armed state), alert list (`currentRsi`) read `market_data.rsi`; instrument history and dashboard read `buildHistory`. Two producers, five consumers.
- Prod data check: with at least 179 closes, the real RSI for TSM is about 34.2, so the series length alone explains the 41.38 vs 34.2 gap.

## Cross-System Convention

TradingView and most charting tools compute Wilder RSI over the full available history. Practitioner guidance is to feed at least about 10x the period (100+ closes) before trusting the value. Matches the leading hypothesis.

Prior decisions: the 30-day window came from the market-data-pipeline plan (`context/archive/2026-07-24-market-data-pipeline/plan.md:21`) and the 44-row window from the dashboard-page plan (`context/archive/2026-10-08-dashboard-page/plan.md:13,28`). Neither addressed convergence; the dashboard plan already stated that the dashboard RSI must equal the history RSI, but not that it must equal the stored alert RSI.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the system has no single definition of how RSI is calculated. Two code paths compute it from two different, too-short inputs, so the stored value used by alerts, the dashboard and the history page can each differ from the true RSI and from each other.

The initial framing (series too short) is correct but incomplete: lengthening the window in one place would leave the other path and the stored values inconsistent. The requirement is an invariant: every RSI value surfaced anywhere (stored, evaluated, shown) comes from one shared calculation over one shared input definition, and stored values are brought in line (recompute after the change, including for instruments backfilled without a refresh).

## Confidence

**HIGH** - code evidence in this repo for the paths and windows, a prod recomputation matching TradingView, and a user-confirmed invariant.

## What Changes for /10x-plan

The plan should be about establishing one RSI definition (shared input window and one calculation entry point used by refresh, history and dashboard), making it hard to reintroduce a second path (test or lint-level guard), and recomputing `market_data.rsi` for all instruments. Window length is a parameter of that definition, not the whole change. Instrument-add fetch/validation is excluded (#213).

## References

- Source files: `src/worker/lib/market-refresh.ts:105-132,183-190`, `src/worker/lib/price-history.ts:9-30`, `src/worker/routes/instruments.ts:34-103`, `src/worker/lib/rsi.ts:11-46`, `src/worker/lib/alert-evaluation.ts:176`, `src/worker/routes/alerts.ts:120-210`, `src/worker/routes/admin.ts` (backfill)
- Issues: #211, #213
- Investigation tasks: none (evidence gathered by direct reads; no sub-agents spawned)
