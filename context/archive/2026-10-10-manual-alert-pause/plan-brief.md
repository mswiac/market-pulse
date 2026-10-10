# Manual Alert Pause — Plan Brief

> Full plan: `context/changes/manual-alert-pause/plan.md`

## What & Why

An instrument oscillating around a threshold re-fires its alert repeatedly, and the only way to silence it today is deleting it (issue #199). Users get a manual pause: a paused alert is skipped by the cron and sends no emails until resumed.

## Starting Point

`alerts.armed` (shown as "Active/Inactive") is the automatic re-arm state, not a user choice. The cron loads all alerts unfiltered, the edit endpoint recomputes `armed` on every save, and the list row has only edit and delete actions.

## Desired End State

Each alert row has a Pause/Resume button and a distinct "Paused" status. A paused alert never emails and is not touched by the cron; editing it keeps it paused; resuming makes it active again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Data model | New `paused` column, separate from `armed` | The two states mean different things and must not be mixed in the UI. |
| Toggle UI | Pause/Resume button in the list row | One click, no risk of changing the threshold by accident. |
| API | Dedicated `PATCH /api/alerts/:id` | Keeps pause out of the edit payload so an edit cannot clear it. |
| Resume | Always sets `armed = 1` | User choice: simplest, no recompute; may mail immediately if the threshold is already crossed. |
| Cron | `WHERE a.paused = 0` in the load query | Smallest change that skips paused alerts entirely. |

## Scope

**In scope:** migration, PATCH endpoint, `paused` in responses, cron filter, list button and status, translations, tests.

**Out of scope:** changes to `armed` semantics, a form checkbox, recompute on resume, bulk pause, scheduling.

## Architecture / Approach

Column plus endpoint plus one cron `WHERE`; the frontend adds a service call and a row button. Backend first, then frontend.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | Migration 0016, PATCH, cron filter, worker tests | Migration must reach remote D1 before the worker deploy |
| 2. Frontend | Row toggle, Paused status, i18n, unit and e2e tests | Status precedence between Paused and Active/Inactive |

**Prerequisites:** none.
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- Resuming with "always arm" can send an immediate email when the threshold is already crossed — accepted by the user.
- Paused-only tickers are still fetched by the cron; cost is negligible.

## Success Criteria (Summary)

- A paused alert sends no email and survives edits and reloads.
- Resuming returns it to Active.
