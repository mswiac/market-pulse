# Instrument Currency Display — Plan Brief

> Full plan: `context/changes/instrument-currency-display/plan.md`

## What & Why

Surface each instrument's currency (e.g. `USD`) next to every price/threshold value shown in the app, instead of showing bare numbers with no unit. This is issue #45, spun off while building the instrument history view (S-07): the codebase only supports USD-denominated instruments today, so nothing currently signals the unit, but that stops being obvious the moment a non-USD instrument is ever added.

## Starting Point

`instruments` (`ticker`, `name`, `type`, `rsi_eligible`, `provider`) is a small, hand-seeded registry — both rows (`^VIX`, `^NDX`) were inserted directly in migration `0008`, with no fetch/update path from Yahoo or the daily cron. Three worker routes read from it today (`GET /api/instruments`, `GET /api/instruments/:ticker/history`, and all of `alerts.ts`'s CRUD endpoints via a shared `ALERT_SELECT`), and three frontend surfaces display its data (alert list, alert form, instrument history table) — none of them show a currency unit.

## Desired End State

Every price/threshold value in the UI is suffixed with its ISO currency code: the alert list's summary row and detail panel, the instrument history table's Close column, and the alert form's threshold field (shown read-only, not editable). Adding a future non-USD instrument means seeding its `currency` by hand alongside its other columns — no code changes required.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Currency data source | Hand-seeded in `instruments` table, not fetched from Yahoo | User decision: the instruments registry itself is already 100% hand-seeded (no user-facing "add instrument" flow exists), so currency should follow the exact same manual convention rather than adding a Yahoo-parsing/cron-write path for a value that never changes day-to-day. | Plan (user clarification) |
| Display format | ISO code suffix (`150.25 USD`) | Unambiguous for any currency, zero symbol-lookup table, trivial i18n — vs. a `$` symbol prefix which is ambiguous (USD/CAD/AUD) and needs locale plumbing the app doesn't have. | Plan |
| Alert list placement | Everywhere — summary row + detail panel | Matches issue #45's intent ("instead of bare numeric values with no unit") most consistently. | Plan |
| History table placement | Suffix on every row's Close value | Consistent per-row style, matching the alert list's "suffix the value" approach rather than a single info line above the table. | Plan |
| Alert form | Shown, read-only | User wants it visible next to the threshold field for context, but explicitly not editable — it's derived from the selected instrument, not user input. | Plan (user clarification) |

## Scope

**In scope:**
- New `instruments.currency` column (migration `0010`, `DEFAULT 'USD'`)
- `currency` added to `GET /api/instruments`, `GET /api/instruments/:ticker/history`, and all `alerts.ts` responses
- Display in alert list (summary + detail), instrument history table (every row), alert form (read-only)

**Out of scope:**
- Fetching/parsing currency from Yahoo Finance or writing it via the cron
- Currency conversion, `Intl.NumberFormat` currency-style formatting, or locale/symbol handling
- Any admin UI or user-facing way to add instruments — still exclusively migration-seeded
- Making currency editable anywhere

## Architecture / Approach

Backend-first: add the column, thread it through the three existing route response shapes (Phase 1), then update frontend types and templates to render it wherever a price/threshold already appears (Phase 2). No new endpoints, no new tables, no cron changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema and backend responses | `currency` column + field on all three route responses, tests updated | Low — additive column, small shared-SQL edits (`ALERT_SELECT`, two `SELECT`s) |
| 2. Frontend display | `currency` rendered in alert list, history table, alert form | Low — mostly template edits; only real judgment call is whether "Current RSI" should carry a currency suffix (RSI isn't monetary) — flagged for manual re-check |

**Prerequisites:** None — builds directly on the existing `instruments` table and S-07's already-shipped instrument history page.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Suffixing "Current RSI" with a currency code (per the "everywhere" placement decision) may read oddly since RSI is a 0-100 indicator, not a monetary value — Phase 2's manual verification explicitly calls this out for a sanity check before considering the phase done.
- Assumes both current instruments are and remain USD — true today per the issue's own framing; the `DEFAULT 'USD'` migration backfill depends on this holding for `^VIX`/`^NDX` specifically.

## Success Criteria (Summary)

- Every price/threshold value shown to a user (alert list, alert form, instrument history) is suffixed with its instrument's ISO currency code.
- Adding a future non-USD instrument requires only a migration/seed change — no code changes to any of the three display surfaces.
