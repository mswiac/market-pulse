# Grouped Alert Email — Plan Brief

> Full plan: `context/changes/grouped-alert-email/plan.md`

## What & Why

Several armed alerts of the same kind that fire in one evaluation run currently produce one email each, all showing the same value. We send one email per group showing the deepest crossed threshold (GitHub issue #212).

## Starting Point

`evaluateAlerts` queues every firing alert for its own email, event row and disarm. Sending and writing are already batched (one Resend request, one D1 batch).

## Desired End State

One email per group (same user, ticker, type, direction, notification email). Every alert in the group is disarmed and keeps its own history row. A single alert behaves exactly as before.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Email text | Unchanged, deepest threshold only | Matches the issue; no template change | Plan |
| Summary `emails` | One entry per alert | Keeps the contract used by the cron, admin panel and Angular page | Plan |
| Transient failure | Whole group stays armed | Same retry rule as a single alert today | Issue |
| Re-arming | Unchanged, per alert | Out of scope | Issue |

## Scope

**In scope:** grouping in `evaluateAlerts`, test updates.

**Out of scope:** email template, schema/migrations, UI, re-arming.

## Architecture / Approach

Group firing alerts after the per-alert loop, send one email per group built from the deepest-threshold alert, fan the result out to each member when writing events, disarms and summary entries.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Group firing alerts | One email per group + tests | Transient failure must keep every member armed |

**Prerequisites:** none.
**Estimated effort:** one session, one phase.

## Open Risks & Assumptions

- The admin failure notice lists each alert of a failed group separately, because the summary stays per alert.

## Success Criteria (Summary)

- Three RSI alerts at 40/39/38 with RSI 37 yield one email (threshold 38, value 37), three disarmed alerts, three history rows.
- Worker tests, typecheck and lint pass.
