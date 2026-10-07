# Alerts List Filtering — Plan Brief

> Full plan: `context/changes/alerts-list-filtering/plan.md`

## What & Why

Users can accumulate many alerts and cannot narrow the list. Add combinable filters by instrument type, instrument and alert type (issue #159).

## Starting Point

All alerts are already loaded client-side in `AlertsService`; each carries ticker, instrument type and alert type. The searchable `InstrumentPicker` from #160 is merged and exposes `ticker` and `type`.

## Desired End State

A filter bar above the list (picker + alert-type select + "Clear filters"). The list shows alerts matching every active filter; a dedicated message appears when none match.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Frontend only | Data is already client-side |
| Instrument/type filter | Reuse `InstrumentPicker` as-is | Built for this in #160 |
| Alert-type filter | Plain select: All / Price / RSI | Only three values |
| New alert vs. active filter | Filters stay | User choice; simplest |
| Persistence | None (reset on reload) | User choice |
| Matching rule | Ticker wins over type; AND with alert type | Picker already drops contradicting selections |

## Scope

**In scope:** filter bar, filter helper, empty states, i18n, unit specs, one e2e.

**Out of scope:** backend, persistence, counter, chips UI, restricting picker to instruments with alerts.

## Architecture / Approach

Pure `filterAlerts` helper → `filteredAlerts` computed in `AlertList` → existing sort stage. Picker bound with two-way `[(ticker)]`/`[(type)]`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Filters in the alerts list | Helper, UI, empty states, i18n, specs | Picker inside a list page layout / catalogue load failure |
| 2. E2E coverage | Playwright filter scenario | Alert uniqueness constraint in test data |

**Prerequisites:** #160 merged (done).
**Estimated effort:** ~1–2 sessions.

## Open Risks & Assumptions

- Picking an instrument with no alerts yields an empty result (accepted).

## Success Criteria (Summary)

- Filters narrow and combine correctly; clear resets; no-match message is accurate.
- Unit, build, lint and e2e checks pass.
