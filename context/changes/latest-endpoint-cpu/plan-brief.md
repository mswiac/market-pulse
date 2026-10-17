# Reduce CPU time of GET /api/instruments/latest — Plan Brief

> Full plan: `context/changes/latest-endpoint-cpu/plan.md`

## What & Why

The dashboard endpoint `GET /api/instruments/latest` uses 10–12 ms CPU per request on prod, at or above the Workers Free 10 ms budget, while other user-facing endpoints use 0–3 ms (issue #227). We give it a lighter read path that builds only what the dashboard shows, without changing how RSI is defined.

## Starting Point

Since #214/#218 `/latest` loads up to 180 rows per instrument as objects, runs `buildHistory` per instrument (full RSI series, one object per day) and keeps only the last entry. The window query is shared with `/history` and the cron.

## Desired End State

`/latest` returns the same JSON as today but no longer builds per-day history objects. On prod the CPU shown in the Cloudflare logs for this endpoint is measurably below the 10–12 ms baseline.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Success criterion | Measurable CPU drop, no numeric threshold | The effect of option A is unmeasured, so a fixed target would be a guess. |
| If the drop is too small | Deploy anyway, discuss further on #227 | Keeps scope minimal; persisting RSI (option B) would change the #211 design and is a separate decision. |
| Measurement | Cloudflare prod logs only | Worker CPU cannot be measured reliably locally. |
| Code shape | New function in `price-history.ts`, shared window SQL | `loadRecentPriceRows` has three callers and must not change. |

## Scope

**In scope:** a `.raw()`-based `loadLatestSnapshots`, `/latest` switched to it, unit tests for it.

**Out of scope:** persisted RSI, response cache, changes to `loadRecentPriceRows` / `buildHistory` / cron / RSI definition, local benchmarks, plan upgrade.

## Architecture / Approach

One new function reads the same 180-session window through `.raw()` and folds each ticker's rows into the newest row plus `latestRsi` (only for RSI-eligible tickers). The window SQL is extracted so both loaders share one definition. Existing `/latest` vs `/history` parity tests guard the behaviour.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Lighter read path | New loader, route switched, unit tests | Subtle divergence from `buildHistory(...).at(-1)` (guarded by parity tests) |
| 2. Measure on prod | CPU numbers recorded on the PR and #227 | The gain may be small; `.raw()` effect is unmeasured |

**Prerequisites:** none.
**Estimated effort:** ~1 session for Phase 1; Phase 2 is a few minutes after deploy.

## Open Risks & Assumptions

- The CPU drop is an estimate from reading the code; it may be negligible.
- Cost still scales with instrument count × 180 rows; only the constant shrinks.

## Success Criteria (Summary)

- `/latest` returns identical data (existing parity tests pass).
- Prod CPU for the endpoint is measurably lower than 10–12 ms.
