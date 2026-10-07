---
change_id: instrument-picker-search
title: Extract searchable InstrumentPicker component
status: impl_reviewed
created: 2026-10-07
updated: 2026-10-07
archived_at: null
---

## Notes

GitHub issue #160: Extract searchable InstrumentPicker component (type-ahead on ticker and name). Adopt in instrument-history, alert-form (ControlValueAccessor) and admin/remove-instrument; add-instrument is out of scope.

Requirements carried over from issue #159 (alerts-list-filtering), which depends on this change:
- The picker must support a clearable "no selection" state that does not filter anything.
- It must be usable with plain signals (model()/input()/output()), not only via ControlValueAccessor, so the alerts list can use it as a filter.
