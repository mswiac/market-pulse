# E2E User Flows Implementation Plan

## Overview

Close the user-facing E2E gaps listed in issue #186. Today only alert create, delete and filters are covered in the browser. This change adds risk-tied specs for alert editing, form validation, the current-value column, the register / log out / log in journey, and smoke checks for the two history pages. Test-only: no production code changes.

## Current State Analysis

- Existing user specs run in the `chromium` project (storageState from `auth.setup.ts`): `seed.spec.ts`, `delete-alert.spec.ts`, `alerts-filter.spec.ts`, `dashboard.spec.ts`, `instrument-picker.spec.ts`. Admin specs run in `chromium-admin` and live under `e2e/admin/`.
- The alert form (`src/app/features/alerts/alert-form/alert-form.html`) is shared by create and edit (`isEditMode`). Threshold errors: `required`, `min`/`max` (RSI 0–100), `positive` (price > 0). A 409 maps to "Taki alert już istnieje.".
- The alerts list renders a "Bieżąca wartość" column (price with currency, RSI, or "—") from `currentPrice` / `currentRsi` returned by `GET /api/alerts`.
- Login failure shows "Nieprawidłowy e-mail lub hasło."; registering a taken email shows "Ten adres e-mail jest już zarejestrowany."; the shell has a "Wyloguj" button.
- Trigger history (`/history/triggers`) shows a table or the empty state "Brak jeszcze uruchomionych alertów."; instrument history (`/history`) shows a prompt until an instrument is picked, then a table of closes.
- `e2e/admin/admin-api.ts` already provides `registerUser`, `deleteUser`, `uniqueSuffix` for throwaway accounts. Only an admin can delete a user (`DELETE /api/admin/users/:id`).

## Desired End State

Each of the six scope bullets in #186 has a reviewed, break-verified spec that passes with `npx playwright test`, creates its own data with unique values, and cleans up after itself. The CI e2e workflow stays informational and green.

### Key Discoveries:

- Register/log-in tests create accounts, and cleanup needs the admin API, so that spec runs in `chromium-admin` with an empty `storageState` (anonymous browser) and an admin `request` for cleanup.
- The alerts UNIQUE constraint (user_id, ticker, alert_type, threshold) requires a unique threshold per test, as in `seed.spec.ts`.
- The dev server runs the `development-pl` build, so locators use the Polish strings from `src/locale/messages.pl.xlf`.

## What We're NOT Doing

- No production code changes and no Angular/worker unit tests (covered elsewhere).
- No testing of alert pause (#199) or currency prefill (#200).
- No real market-data assertions: current value and instrument history tables use mocked API responses.
- No new Playwright projects or config changes.

## Implementation Approach

Three phases, one reviewed spec per risk (budget 1–3 tests per phase, per the 10x-e2e rules, relaxed for validation where the user asked for one test per case), each generated from a prompt file in `e2e/prompts/` and modelled on `seed.spec.ts`. Shared alert setup/cleanup helpers go in `e2e/alerts-api.ts` (create alert through the API, delete by id) so tests do not repeat UI setup for flows that are not about creation.

## Phase 1: Alert editing, validation and current value

### Overview

Browser-level coverage of the alert form beyond creation, plus the current-value column.

### Changes Required:

#### 1. Alert API helper

**File**: `e2e/alerts-api.ts`

**Intent**: Create an alert for the logged-in user through the API with a unique threshold and delete it by id, so edit/validation tests start from a known alert and always clean up.

**Contract**: `createAlert(request, { ticker, alertType, threshold })` returns the alert id; `deleteAlert(request, id)` tolerates 404.

#### 2. Edit persistence spec

**File**: `e2e/alerts-edit.spec.ts`

**Intent**: Open an existing alert's edit dialog, change the threshold, save, reload, and assert the new value persisted and the old one is gone.

**Contract**: Real boundaries: auth, `PUT /api/alerts/:id`, D1, list re-render. Nothing mocked.

#### 3. Validation specs

**File**: `e2e/alerts-validation.spec.ts`

**Intent**: One test per case: empty threshold (submit disabled), non-positive price threshold (error "Wartość musi być większa od 0." and nothing saved), RSI out of range (error "Wartość musi mieścić się w zakresie 0–100."), duplicate alert (409 shows "Taki alert już istnieje." and no second row).

**Contract**: Real server for the duplicate case; client-only cases assert that no `POST /api/alerts` is sent.

#### 4. Current value spec

**File**: `e2e/alerts-current-value.spec.ts`

**Intent**: With `GET /api/alerts` fulfilled at the network layer (fixed price, fixed RSI, and one alert with null values), assert the "Bieżąca wartość" column renders the formatted value and "—" for missing data.

**Contract**: Mocked: `GET /api/alerts` only; a broad guard aborts any other unmatched `/api/alerts` call.

#### 5. Prompt file

**File**: `e2e/prompts/alerts-user-flows.prompt.md`

**Intent**: Filled `e2e-prompt-template.md` for this phase's risks (Risk #4 facets).

### Success Criteria:

#### Automated Verification:

- New specs pass: `npx playwright test e2e/alerts-edit.spec.ts e2e/alerts-validation.spec.ts e2e/alerts-current-value.spec.ts`
- Whole suite stays green: `npx playwright test`
- Format check passes: `npx prettier --check e2e`

#### Manual Verification:

- A deliberate break (e.g. PUT ignoring the threshold, or removing the duplicate message) makes the matching test fail.
- No test alerts remain in local D1 after a run.

---

## Phase 2: Register, log out, log back in

### Overview

The account journey and the wrong-password path, with admin cleanup of the throwaway user.

### Changes Required:

#### 1. Account flow spec

**File**: `e2e/admin/account-flow.spec.ts`

**Intent**: An anonymous browser registers a new user through the form, logs out, logs back in with the same credentials and reaches the dashboard; a second test shows the error for a wrong password and stays on `/login`; a third shows the taken-email message on duplicate registration.

**Contract**: Uses `test.use({ storageState: { cookies: [], origins: [] } })`; the email is built from `uniqueSuffix()` (domain `e2e.market-pulse.test`, as in `admin-api.ts`); `afterEach` deletes the user by id through the admin session. The id comes from the register response or from a lookup, whichever the implementation finds simplest. After logout a direct visit to `/alerts` must redirect to login. Nothing mocked.

#### 2. Prompt file

**File**: `e2e/prompts/account-flow.prompt.md`

**Intent**: Prompt for this risk (Risk #4 auth facet, Risk #6 session boundary after logout).

### Success Criteria:

#### Automated Verification:

- Spec passes: `npx playwright test e2e/admin/account-flow.spec.ts`
- Whole suite stays green: `npx playwright test`

#### Manual Verification:

- Registered users are removed from local D1 after the run.

---

## Phase 3: History page smoke tests

### Overview

Two smoke tests proving both history pages load.

### Changes Required:

#### 1. Trigger history smoke

**File**: `e2e/history-smoke.spec.ts`

**Intent**: Visiting `/history/triggers` renders the page heading and either the table or the empty state, with no load-error message. Real backend.

**Contract**: Asserts the load-error text is absent rather than depending on seeded events.

#### 2. Instrument history smoke

**File**: `e2e/history-smoke.spec.ts` (same file)

**Intent**: Visiting `/history` and picking an instrument renders a table of closes. The history endpoint is fulfilled with fixed rows so the assertion is deterministic.

**Contract**: Mocked: the instrument history GET only; the instrument list and picker stay real.

### Success Criteria:

#### Automated Verification:

- Spec passes: `npx playwright test e2e/history-smoke.spec.ts`
- Whole suite stays green: `npx playwright test`

#### Manual Verification:

- A deliberate break (the history route erroring) makes the smoke test fail.

---

## Testing Strategy

### E2E Tests:

- One reviewed test per risk facet, per the `10x-e2e` rules: role locators, wait-for-state, unique data, cleanup, five anti-pattern review, deliberate-break check.

### Manual Testing Steps:

1. Run `npx playwright test` with both dev servers up and confirm green.
2. Check local D1 has no leftover `e2e-` users or test alerts.

## Performance Considerations

Specs are independent and parallel-safe (unique thresholds and emails).

## References

- Issue #186; seed `e2e/seed.spec.ts`; helpers `e2e/admin/admin-api.ts`; prior change `context/archive/2026-10-10-e2e-admin-management/`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Alert editing, validation and current value

#### Automated

- [x] 1.1 New alert specs pass — 74f68a4
- [x] 1.2 Whole Playwright suite stays green — 74f68a4
- [x] 1.3 Prettier check passes for e2e (new files; 3 older specs already unformatted on main) — 74f68a4

#### Manual

- [x] 1.4 Deliberate breaks make the matching tests fail — 74f68a4
- [x] 1.5 No test alerts remain in local D1 — 74f68a4

### Phase 2: Register, log out, log back in

#### Automated

- [x] 2.1 Account flow spec passes
- [x] 2.2 Whole Playwright suite stays green

#### Manual

- [x] 2.3 Registered users removed from local D1

### Phase 3: History page smoke tests

#### Automated

- [ ] 3.1 History smoke spec passes
- [ ] 3.2 Whole Playwright suite stays green

#### Manual

- [ ] 3.3 Deliberate break makes the smoke test fail
