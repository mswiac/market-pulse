# Cron Run Capacity - Plan Brief

> Full plan: `context/changes/cron-run-capacity/plan.md`

## What & Why

The daily cron's cost grows with the whole instrument catalogue and hits the Workers Free 50-subrequest limit at about 20 instruments. This change makes the cost depend only on tickers that have an alert and moves evaluation to its own invocation. GitHub issue #161.

## Starting Point

`handleScheduled` fetches every instrument and does a Yahoo call plus a D1 batch per instrument, then evaluates alerts in the same invocation with one Resend POST and one D1 batch per firing alert.

## Desired End State

About 44 alert-bearing tickers fit one fetch invocation; evaluation runs separately with its own budget, sends one batched email request and one batched D1 write, and skips stale data. User-visible alert behaviour is unchanged.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Instruments without an alert | Not refreshed by cron | Keeps the budget for alerts; admin backfill covers the rest (user decision) |
| Stale data at evaluation | Skip and log if older than 12 h | Never email from an old quote (user decision) |
| Per-market split | Deferred to #162 | Out of scope here; selection takes a type list so #162 is mechanical |
| Resend failures | Same transient/permanent rules, applied per chunk | No new user-visible rules |
| Retries | Keep 3 per ticker plus a per-run attempt cap | Flaky tickers cannot exhaust the budget |
| `/api/admin/cron/run` (Force data refresh page) | Runs both phases, same response; page description reworded | Ticker list now shows only alert-bearing instruments |

## Scope

**In scope:** alert-scoped fetch, bulk writes, D1-backed RSI, Resend batch, batched re-arm/trigger writes, freshness check, separate evaluation cron.

**Out of scope:** per-market triggers (#162), refreshing non-alert instruments (also from the Force data refresh page; per-market full refresh there is tracked in #170), alert cooldown, frontend changes beyond the Force-refresh page description.

## Architecture / Approach

Fetch phase: select alert-bearing tickers, fetch a short Yahoo window, merge with `price_history` for RSI, write once after the loop. Evaluation phase: decide per alert, one Resend batch, one D1 batch. `controller.cron` routes each cron expression to its phase.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fetch phase | Alert-scoped, bulk-written, D1-backed RSI | RSI regression when history is thin |
| 2. Evaluation | Resend batch, one D1 write, freshness check | Batch failure semantics vs today's per-alert rules |
| 3. Trigger split | Second cron, routing, admin endpoint | Ordering between triggers is not guaranteed |

**Prerequisites:** none. **Estimated effort:** ~3 sessions across 3 phases.

## Open Risks & Assumptions

- Whether `DB.batch()` counts as one subrequest is unverified; measured after deploy.
- Resend batch behaviour on a partially invalid chunk is treated as all-or-nothing.

## Success Criteria (Summary)

- A run with alerts on several tickers uses far fewer subrequests than before.
- Emails, disarm and re-arm behave as today.
- Stale instruments never produce an alert.
