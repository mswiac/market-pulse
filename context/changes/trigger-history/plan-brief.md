# Trigger History — Plan Brief

> Full plan: `context/changes/trigger-history/plan.md`

## What & Why

Add a read-only page where a logged-in user can view a chronological log of every alert that has previously fired — timestamp, instrument, alert type, direction, threshold, and the value that crossed it. This is roadmap slice S-06 / PRD FR-010, the direct follow-up to `alert-notifications` (S-05), which already writes every fire event to `trigger_events` but built no way to browse it.

## Starting Point

`trigger_events` exists and is fully populated by the daily cron (one row per genuinely-fired alert, success or failed email send) — confirmed via full-repo search that nothing reads this table today. This slice is purely additive: no schema change to existing tables, no cron changes.

## Desired End State

A user opens "Triggered alerts" from the sidenav (nested under the existing "History" group, next to "Instruments") and sees a table of their fired alerts, newest first, with a "load more" control for older pages. A failed email delivery shows a hover tooltip with the actual error reason.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Failed-email events | Show all events; failed ones get a tooltip with `email_error` | The threshold genuinely crossed regardless of email delivery — hiding it would misrepresent market reality, and the tooltip surfaces a broken notification path | Plan (user-refined) |
| Display fields | 6 fields (add threshold + direction to the roadmap's 4) | Matches how the existing alert-list already shows threshold next to current value — without it a value has no reference point | Plan |
| List scale | Real limit/offset pagination with a `hasMore` flag and "load more" UI | First paginated list in this codebase; `trigger_events` grows indefinitely with account age, unlike every other (small, bounded) list endpoint | Plan |
| Missing instrument | `LEFT JOIN` with raw-ticker fallback | A trigger row must never silently disappear just because the instrument registry changed later | Plan |

## Scope

**In scope:**
- New `GET /api/trigger-events` endpoint (paginated, user-scoped, joined to `instruments` for display name/currency)
- New `migrations/0012_trigger_events_history_index.sql` (composite index for the new query pattern)
- New Angular "Triggered alerts" page + nav entry under the existing "History" sidenav group

**Out of scope:**
- Filtering/search by instrument, date range, or alert type
- A total-count / "X of Y" indicator
- Any change to `alerts`, the cron, or `alert-evaluation.ts`
- A shared/reusable pagination component (this is the first paginated list — premature to abstract)

## Architecture / Approach

Two phases, mirroring every prior slice's backend-then-frontend split: (1) a Hono route (`src/worker/routes/trigger-events.ts`) mirroring `instruments.ts`'s session-middleware + `WHERE user_id = ?` pattern, backed by a new composite index; (2) an Angular feature mirroring `instrument-history`'s `mat-table` page structure, consuming the new endpoint with a "load more" pager.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Backend | Paginated, user-scoped, join-fallback-safe read endpoint + index + tests | Low — straightforward read; only new ground is the pagination technique (fetch `limit+1`, no `COUNT(*)`) |
| 2. Frontend | "Triggered alerts" page + nav entry, load-more, failed-email tooltip | Low — closely mirrors an existing, working feature (`instrument-history`) |

**Prerequisites:** S-05 (`alert-notifications`) already archived/done — `trigger_events` exists and is populated.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- No way to generate fresh `trigger_events` rows for manual testing except waiting for the next cron run or seeding rows directly via local D1 — flagged as a Critical Implementation Detail in the full plan.
- The "load more" page size (20) and max `limit` clamp (100) are plan-time choices, not user-specified — easy to tune later since nothing else depends on the exact number.

## Success Criteria (Summary)

- A user with fired alerts sees them listed newest-first with correct values and formatting.
- A user with zero fired alerts sees a clear empty state, not an error.
- A failed-email trigger event is visibly distinguishable and explains why via tooltip.
