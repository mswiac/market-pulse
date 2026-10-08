# Per-Market Cron Triggers — Plan Brief

> Full plan: `context/changes/per-market-cron-triggers/plan.md`

## What & Why

Split the daily market-data fetch into one trigger per market group so each gets its own 50-subrequest budget. This makes the target of ~40 GPW plus ~40 US stocks reachable, and makes GPW data available the same evening. Issue #162.

## Starting Point

#161 made the fetch alert-scoped and type-aware: `runFetchPhase(env, types)` already takes a type list, and `handleCron` already receives the cron expression. Today there is one fetch cron (23:00 UTC) and one evaluation cron (23:15 UTC).

## Desired End State

Three crons: GPW fetch at 16:30 UTC (`pl_stock`), US/index fetch at 23:00 UTC (`us_stock`, `index`), evaluation at 23:15 UTC unchanged.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Split key | `instruments.type`, via an explicit cron-to-types map | Explicit ownership, one-line reassignment, no migration | Issue |
| GPW time | 16:30 UTC | After the 17:00 local close in both DST states, no timezone code | Issue |
| Evaluation | One run at 23:15 UTC, unchanged | Keeps 3 of 5 crons; GPW mail stays in the evening batch | Plan (user) |
| Manual admin run | Unchanged | Splitting it is tracked in #170 | Issue |

## Scope

**In scope:** cron constants and routing, `wrangler.toml`, tests, schedule docs.

**Out of scope:** second evaluation run, `market` column, #170, timezone handling, frontend.

## Architecture / Approach

Replace `FETCH_CRON` with two constants and a `FETCH_CRON_TYPES` map; `handleCron` looks up the types and calls `runFetchPhase`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Per-market fetch triggers | Third cron, routing, tests, docs | Cron propagation delay after deploy |

**Prerequisites:** #161 merged (done).
**Estimated effort:** one short session.

## Open Risks & Assumptions

- A Polish index would land in the US trigger (known limitation in the issue; harmless at end-of-day cadence).
- The GPW trigger fetches nothing until Polish stocks are added.

## Success Criteria (Summary)

- Each fetch trigger only touches the types it owns.
- Three triggers appear in the Cloudflare dashboard after deploy.
