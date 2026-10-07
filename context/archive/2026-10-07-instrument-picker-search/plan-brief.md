# Searchable InstrumentPicker — Plan Brief

> Full plan: `context/changes/instrument-picker-search/plan.md`

## What & Why

Replace three copies of the "pick type, then pick instrument" dropdowns with one searchable `InstrumentPicker`. With ~140 GPW companies planned, scrolling a list and having to know an instrument's type first no longer works. Also unblocks issue #159 (alerts-list filters), which reuses the picker.

## Starting Point

The type → instrument cascade is implemented separately in `instrument-history`, `alert-form` and `remove-instrument`, all with `mat-select` and auto-selection of the first instrument. The full catalogue is already cached client-side.

## Desired End State

A type list ("All types" by default) next to one search field. Typing finds instruments by ticker or name, ignoring Polish diacritics. Nothing is selected on load; the selection can be cleared.

## Key Decisions Made

| Decision | Choice | Why | 
| --- | --- | --- |
| Initial state | Nothing selected; Remove disabled, History shows a hint | ~140 items make "first" arbitrary; safer for destructive remove |
| Unmatched text | Text stays, hint "Choose an instrument from the list", value empty | User fixes their own input |
| Type change | Clears a non-matching selection | Field never contradicts the filter |
| Type filter | Always visible, default "All types" | Matches issue #160 |
| Testing | Component + adapted specs + one e2e | User asked for e2e |
| Delivery | Four phases, one PR, manual check after each | Small verifiable steps |
| Technical shape | Signal models `ticker` + `type` and `ControlValueAccessor` for `ticker` | Serves alert-form now and #159 later |

## Scope

**In scope:** picker, adoption in history / alert form / remove instrument, specs, e2e, i18n.

**Out of scope:** `add-instrument`, backend/API, alerts-list filters (#159), persisting selection.

## Architecture / Approach

Pure search helper (ranking: ticker prefix → ticker substring → name substring, diacritic-insensitive) + `MatAutocomplete`-based component reading `InstrumentsService.instruments()`. Built and proven on the simplest consumer first.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Picker + History | Component, helper, i18n, first adoption | Accessibility parity with `mat-select` |
| 2. Alert form | Reactive-form integration | Edit mode before catalogue loads; RSI/currency logic |
| 3. Remove instrument | Deliberate-selection removal | Destructive action regressions |
| 4. E2E + cleanup | Fixed delete-alert e2e, new scenario | Polish accessible names in e2e |

**Prerequisites:** none. **Estimated effort:** ~3–4 sessions.

## Open Risks & Assumptions

- `e2e/delete-alert.spec.ts` breaks unless updated in Phase 4.
- Screen-reader parity can only be confirmed manually.

## Success Criteria (Summary)

- Finding `CDR` or `zabka` takes a few keystrokes in all three places.
- No regression in alert creation/editing or instrument removal.
