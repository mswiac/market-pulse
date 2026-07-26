# Instrument History View (S-07) — Plan Brief

> Full plan: `context/changes/instrument-history-view/plan.md`

## What & Why

Roadmap slice S-07: let a user pick an instrument type and a specific instrument via two comboboxes and view its closing price and RSI for each of the last 30 days. This is a browsing/context feature — it doesn't change alerting, it lets a user see the history behind the current values already shown on the alert list (S-04).

## Starting Point

`price_history` is already populated daily by the existing cron pipeline but has no read endpoint. `calculateRSI()` only ever returns the single latest RSI value — there's no way today to get RSI for an arbitrary past day. The frontend has no real routed pages yet (`AlertList` is embedded in `Home`, `AlertForm` is a dialog); this is the first genuinely routed page.

## Desired End State

A toolbar dropdown menu ("Instrument history") takes the user to `/history`, where two comboboxes (type, then instrument) drive a table of date/close/RSI for the last available days (up to 30). RSI is completely absent for `^VIX` (never RSI-eligible); when fewer than 30 days of data exist yet, the table shows what's available with a note on the count.

## Key Decisions Made

| Decision                          | Choice                                                     | Why (1 sentence)                                                                 | Source |
| ---------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Display format                     | Table (mat-table)                                          | No charting library in package.json today; table is trivial and sufficient.       | Plan   |
| RSI series calculation             | New `calculateRSISeries()` sharing Wilder's-smoothing core  | Correct RSI needs running averages from every prior day anyway — barely more work than today's single-value version, no duplicated logic. | Plan   |
| Non-RSI-eligible instrument (^VIX) | Hide the RSI column/series entirely                        | Matches the existing rsi_eligible pattern already enforced in alert-form and DB triggers. | Plan   |
| Insufficient history (<30/44 days) | Show what's available, with a "Showing N of last 30 days" note | Feature must be usable in production today (~21-22 days of history exist), not appear broken until weeks of data accumulate. | Plan   |
| Endpoint shape                     | Single `GET /api/instruments/:ticker/history`               | One HTTP call per instrument switch; nests naturally under the existing authenticated `instruments` router. | Plan   |
| Combobox filtering                 | Client-side, reusing `InstrumentsService`/`alert-form` pattern | Only 2 instruments today — no benefit to a second, server-filtered loading pattern alongside the existing one. | Plan   |
| Navigation                         | Dropdown `mat-menu` in the toolbar, one entry today          | User wants room for future entries (trigger history after S-06, an eventual admin panel) without redesigning navigation later. | Plan   |
| Test coverage                      | vitest unit + endpoint tests for the new RSI-series logic    | Subtle numeric bugs in windowed/smoothed calculations are easy to miss without a unit test — same lesson as the recent RSI-eligibility trigger work. | Plan   |

## Scope

**In scope:**
- `calculateRSISeries()` in `rsi.ts`
- `GET /api/instruments/:ticker/history` endpoint
- Routed `/history` frontend page with type/instrument comboboxes and a table
- Toolbar dropdown menu with one "Instrument history" entry

**Out of scope:**
- Admin panel, trigger/alert-history page (S-06) — menu is structured to hold them later, not built now
- Charting/visualization library
- Backfilling historical price_history data
- Date-range picker, pagination, configurable window size
- Caching layer on the new endpoint

## Architecture / Approach

Backend-first: extend the RSI library to produce a full per-day series, expose it via a new route nested under the existing authenticated `instruments` Hono router, then build the frontend page reusing the alert-form's proven client-side type→instrument filtering pattern, plus a new toolbar `mat-menu` as the entry point.

## Phases at a Glance

| Phase                                    | What it delivers                                              | Key risk                                                        |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. RSI series calculation                 | `calculateRSISeries()` in `rsi.ts`, `calculateRSI` unchanged     | Getting the day-index alignment wrong silently produces a garbage series |
| 2. Instrument history endpoint            | `GET /api/instruments/:ticker/history`                          | Lookback/ordering bug (must query 44 rows oldest→newest before slicing to 30) |
| 3. Frontend history page and navigation   | Routed `/history` page + toolbar menu entry                     | First use of both `mat-table` and `mat-menu` in this codebase        |

**Prerequisites:** None beyond what's already in production (F-03 instrument registry, F-02 price_history pipeline).
**Estimated effort:** ~1 session across 3 phases; no database migration needed.

## Open Risks & Assumptions

- Production currently has less history than the full 44-day lookback needs — early rows will show `rsi: null` until the cron accumulates more days. This is accepted and handled (see "Insufficient history" decision above), not a blocker.
- `mat-table` and `mat-menu` are both first uses in this codebase — no existing pattern to mirror exactly, but both are standard, well-documented Angular Material modules already available via the existing `@angular/material` dependency.

## Success Criteria (Summary)

- User can reach the history page from a toolbar menu, pick type + instrument, and see a table of price (and, where eligible, RSI) for the last available days.
- `^VIX` never shows an RSI column; `^NDX` does once enough lookback data exists.
- Feature works correctly today against production's current (partial) history, not just once 44+ days accumulate.
