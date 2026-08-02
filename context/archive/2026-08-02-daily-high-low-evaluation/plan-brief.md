# Daily High/Low Alert Evaluation — Plan Brief

> Full plan: `context/changes/daily-high-low-evaluation/plan.md`

## What & Why

Price alerts on VIX/NASDAQ-100 today only fire when the day's *closing* price crosses the threshold. A price that spikes past the threshold intraday and closes back on the other side (e.g. threshold 100, high 102, close 99) never triggers an alert — a real gap for a product whose core promise is "set it once, don't watch charts." This plan makes price alerts fire on the day's high (for "up" alerts) or low (for "down" alerts) instead, using high/low data that Yahoo's chart API already returns in the same daily fetch — no new data source, no change to the once-daily batch cadence.

## Starting Point

`market_data`/`price_history` store `close` only; `market-data.ts` doesn't even parse Yahoo's `high`/`low` fields, though they're present in every response. `alert-evaluation.ts`'s firing check (`conditionMet`) and re-arm check (`hasRetreatedPastMargin`) both key off one scalar value derived from `market_data.price`/`.rsi`. `alerts.ts`'s `computeArmed` independently re-implements the same close-only check for a newly created alert's initial state.

## Desired End State

A "down" alert with threshold 20 fires the day the low touches 20, even if the close stays at 22. The confirmation email, the trigger-history page, and the 30-day instrument-history page all show High/Low/Close for that day. The alert list additionally shows today's High/Low next to each price alert. RSI alerts and the once-daily cadence are completely unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where high/low live | New nullable columns on `market_data` *and* `price_history` | Evaluation reads `market_data` (snapshot pattern, no new joins); the 30-day history view reads `price_history` directly. |
| Firing basis (PRICE alerts) | High (up) / Low (down), fallback to close when null | Matches FR-012 directly; nullable fallback means the pipeline never breaks on a data gap. |
| Re-arm basis | Stays close-based, unchanged | Prevents daily fire/re-arm thrash on volatile tickers that repeatedly touch-and-retreat from a threshold intraday. |
| What gets recorded/shown at trigger time | High, Low, *and* Close together (not just the crossing value) | User asked to see all three — avoids ambiguity about "which value actually fired." |
| Armed-state consistency | `computeArmed` (alert creation) reuses the same shared `resolveFiringValue` helper as the cron | Otherwise a new alert's initial state could disagree with what the very next evaluation run decides. |
| Display scope | S-04 (alert list), S-06 (trigger history), and S-07 (30-day history) all gain High/Low | User confirmed all three surfaces, not just the email. |
| Historical backfill | None needed as a separate step | `scheduled.ts` already re-upserts a full `range=1mo` window every run, so ~21 trading days self-backfill after the first post-deploy cron run. |

## Scope

**In scope:**
- Schema: nullable `high`/`low` on `market_data`/`price_history`, `high_at_trigger`/`low_at_trigger` on `trigger_events`.
- Yahoo fetch/parse extended to carry high/low.
- Firing logic switched to high/low (with close fallback); re-arm logic unchanged.
- `computeArmed` aligned with the same firing rule.
- Trigger-history and instrument-history APIs + UI extended to show High/Low.
- Alert list UI extended to show High/Low.

**Out of scope:**
- Any change to RSI alerts, RSI calculation, or intraday/real-time polling.
- Backfilling `price_history` rows older than ~1 month.
- New alert-creation form fields.

## Architecture / Approach

Standard dependency chain: schema → ingestion (fetch/parse + cron write) → business logic (evaluation + armed-state, sharing one `resolveFiringValue` helper) → read APIs (trigger-events, instrument history) → frontend (three Angular components). Each phase is independently testable against the existing `test/worker/**` vitest suite before moving to the next.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database Schema | Nullable high/low/trigger columns via one migration | Low — plain `ADD COLUMN`, no rebuild |
| 2. Market Data Ingestion | Yahoo parse + cron write of high/low | Null-handling asymmetry (close-required vs. high/low-optional per day) |
| 3. Alert Evaluation & Armed-State | Firing on high/low, re-arm on close, trigger recording, email, `computeArmed` alignment | Two call sites (`alert-evaluation.ts`, `alerts.ts`) must share one helper or drift apart again |
| 4. History & Trigger APIs | High/Low exposed via trigger-events and instrument-history endpoints | Low — pure additive read-path |
| 5. Frontend Display | High/Low shown on S-04, S-06, S-07 | Low — additive UI, follows existing column/field patterns |

**Prerequisites:** S-05 (alert-notifications) done — confirmed in roadmap.
**Estimated effort:** ~5 phases, each independently shippable/testable; roughly 1 session per phase.

## Open Risks & Assumptions

- Assumes Yahoo's `quote[0].high`/`.low` arrays are index-aligned with `.close`/`.timestamp` the same way `.close` already is (unverified against a live response in this planning session, but same API shape).

## Success Criteria (Summary)

- A price alert fires on an intraday high/low crossing even when the close doesn't cross the threshold.
- The trigger email and both history views (S-06, S-07) show High/Low/Close together.
- RSI alerts and re-arm behavior are unaffected — full existing test suite stays green.
