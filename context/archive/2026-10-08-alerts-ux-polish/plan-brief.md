# Alerts UX polish — Plan Brief

> Full plan: `context/changes/alerts-ux-polish/plan.md`

## What & Why

Fix two UX problems from issue #171: the alert dialog cuts off the selected instrument because the type and instrument fields share one row, and the alerts list hides the current price/RSI until a row is expanded.

## Starting Point

`app-instrument-picker` lays out its two fields in one flex row and is used in 6 places. The alerts list has a 3-column grid (Instrument, Alert type, Threshold); current values are already loaded but only shown in the expanded panel.

## Desired End State

In the alert dialog the instrument field sits below the type dropdown with the full ticker and name visible. Each alert row shows a "Current value" cell (price with currency, RSI, or "—").

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Picker layout scope | Opt-in `stacked` input, used only by the alert dialog | Filter bars rely on the compact single row | Plan |
| No-data display | "—" | Short, fits a narrow column | Plan |
| Sorting | Current value is display-only | Price and RSI are different scales; issue asks only to show | Plan |
| Phases | Two independent phases | Unrelated changes, easier review | Plan |

## Scope

**In scope:** stacked picker option, dialog usage, Current value column, Polish translation, unit tests.

**Out of scope:** layout changes in other picker usages, sorting by value, backend, responsive rework of the list grid.

## Architecture / Approach

Frontend only. Picker gets `stacked = input(false)` toggling a host class; list grid gets a fourth column in header and rows, rendering values with existing helpers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Stacked picker | Dialog shows instrument on its own line | Accidentally changing other usages |
| 2. Current value column | New column + xlf entry + tests | Grid misalignment between header and rows |

**Prerequisites:** none.
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Grid uses fixed rem widths, so very narrow screens may already overflow; not addressed here.

## Success Criteria (Summary)

- Long instrument names are fully visible in the dialog.
- Current RSI/price visible at a glance in the collapsed list; other picker usages unchanged.
