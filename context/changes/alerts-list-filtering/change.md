---
change_id: alerts-list-filtering
title: Add filtering to alerts list
status: impl_reviewed
created: 2026-10-07
updated: 2026-10-07
archived_at: null
---

## Notes

GitHub issue #159: Add filtering to alerts list (instrument type, instrument, alert type).

Users can create many alerts, but the list has no way to narrow them down. Add filter controls for instrument type (e.g. index), instrument (e.g. VIX, NASDAQ-100) and alert type (price / RSI). Filters should likely be combinable (AND logic). UX is open (dropdowns vs. chips/tabs). Scope: frontend-only if alerts are already fully loaded client-side; otherwise backend query params may be needed.

Dependency: issue #160 (searchable InstrumentPicker) lands first. The instrument-type + instrument filters in this change reuse that component (needs a clearable "no selection" state); only the alert-type (PRICE/RSI) filter is built here. Planning for this change resumes after #160 is implemented.
