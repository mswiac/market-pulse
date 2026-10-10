# Add-instrument currency prefill Implementation Plan

## Overview

On the admin "Add instrument" form the currency stays at the first list entry (EUR) whatever the selected type is, so the admin changes it by hand for every PL or US stock. Prefill it on a type change: `pl_stock` -> PLN, `us_stock` -> USD, anything else -> EUR. Tracked as GitHub issue #200.

## Current State Analysis

- `onTypeChange` in `src/app/features/admin/add-instrument/add-instrument.ts` sets the type and resets the suffix from `SUFFIX_DEFAULTS` (empty string for types without an entry). It runs on the type select only, so it never fights a later manual edit of the suffix.
- `currency` is a signal initialised to `CURRENCIES[0]` (EUR); `onCurrencyChange` is the only other writer, plus `resetForm`.
- Unit spec `add-instrument.spec.ts` already covers the suffix prefill pattern and asserts the default currency (EUR) after submit/reset.
- E2E `e2e/admin/add-instrument.spec.ts` creates an instrument with default type and currency and deletes it in `afterEach`.

## Desired End State

Picking "PL companies" shows PLN in the currency select, "US companies" shows USD, "Index" shows EUR. The admin can still change the currency afterwards, and that choice survives edits to other fields. The submitted payload carries the shown currency.

## What We're NOT Doing

- No backend change; `instruments.currency` stays a manually supplied value.
- No new currencies in the list, no change to suffix behaviour.
- No change to `resetForm` (it already restores EUR and the first type, which maps to the same default).

## Implementation Approach

Mirror the suffix pattern: a `CURRENCY_DEFAULTS` map next to `SUFFIX_DEFAULTS`, applied in `onTypeChange` only. A type without an entry falls back to `CURRENCIES[0]` (EUR), so switching pl -> index does not leave a stale PLN.

## Phase 1: Prefill currency on type change

### Overview

One component change plus unit and E2E coverage.

### Changes Required:

#### 1. Component

**File**: `src/app/features/admin/add-instrument/add-instrument.ts`

**Intent**: Prefill the currency signal from the selected type, the same way the suffix is prefilled, with the explicit comment that it happens on type change only.

**Contract**: `const CURRENCY_DEFAULTS: Record<string, string>` with `pl_stock: 'PLN'`, `us_stock: 'USD'`; `onTypeChange` additionally calls `this.currency.set(CURRENCY_DEFAULTS[type] ?? CURRENCIES[0])`.

#### 2. Unit test

**File**: `src/app/features/admin/add-instrument/add-instrument.spec.ts`

**Intent**: Extend the existing suffix-prefill style test: type change sets PLN / USD / EUR, and a manual currency pick survives unrelated field edits.

**Contract**: Follows the existing `onTypeChange` / `onCurrencyChange` helpers of the spec; no new test infrastructure.

#### 3. E2E

**File**: `e2e/admin/add-instrument.spec.ts`

**Intent**: Add one case that picks "PL companies", asserts the currency select shows PLN, submits, and asserts the POST body sent `currency: "PLN"`; the existing `afterEach` cleanup deletes the unique ticker.

**Contract**: Locators by role/label (Polish `development-pl` build strings from `src/locale/messages.pl.xlf`); the existing test stays untouched and passing.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Angular unit tests pass: `npm run test:ci`
- Lint passes: `npm run lint`
- Add-instrument E2E passes (both cases): `npx playwright test e2e/admin/add-instrument.spec.ts`

#### Manual Verification:

- On `/admin/add-instrument`, switching type shows PLN / USD / EUR, and a manual currency change is kept while typing ticker and name

---

## Testing Strategy

### Unit Tests:

- pl_stock -> PLN, us_stock -> USD, index -> EUR; pl -> index does not keep PLN
- Manual currency choice survives ticker/name edits

### Integration Tests:

- E2E: PL type submits `currency: "PLN"` to the real API

## References

- Issue: #200
- Same pattern: `SUFFIX_DEFAULTS` in `src/app/features/admin/add-instrument/add-instrument.ts`

## Progress

> Convention: `- [x]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prefill currency on type change

#### Automated

- [x] 1.1 Typecheck passes
- [x] 1.2 Angular unit tests pass
- [x] 1.3 Lint passes
- [x] 1.4 Add-instrument E2E passes (both cases)

#### Manual

- [x] 1.5 Type switch prefills PLN / USD / EUR and manual currency edits are kept
