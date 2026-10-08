# Alerts UX polish Implementation Plan

## Overview

Two UX fixes from GitHub issue #171: (1) in the alert dialog the instrument picker shows the type dropdown and the instrument field side by side, which cuts off the selected ticker and name; (2) the alerts list does not show the current value (price or RSI) in the collapsed row.

## Current State Analysis

- `app-instrument-picker` lays out the type field (`flex: 0 1 12rem`) and the instrument field (`flex: 1 1 16rem`) in one wrapping flex row (`instrument-picker.scss`). In the 32rem alert dialog the instrument field is too narrow for "ticker + name".
- The picker is used in 6 places (alert dialog, alert-list filters, dashboard filters, instrument history, two admin panels). Only the dialog has the problem; the filter bars rely on the compact single-row layout.
- `alert-list.html` renders a header row and each summary row with a 3-column grid (`36rem 9.5rem 1fr`: Instrument, Alert type, Threshold). `Alert.currentPrice` / `Alert.currentRsi` are already loaded and shown in the expanded panel; the summary row shows threshold + currency for PRICE and a bare number for RSI (`showCurrentRsi`).

## Desired End State

- In the alert dialog the instrument field sits on its own line below the type dropdown and shows the full ticker and name. Every other picker usage looks exactly as before.
- Each alert row shows a "Current value" cell after Threshold: RSI value for RSI alerts, price plus currency for PRICE alerts, "—" when there is no data. The header gets a matching non-sortable "Current value" label.

### Key Discoveries:

- `src/app/features/instruments/instrument-picker/instrument-picker.scss:6-18` holds the row layout.
- `src/app/features/alerts/alert-form/alert-form.html:16` is the only place that needs the stacked layout.
- `src/app/features/alerts/alert-list/alert-list.scss` defines the grid twice (`.list-header` and `.alert-summary`); both must get the same fourth column.
- `src/app/features/alerts/alert-list/alert-list.spec.ts` renders the list with a stubbed service; `make()` already sets `currentPrice: null`, `currentRsi: null`.
- Strict i18n: new template text needs an `@@id` and a hand-written entry in `src/locale/messages.pl.xlf`.

## What We're NOT Doing

- No change to the picker layout outside the alert dialog (filters, dashboard, history, admin).
- No sorting by current value (price and RSI are different scales).
- No backend or API change; no change to the expanded detail panel.
- No responsive rework of the list grid (existing fixed-width columns stay).

## Implementation Approach

Add an opt-in `stacked` input to the picker that switches its host to a column layout; the alert form sets it. Extend the list grid with a fourth column and render the value per alert type reusing the existing helpers.

## Phase 1: Stacked picker layout in the alert dialog

### Overview

Instrument field on its own line below the type dropdown, dialog only.

### Changes Required:

#### 1. Picker opt-in layout

**File**: `src/app/features/instruments/instrument-picker/instrument-picker.ts`, `.html`, `.scss`

**Intent**: Let a parent request a vertical layout without affecting other usages.

**Contract**: new `readonly stacked = input(false)`; the host gets a `stacked` class while true (host binding); with it, `.picker` becomes a column and both fields take the full width. Default behavior is unchanged.

#### 2. Alert dialog uses it

**File**: `src/app/features/alerts/alert-form/alert-form.html`

**Intent**: Pass `stacked` to the picker in the dialog.

**Contract**: `<app-instrument-picker class="full-width" stacked formControlName="ticker" />`.

#### 3. Test

**File**: `src/app/features/instruments/instrument-picker/instrument-picker.spec.ts`

**Intent**: Cover the new input: host has the `stacked` class when set and not by default.

### Success Criteria:

#### Automated Verification:

- Angular tests pass: `npm run test:ci`
- Production build passes: `npm run build`

#### Manual Verification:

- In the New/Edit alert dialog the instrument sits under the type dropdown and a long name (e.g. "NASDAQ-100") shows fully with its ticker
- Filter bars on alerts, dashboard, history and admin pages look unchanged

---

## Phase 2: Current value column in the alerts list

### Overview

Show the current RSI or price at a glance in the collapsed row.

### Changes Required:

#### 1. List header and rows

**File**: `src/app/features/alerts/alert-list/alert-list.html`, `alert-list.scss`

**Intent**: Add a "Current value" cell after Threshold in the header (plain label, not a sort button) and in each summary row.

**Contract**: grid becomes four columns in both `.list-header` and `.alert-summary` (`36rem 9.5rem 9rem 1fr`; Threshold keeps its own column, Current value takes the last). Cell content: RSI alerts show `currentRsi | number:'1.2-2'`; PRICE alerts show `currentPrice | number:'1.2-2'` plus currency; `null` shows "—". New text key `@@alertList.header.currentValue` ("Current value").

#### 2. Polish translation

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add the `alertList.header.currentValue` trans-unit with Polish target "Bieżąca wartość" (next to the other `alertList.sort.*` units).

#### 3. Tests

**File**: `src/app/features/alerts/alert-list/alert-list.spec.ts`

**Intent**: Cover the cell: PRICE shows price with currency, RSI shows the number without currency, null shows "—", and the header label is present.

### Success Criteria:

#### Automated Verification:

- Angular tests pass: `npm run test:ci`
- Production build (strict i18n) passes: `npm run build`

#### Manual Verification:

- Alerts list header shows "Current value" (Polish locale: "Bieżąca wartość") aligned with the row cells
- A PRICE alert shows the price with currency, an RSI alert shows the RSI, an alert without data shows "—"
- Sorting by the other columns, expanding a row, filters, edit and delete still work

---

## Testing Strategy

### Unit Tests:

- Picker: `stacked` input toggles the host class.
- Alert list: current value cell for PRICE, RSI and null.

### Manual Testing Steps:

1. Open "New alert", pick a type, then a long-named instrument; confirm the stacked layout.
2. Open the alerts list; compare values with the expanded panel.
3. Check the dashboard and alerts filter bars are unchanged.

## References

- GitHub issue #171
- `src/app/features/instruments/instrument-picker/instrument-picker.scss`
- `src/app/features/alerts/alert-list/alert-list.html`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Stacked picker layout in the alert dialog

#### Automated

- [x] 1.1 Angular tests pass (npm run test:ci)
- [x] 1.2 Production build passes (npm run build)

#### Manual

- [ ] 1.3 Alert dialog shows the instrument under the type dropdown with the full ticker and name
- [ ] 1.4 Other picker usages (filters, dashboard, history, admin) look unchanged

### Phase 2: Current value column in the alerts list

#### Automated

- [ ] 2.1 Angular tests pass (npm run test:ci)
- [ ] 2.2 Production build with strict i18n passes (npm run build)

#### Manual

- [ ] 2.3 Header shows "Current value" (Polish: "Bieżąca wartość") aligned with the row cells
- [ ] 2.4 PRICE alert shows price with currency, RSI alert shows RSI, no data shows "—"
- [ ] 2.5 Sorting, expanding, filters, edit and delete still work
