# Alerts List Filtering Implementation Plan

## Overview

Add combinable (AND) filters to the alerts list on the home page: instrument type, instrument, and alert type (price / RSI). Instrument type and instrument reuse the searchable `InstrumentPicker` delivered by #160; the alert-type filter is a plain select built here. Frontend-only: `AlertsService` already loads all of the user's alerts into a signal.

## Current State Analysis

- `AlertList` (`src/app/features/alerts/alert-list/alert-list.ts`) renders `sortedAlerts`, a `computed` over `alertsService.alerts()` plus sort state. There is no filtering. The sort header row is only shown when `alerts().length > 0`.
- Each `Alert` already carries `ticker`, `instrumentType` and `alertType`, so no API change is needed.
- `InstrumentPicker` exposes `ticker` and `type` as `model()`s (`''` = nothing selected / all types), a clear button, and reads the catalogue from `InstrumentsService`. Parents must call `InstrumentsService.ensureLoaded()` themselves.
- The empty state currently says "No alerts yet", which would be misleading when filters hide everything.

## Desired End State

Above the sort header, a filter bar with: the instrument picker (type + searchable instrument), an "Alert type" select (All / Price threshold / RSI threshold), and a "Clear filters" button shown only while a filter is active. The list shows only alerts matching every active filter; sorting still works on the filtered set. If alerts exist but none match, the list shows "No alerts match the selected filters." Filters are not persisted (reset on reload) and are left untouched when an alert is added or edited.

### Key Discoveries:

- `src/app/features/alerts/alert-list/alert-list.ts:49` — `sortedAlerts` is the single place to insert a `filteredAlerts` stage.
- `src/app/features/instruments/instrument-picker/instrument-picker.ts:28-30` — `ticker`/`type` models make `[(ticker)]` / `[(type)]` two-way binding possible without forms.
- `AlertsService.create()` prepends to the signal, so an active filter naturally hides a non-matching new alert (chosen behavior).

## What We're NOT Doing

- No backend / API / query-param changes.
- No persistence of filters (URL or storage).
- No result counter, no chips/tabs UI.
- No restriction of the picker to instruments that have alerts (it lists the full catalogue; picking one with no alerts shows the "no match" message).
- No change to `InstrumentPicker` itself.

## Implementation Approach

A pure helper `filterAlerts(alerts, filters)` holds the matching rule so it is trivially unit-testable: a non-empty `ticker` matches on ticker; otherwise a non-empty `type` matches on `instrumentType` (the picker already clears a selection that contradicts the chosen type, so both together never conflict); a non-empty `alertType` matches on `alertType`. `AlertList` owns three filter signals, bound to the picker via two-way binding, and feeds `filteredAlerts` into the existing sort stage.

## Phase 1: Filters in the alerts list

### Overview

Filter helper, filter bar UI, empty-state variants, i18n, unit tests.

### Changes Required:

#### 1. Filter helper

**File**: `src/app/features/alerts/alert-filter.ts` (new) and `alert-filter.spec.ts`

**Intent**: Pure function applying the AND rule; spec covers each filter alone, combinations, empty filters returning everything, and ticker taking precedence over type.

**Contract**: `interface AlertFilters { type: string; ticker: string; alertType: string }` and `filterAlerts(alerts: Alert[], filters: AlertFilters): Alert[]`; `''` means "no filter".

#### 2. AlertList logic

**File**: `src/app/features/alerts/alert-list/alert-list.ts`

**Intent**: Add `filterType`, `filterTicker`, `filterAlertType` signals, a `filteredAlerts` computed feeding `sortedAlerts`, a `hasActiveFilters` computed and `clearFilters()`. Call `InstrumentsService.ensureLoaded()` in the constructor (ignore errors: the picker then just shows no options, and the list still works). Import `InstrumentPicker`, `MatFormFieldModule`, `MatSelectModule`.

**Contract**: Alert-type options are `''`, `'PRICE'`, `'RSI'` labelled via the existing `ALERT_TYPE_LABELS` plus a new "All alert types" label.

#### 3. AlertList template and styles

**File**: `src/app/features/alerts/alert-list/alert-list.html`, `alert-list.scss`

**Intent**: Filter bar rendered when `alerts().length > 0` (same condition as the sort header), placed above it; wraps on narrow screens. "Clear filters" button visible only when `hasActiveFilters()`. Empty state splits in two: no alerts at all (existing text) vs alerts exist but none match (new text, with a clear-filters button).

**Contract**: i18n ids `@@alertList.filter.alertType`, `@@alertList.filter.alertType.all`, `@@alertList.filter.clear`, `@@alertList.noMatches`.

#### 4. Translations

**File**: `src/locale/messages.pl.xlf`

**Intent**: Add Polish targets for the new ids only (edit by hand; do not run `extract-i18n` — it rewrites the stale `messages.xlf`).

#### 5. Component spec

**File**: `src/app/features/alerts/alert-list/alert-list.spec.ts` (new)

**Intent**: Render with mocked HTTP; verify the filter bar is hidden with no alerts, alert-type filter narrows rows, combining with an instrument selection ANDs, the no-match message appears and "Clear filters" restores the list, and sorting applies to the filtered set.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:ci`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build passes (strict i18n): `npm run build`

#### Manual Verification:

- Alert-type, type and instrument filters each narrow the list and combine with AND
- "Clear filters" appears only when a filter is active and resets everything
- "No alerts match…" shows when filters hide everything; "No alerts yet" still shows with zero alerts
- Adding an alert that does not match an active filter leaves the filters unchanged
- Layout is acceptable on a narrow window

**Implementation Note**: Manual checks are batched at the end (after Phase 2).

---

## Phase 2: E2E coverage

### Overview

One Playwright scenario for the user-visible filter flow.

### Changes Required:

#### 1. E2E test

**File**: `e2e/alerts-filter.spec.ts` (new)

**Intent**: Create a price alert and an RSI alert on one instrument via the UI (unique thresholds, API cleanup in `afterEach`, modeled on `e2e/delete-alert.spec.ts`), select the "Alert type" filter, assert only the matching row stays visible, then "Clear filters" restores both. Polish accessible names from `messages.pl.xlf`, `getByRole` locators only.

### Success Criteria:

#### Automated Verification:

- E2E passes: `npx playwright test e2e/alerts-filter.spec.ts`
- Full unit suite still passes: `npm run test:ci`

#### Manual Verification:

- End-to-end flow checked in `npm start` with real data

---

## Addendum (impl-review F1)

The "no match" empty state shows only its message, not a second "Clear filters" button: the filter bar's own button stays visible above it and does the same job.

## Testing Strategy

### Unit Tests:

- `filterAlerts` rule table (each filter, combos, precedence, empty).
- `AlertList` filter bar behavior, empty states, interaction with sorting.

### Manual Testing Steps:

1. Open `/` with several alerts across types; apply each filter, then combinations.
2. Filter to nothing, verify message and clear button.
3. Add a non-matching alert while filtered; confirm filters stay.
4. Reload; filters reset.

## References

- Issue #159; dependency archived at `context/archive/2026-10-07-instrument-picker-search/`.
- Similar pattern: `src/app/features/instrument-history/instrument-history.ts` (picker with two-way `ticker`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Filters in the alerts list

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:ci`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Production build passes: `npm run build`

#### Manual

- [x] 1.5 Each filter narrows the list and filters combine with AND
- [x] 1.6 Clear filters button appears only when active and resets everything
- [x] 1.7 No-match message vs. no-alerts message are correct
- [x] 1.8 Adding a non-matching alert keeps filters unchanged
- [x] 1.9 Layout acceptable on a narrow window

### Phase 2: E2E coverage

#### Automated

- [x] 2.1 E2E passes: `npx playwright test e2e/alerts-filter.spec.ts`
- [x] 2.2 Full unit suite still passes: `npm run test:ci`

#### Manual

- [x] 2.3 End-to-end flow checked in `npm start` with real data
