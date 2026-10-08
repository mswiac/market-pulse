# Admin Per-Market Refresh — Plan Brief

> Full plan: `context/changes/admin-per-market-refresh/plan.md`

## What & Why

The admin "Force data refresh" page should refresh the whole instrument catalogue (~80 instruments), not just instruments with an alert. One HTTP request cannot do that under the Workers Free 50-subrequest limit, so the page will drive three requests, each with its own budget (GitHub issue #170).

## Starting Point

One endpoint call fetches alert-scoped instruments for all types and evaluates alerts in the same invocation. The type-to-market mapping exists only inside the cron trigger map (#162).

## Desired End State

The page runs two market fetches in parallel (all instruments of `pl` and of `other`), then one alert evaluation, and shows one merged results table. A failing request is listed under "Errors" and does not stop the others.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Endpoint contract | `{phase:'fetch', market}` / `{phase:'evaluate'}`, old one-shot mode removed | Each phase gets its own subrequest budget; a leftover mode would be dead code |
| Market mapping | `MARKET_TYPES` in `lib/instruments.ts`, used by cron and endpoint | Issue requires one shared place |
| Fetch scope | New `scope: 'all'` on `runFetchPhase`; cron keeps `'alerts'` | Cron behaviour from #161 stays unchanged |
| Response shape | Reuse `CronRunSummary` | Client merges by concatenating lists and summing the counter |
| Results table | All rows, one spinner | User choice: no UI redesign |
| Partial failure | Show partial result, failure in "Errors", evaluation still runs | User choice; freshness check protects against stale alerts |

## Scope

**In scope:** shared market map, full-market selector, phase-aware endpoint, three-request page flow, description + PL translation, worker tests.

**Out of scope:** cron schedule/scope changes, `market` column, migrations, `evaluateAlerts`/`refreshInstruments` changes, staged progress UI, new Angular specs.

## Architecture / Approach

`MARKET_TYPES` feeds both `FETCH_CRON_TYPES` and the endpoint. The endpoint dispatches on the body to `runFetchPhase(env, types, 'all')` or `evaluateAlerts`. `CronRun` uses `forkJoin` for the fetches, then the evaluation, and merges the three results.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Per-market admin refresh | Worker + endpoint + page flow + copy + tests | Rewriting the existing cron-run tests without losing coverage |

**Prerequisites:** #161 and #162 merged (done).
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- `type` conflates market and instrument kind (same limitation as #162).
- ~40 instruments per market assumed to fit one request's 40-attempt cap.

## Success Criteria (Summary)

- One click refreshes every catalogue instrument, including ones without alerts.
- A single failing market or request never blocks the evaluation.
