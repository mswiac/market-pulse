# Searchable InstrumentPicker Implementation Plan

## Overview

Extract one reusable `InstrumentPicker` component (single search field with type-ahead on ticker and name, plus an optional instrument-type narrowing filter) and adopt it in `instrument-history`, `alert-form` and `admin/remove-instrument`. Source: GitHub issue #160. The change also prepares the ground for issue #159 (alerts-list-filtering), which will reuse the picker as a list filter.

## Current State Analysis

The type → instrument cascade is implemented three times, independently:

- `src/app/features/instrument-history/instrument-history.ts` — signals; `onTypeChange` auto-selects the first instrument of the type and immediately loads its history.
- `src/app/features/admin/remove-instrument/remove-instrument.ts` — signals; same auto-select, re-run after `reload()`; the remove button is enabled right away for the auto-selected instrument.
- `src/app/features/alerts/alert-form/alert-form.ts` — reactive `FormGroup` with `instrumentType` + `ticker` controls and `valueChanges` subscriptions. Other logic reads the selected ticker: `showRsiOption()`, `selectedInstrumentCurrency()`, and the reset of `alertType` to `PRICE` for non-RSI instruments.

All three use plain `mat-select`. The type is a prerequisite for seeing any instrument. `InstrumentsService` (`src/app/features/instruments/instrument-types.ts` holds `INSTRUMENT_TYPE_LABELS`) already caches the whole catalogue in a signal, so filtering stays client-side and no API change is needed. `add-instrument` selects from `CREATABLE_INSTRUMENT_TYPES`, not loaded data — out of scope.

### Key Discoveries:

- `alert-form.ts` constructor comment: the `valueChanges` subscriptions must exist before `ensureLoaded()` because a warm cache emits synchronously. Edit mode pre-fills `ticker` before the cache loads; the picker must accept a ticker it cannot resolve yet.
- `e2e/delete-alert.spec.ts` drives the alert form with `getByRole('combobox', { name: 'Instrument' })` + `getByRole('option', { name: 'NASDAQ-100' })`. It runs against the Polish build, so the new combobox name and option text (`^NDX — NASDAQ-100`) will break it unless updated in this change.
- `alert-form.spec.ts` and `remove-instrument.spec.ts` exist and assume `mat-select` and auto-selection; both need updating. `instrument-history` has no spec.
- i18n is strict (`i18nMissingTranslation: error`): every new `i18n` string needs entries in `src/locale/messages.xlf` and `messages.pl.xlf`.
- Issue #159 needs the picker to expose both the selected ticker and the type filter, and to be usable on plain signals as well as via `ControlValueAccessor`.

## Desired End State

One `InstrumentPicker` component used in three places. The user sees a type list (default "All types") next to a search field. Typing filters the whole catalogue by ticker or name (diacritics ignored), options read `TICKER — Name`. Nothing is selected on first load. The selection can be cleared. Verified by: unit specs for the component and the two adapted specs pass, the e2e scenario passes, and the manual checks in each phase.

## What We're NOT Doing

- `admin/add-instrument` (explicitly out of scope in #160).
- Any backend or API change; server-side search.
- Applying the picker to the alerts-list filter (that is issue #159 / `alerts-list-filtering`, planned afterwards).
- Remembering the last selection across reloads (no URL or storage persistence).

## Implementation Approach

Build the component first and prove it on the simplest consumer (`instrument-history`), then the hardest (`alert-form`, reactive form), then the destructive one (`remove-instrument`). Product rules (decided with the user):

- Search field filters on ticker and name; ranking: ticker prefix, ticker substring, name substring; diacritic-insensitive (NFD + strip combining marks). Matching and ranking live in a small pure function so they are unit-testable without the DOM.
- Type filter is part of the picker, default "All types". Changing the type clears the selected instrument if it does not belong to the new type.
- No default selection. Remove button disabled and history shows a "choose an instrument" hint until something is selected.
- Typing text that matches no option keeps the text in the field, shows "No matches" in the panel and an inline hint "Choose an instrument from the list"; the value stays empty until a valid option is picked. Editing the text after a selection clears that selection.
- The selection can be cleared with a clear button.

Technical shape (decided in planning, not user-facing): the picker exposes a two-way `ticker` and an optional two-way `type` as signal models, and implements `ControlValueAccessor` for the ticker so `alert-form` can bind it with `formControlName`. Options come from `InstrumentsService.instruments()`. The picker unresolved-ticker case (edit mode before load) keeps the incoming ticker as the value and resolves the display text once the catalogue arrives.

## Critical Implementation Details

- **Accessibility**: the current `mat-select` is accessible by default; the replacement must keep `role=combobox` / `role=option`, keyboard selection and a programmatic label. Verify with keyboard only and a screen-reader check (manual).
- **Timing & lifecycle**: in `alert-form`, wire the picker value before/independently of `ensureLoaded()` emission; the existing comment about synchronous emission from a warm cache still applies to the remaining `valueChanges` subscriptions.

## Phase 1: InstrumentPicker + Instrument history

### Overview

Create the component and adopt it in the simplest consumer.

### Changes Required:

#### 1. Search/ranking helper

**File**: `src/app/features/instruments/instrument-search.ts`

**Intent**: Pure function that filters and ranks instruments for a query and an optional type, diacritic-insensitively.

**Contract**: `searchInstruments(instruments: Instrument[], query: string, type: string): Instrument[]` — empty query returns all instruments of the type sorted by name; otherwise ticker-prefix matches, then ticker-substring, then name-substring, each group sorted by name.

#### 2. InstrumentPicker component

**File**: `src/app/features/instruments/instrument-picker/instrument-picker.{ts,html,scss}`

**Intent**: Type list ("All types" default) + `MatAutocomplete` search field with clear button, "No matches" option and inline hint for unmatched text.

**Contract**: Signal models `ticker` (string, `''` = none) and `type` (string, `''` = all); implements `ControlValueAccessor` for `ticker`. Changing `type` clears `ticker` when that instrument is not of the new type. Option display `TICKER — Name`. New i18n ids under `@@instrumentPicker.*`; entries added to both xlf files.

#### 3. Instrument history adoption

**File**: `src/app/features/instrument-history/instrument-history.{ts,html}`

**Intent**: Replace the two `mat-select`s with the picker; remove auto-selection; load history when a ticker is chosen and show a "choose an instrument" hint when empty.

**Contract**: Selecting a ticker triggers `getHistory`; clearing it resets history and errors. Keep the out-of-order response guard.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Component and helper specs pass: `npm run test:ci`
- Production build (incl. Polish i18n) passes: `npm run build`

#### Manual Verification:

- Typing a ticker (`CDR`) or part of a name finds the instrument; `zabka` finds `Żabka`; an exact ticker ranks above incidental name matches.
- Changing the type narrows results and clears a non-matching selection.
- Unmatched text stays in the field with the hint; clearing works; history shows the hint when nothing is selected.
- Keyboard-only use and screen-reader announcement work.

**Implementation Note**: After this phase and passing automated checks, pause for manual confirmation before Phase 2.

---

## Phase 2: Alert form

### Overview

Adopt the picker in the reactive form without breaking RSI/currency behaviour or edit mode.

### Changes Required:

#### 1. Alert form integration

**File**: `src/app/features/alerts/alert-form/alert-form.{ts,html}`

**Intent**: Replace the `instrumentType` + `ticker` controls with the picker bound to the `ticker` control; drop the type→ticker cascade and `instrumentType` control; keep ticker-dependent logic working.

**Contract**: `ticker` remains `Validators.required`; `showRsiOption()`, `selectedInstrumentCurrency()` and the RSI→PRICE reset look instruments up in `instrumentsService.instruments()` instead of the type-filtered list. Edit mode starts with the alert's ticker selected and shown after the catalogue loads. New alert starts empty (create button disabled until valid).

#### 2. Spec update

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Adapt existing cases to the autocomplete (find by combobox role, type text, click option) and drop auto-selection assumptions.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`, `npm run lint`, `npm run test:ci` pass

#### Manual Verification:

- Creating an alert for VIX hides RSI; switching from an RSI-eligible instrument to VIX resets to Price.
- Editing an existing alert shows its instrument and saves without touching it.
- Currency suffix still appears for price alerts.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Remove instrument

### Overview

Swap the cascade; make removal require a deliberate choice.

### Changes Required:

#### 1. Remove instrument adoption

**File**: `src/app/features/admin/remove-instrument/remove-instrument.{ts,html}`

**Intent**: Use the picker; no auto-selected instrument; remove button disabled until a ticker is selected; after a successful removal and `reload()`, clear the selection.

**Contract**: `canSubmit` = selected ticker and not submitting. Picker disabled while submitting.

#### 2. Spec update

**File**: `src/app/features/admin/remove-instrument/remove-instrument.spec.ts`

**Intent**: Adapt to the autocomplete and the empty initial state.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`, `npm run lint`, `npm run test:ci` pass

#### Manual Verification:

- Remove button inactive on load; active after choosing an instrument; confirm dialog still shows the right ticker and alert count.
- After removal the picker is empty and the removed instrument no longer appears.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: E2E and cleanup

### Overview

Fix the existing e2e that uses the alert form and add one picker scenario.

### Changes Required:

#### 1. Existing e2e

**File**: `e2e/delete-alert.spec.ts`

**Intent**: Select the instrument via the new combobox (type `NASDAQ`, click the option) instead of the old `mat-select` flow.

#### 2. New e2e scenario

**File**: `e2e/instrument-picker.spec.ts`

**Intent**: Search for an instrument by typing and see its history, following the seed patterns (`getByRole`, wait for state, Polish build names, independent test).

#### 3. Cleanup

**Intent**: Remove now-unused code and imports left from the old cascades (unused `MatSelectModule` imports, `instrumentTypes`/`instrumentOptions` helpers, orphaned i18n ids in both xlf files).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`, `npm run lint`, `npm run test:ci`, `npm run build` pass
- E2E run passes: `npx playwright test e2e/delete-alert.spec.ts e2e/instrument-picker.spec.ts`

#### Manual Verification:

- No leftover unused i18n strings or dead code; app builds in both locales.

## Testing Strategy

### Unit Tests:

- `searchInstruments`: ranking order, diacritics, type filter, empty query.
- `InstrumentPicker`: select by click and keyboard, clear, unmatched-text hint, type change clears non-matching selection, CVA write/read, unresolved ticker before catalogue load.
- Updated `alert-form` and `remove-instrument` specs.

### Integration Tests:

- One Playwright scenario (Phase 4) plus the adapted delete-alert flow.

### Manual Testing Steps:

1. History page: search by ticker, by name, with a diacritic-free query; clear; unmatched text.
2. New and edited alert incl. VIX/RSI behaviour.
3. Remove-instrument empty start and post-removal state.
4. Keyboard-only run through all three.

## Performance Considerations

~140 instruments filtered per keystroke in memory; no debounce or virtualization needed at this scale.

## Migration Notes

None (no data or API changes). Issue #159 (`alerts-list-filtering`) consumes the picker's `ticker` and `type` signal models afterwards.

## References

- GitHub issues #160 and #159; `context/changes/alerts-list-filtering/change.md`
- Existing cascades: `instrument-history.ts`, `remove-instrument.ts`, `alert-form.ts`
- E2E seed patterns: `e2e/seed.spec.ts`, `e2e/delete-alert.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: InstrumentPicker + Instrument history

#### Automated

- [x] 1.1 Type check passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Component and helper specs pass: `npm run test:ci`
- [x] 1.4 Production build (incl. Polish i18n) passes: `npm run build`

#### Manual

- [x] 1.5 Search by ticker, name and diacritic-free query works with correct ranking
- [x] 1.6 Type filter narrows results and clears a non-matching selection
- [x] 1.7 Unmatched text stays with hint; clear works; history shows hint when empty
- [x] 1.8 Keyboard-only and screen-reader use work

### Phase 2: Alert form

#### Automated

- [x] 2.1 `npm run typecheck`, `npm run lint`, `npm run test:ci` pass

#### Manual

- [x] 2.2 VIX hides RSI; switching to VIX resets to Price
- [x] 2.3 Editing an existing alert shows its instrument and saves
- [x] 2.4 Currency suffix still appears for price alerts

### Phase 3: Remove instrument

#### Automated

- [x] 3.1 `npm run typecheck`, `npm run lint`, `npm run test:ci` pass

#### Manual

- [x] 3.2 Remove button inactive on load, active after choosing; confirm dialog correct
- [x] 3.3 After removal the picker is empty and the instrument is gone

### Phase 4: E2E and cleanup

#### Automated

- [x] 4.1 `npm run typecheck`, `npm run lint`, `npm run test:ci`, `npm run build` pass
- [x] 4.2 E2E passes: `npx playwright test e2e/delete-alert.spec.ts e2e/instrument-picker.spec.ts`

#### Manual

- [x] 4.3 No leftover dead code or unused i18n strings; both locales build
