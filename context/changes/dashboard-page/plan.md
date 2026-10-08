# Dashboard Page Implementation Plan

## Overview

Add a Dashboard ("Pulpit") page as the first menu item and the landing page after login. It lists every instrument in the system, one row per instrument, taken from its latest close, with the same columns as Instrument history plus an Instrument column, and the same instrument/type filtering. The alerts list moves from `/` to its own route `/alerts`. GitHub issue: #167.

## Current State Analysis

- `''` (inside the authenticated shell) renders `Home`: welcome card, `<app-alert-list />`, "New alert" FAB (`src/app/app.routes.ts:11`, `src/app/features/home/home.html`).
- Login and register both finish with `navigateByUrl('/')` (`login.ts:37`, `register.ts:38`), so whatever lives at `''` is the landing page.
- The sidenav has Alerts (`routerLink="/"`, exact), a History group and an Admin group (`src/app/core/shell/shell.html:13`).
- Instrument history (`/history`) shows one instrument at a time: columns date/close/high/low (+rsi when `rsiEligible`), numbers `1.2-2` plus currency, `—` for null (`instrument-history.html`).
- `GET /api/instruments/:ticker/history` reads `price_history` (last 44 rows, `LOOKBACK_DAYS`), computes RSI over chronological closes with `calculateRSISeries`, and returns the last 30 (`src/worker/routes/instruments.ts:41-71`).
- `market_data` (price/rsi per ticker) has no close date, so it cannot feed a "date of last close" column. `price_history` is the source.
- Filtering pattern to copy: `InstrumentPicker` with two-way `ticker` and `type` models (`''` = all) plus a pure helper in `src/app/features/alerts/alert-filter.ts` where the ticker wins over the type; the alert list sorts with signals and header buttons (`alert-list.ts`).
- Workers Free allows 50 subrequests per invocation including D1, so the dashboard cannot loop one query per instrument.

## Desired End State

- Logging in (or registering) lands on `/` showing the "Pulpit" page: the welcome card and a table with one row per instrument: Instrument (name + ticker), Date, Close, High, Low, RSI (RSI shows `—` for instruments without RSI), each number with the instrument's currency.
- An instrument with no price history yet still appears, with `—` in every data column.
- A filter bar (type + instrument picker, "Clear filters" when active) narrows the table; a "no match" message shows when the filters exclude everything. Column headers sort the table; the default order is alphabetical by instrument name.
- Menu order: Dashboard, Alerts, History group, Admin group. `/alerts` shows the alerts list and the "New alert" FAB (no welcome card).
- Verified by: `npm run test:ci`, `npm run test:worker`, `npm run lint`, `npm run build`, and the Playwright suite.

### Key Discoveries:

- The RSI for the dashboard must equal the newest row of the history endpoint, so both use one shared server-side helper (`src/worker/routes/instruments.ts:11-15,58-68` hold the constants and logic today).
- A single D1 query with `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC)` fetches the last 44 closes of all instruments at once (about 20 instruments x 44 rows), well inside the subrequest budget.
- E2E specs assume the alerts list lives at `/` (`alerts-filter.spec.ts:64`, `delete-alert.spec.ts:34`, `seed.spec.ts:32`, `auth-gate-redirect.spec.ts:64`, and the "Twoje alerty" heading in `admin-gate-redirect.spec.ts:38`).
- Translations are hand-edited in `src/locale/messages.pl.xlf` only; never run `extract-i18n`.

## What We're NOT Doing

- No row click / navigation to the history page.
- No new filters beyond the existing type + instrument picker (no alert-type filter, no text search of the table).
- No pagination, no auto-refresh; data changes once a day via cron.
- No change to Instrument history, the alerts API, the cron, or the database schema (no migration).
- No sorting persistence across visits.

## Implementation Approach

Three phases. Phase 1 adds the bulk endpoint on the worker with a shared history/RSI helper. Phase 2 builds the page and switches routing and menu together, so the app is coherent after the phase. Phase 3 repairs the e2e specs that assumed alerts at `/`, adds a Dashboard e2e spec and updates the README.

## Phase 1: Latest-close endpoint

### Overview

A new authenticated endpoint returns one entry per instrument with its latest close, high, low and RSI.

### Changes Required:

#### 1. Shared history helper

**File**: `src/worker/lib/price-history.ts` (new), `src/worker/routes/instruments.ts`

**Intent**: Move `HISTORY_DAYS`, `RSI_PERIOD`, `LOOKBACK_DAYS` and the "newest-first rows → chronological entries with RSI → last N" logic out of the history route so the history endpoint and the new endpoint compute identical RSI values. The history endpoint's behaviour and response stay unchanged.

**Contract**: a function taking newest-first rows `{date, close, high, low}[]` and `rsiEligible`, returning chronological `{date, close, high, low, rsi}[]` windowed to `HISTORY_DAYS`. Existing history tests must keep passing untouched.

#### 2. Bulk endpoint

**File**: `src/worker/routes/instruments.ts`

**Intent**: `GET /api/instruments/latest` (behind the existing `sessionMiddleware`). Two D1 reads (instruments; window-function query over `price_history` limited to `LOOKBACK_DAYS` rows per ticker), grouped per ticker in memory, last history entry taken. Instruments without price rows get `null` data fields. Register the route so it does not collide with `/:ticker/history` (different segment count, so no clash, but keep it above the parameterised route for readability).

**Contract**: response is an array of
`{ ticker, name, type, currency, rsiEligible, date: string|null, close: number|null, high: number|null, low: number|null, rsi: number|null }`. `rsi` is `null` when `rsiEligible` is false or fewer than 15 closes exist. Order is not guaranteed (the client sorts). 401 without a session.

### Success Criteria:

#### Automated Verification:

- Worker tests pass, including new cases (unauthenticated 401; one row per instrument with the newest date; instrument with no prices returns nulls; RSI-ineligible instrument returns `rsi: null`; `rsi` equals the newest `rsi` of `/:ticker/history` for the same data): `npm run test:worker`
- Existing history endpoint tests still pass unchanged: `npm run test:worker`
- Linting passes: `npm run lint`
- Type check / build passes: `npm run build`

#### Manual Verification:

- With the local worker running, `GET /api/instruments/latest` (logged in) returns the seeded instruments with plausible latest values.

**Implementation Note**: After this phase and all automated checks pass, pause for manual confirmation before proceeding.

---

## Phase 2: Dashboard page, routing and menu

### Overview

The Dashboard page, with filters and sorting, becomes the landing page; alerts move to `/alerts`; the menu is updated.

### Changes Required:

#### 1. Data service and filter helper

**File**: `src/app/features/dashboard/dashboard.service.ts`, `src/app/features/dashboard/dashboard-filter.ts` (new)

**Intent**: A root service with `getLatest()` for the new endpoint (with an exported `LatestInstrument` interface mirroring the response contract). A pure `filterLatest(rows, {type, ticker})` where a chosen ticker takes precedence over the type, mirroring `alert-filter.ts`.

**Contract**: `filterLatest(rows: LatestInstrument[], filters: { type: string; ticker: string }): LatestInstrument[]`; `''` means no filter.

#### 2. Dashboard component

**File**: `src/app/features/dashboard/dashboard.{ts,html,scss}` (new)

**Intent**: Standalone component with the welcome card (moved from Home, i18n ids renamed to `dashboard.*`), a filter bar (`InstrumentPicker` bound to `filterTicker` / `filterType`, "Clear filters" button when a filter is active), and a `mat-table` inside an outlined `mat-card` with columns instrument, date, close, high, low, rsi. Instrument cell shows the name with the ticker as secondary text. Header cells are buttons that toggle sort (signals, same approach as `alert-list.ts`), default sort is instrument name ascending, null values sort last in both directions. Numbers use `number: '1.2-2'` plus the row's own currency; `—` for null date/close/high/low/rsi. States: load error message, empty catalogue message, "no instruments match the selected filters" message. Styles follow `instrument-history.scss` (page width, header colours, right-aligned numeric cells).

**Contract**: selector `app-dashboard`, loads data in the constructor via `DashboardService.getLatest()` and `InstrumentsService.ensureLoaded()` (picker catalogue; its failure must not break the table).

#### 3. Routing and Home

**File**: `src/app/app.routes.ts`, `src/app/features/home/home.{ts,html,scss}`

**Intent**: `''` → `Dashboard`, new `alerts` → `Home`. Home drops the welcome card (and the now-unused `AuthService`, `MatCardModule`); it keeps the alerts section and the FAB. The `**` redirect and login/register redirects need no change.

**Contract**: routes `'' → Dashboard`, `'alerts' → Home`; `/history`, `/history/triggers`, admin routes untouched.

#### 4. Menu

**File**: `src/app/core/shell/shell.html`

**Intent**: Add "Dashboard" as the first link (`routerLink="/"`, exact match, icon `dashboard`) and point the Alerts link to `/alerts` (active-link styling by default, no `exact` needed).

#### 5. Translations

**File**: `src/locale/messages.pl.xlf`

**Intent**: Hand-edit: rename the two welcome-card units to `dashboard.*`, add `shell.nav.dashboard` ("Pulpit"), and add units for the page title ("Pulpit"), column headers, filter "Clear filters" ("Wyczyść filtry"), load-error, empty-catalogue and no-match messages. Keep ids in sync with the templates; do not run `extract-i18n`.

#### 6. Unit tests

**File**: `src/app/features/dashboard/dashboard-filter.spec.ts`, `src/app/features/dashboard/dashboard.spec.ts` (new)

**Intent**: Filter helper: no filter, by type, by ticker, ticker over type. Component (Testing Library, `settle()` helper like `alert-list.spec.ts`): renders one row per instrument, instrument with no data shows dashes, RSI dash for ineligible instrument, filter by instrument narrows rows, "Clear filters" restores, no-match message, default alphabetical order and header-click sort, load error message.

### Success Criteria:

#### Automated Verification:

- Component and helper tests pass: `npm run test:ci`
- Linting passes: `npm run lint`
- Production build passes (also validates the translation file): `npm run build`

#### Manual Verification:

- Logging in lands on the Pulpit page; the menu shows Pulpit first and Alerty second, each highlighted correctly.
- The table shows one row per instrument with the same values as the newest row on the Instrument history page (incl. RSI).
- Type / instrument filters, "Wyczyść filtry", "no match" message and column sorting behave as described.
- `/alerts` shows the alerts list with the "Nowy alert" button; the welcome card appears only on Pulpit.

**Implementation Note**: After this phase and all automated checks pass, pause for manual confirmation before proceeding.

---

## Phase 3: E2E and documentation

### Overview

Existing e2e specs that assumed the alerts list at `/` are repointed, a Dashboard e2e is added and the README is updated.

### Changes Required:

#### 1. Existing e2e specs

**File**: `e2e/alerts-filter.spec.ts`, `e2e/delete-alert.spec.ts`, `e2e/seed.spec.ts`, `e2e/auth-gate-redirect.spec.ts`, `e2e/admin-gate-redirect.spec.ts`

**Intent**: Visit `/alerts` wherever a spec needs the alerts list or the "Nowy alert" button. In `auth-gate-redirect`, add `/alerts` to the protected routes and make the mid-session test use `/alerts`. In `admin-gate-redirect`, the redirect still lands on `/`, so assert the Pulpit heading instead of "Twoje alerty". `auth.setup.ts` (`waitForURL('/')`) should keep working unchanged.

#### 2. Dashboard e2e

**File**: `e2e/dashboard.spec.ts` (new)

**Intent**: With the authenticated storage state: opening `/` shows the "Pulpit" heading and a row for NASDAQ-100; filtering by instrument (picker scoped by role/name) narrows the table and "Wyczyść filtry" restores it; the "Alerty" menu link opens `/alerts` with the alerts heading. `getByRole`/`getByText` locators only, no fixed waits.

#### 3. README

**File**: `README.md`

**Intent**: Add a short description of the Dashboard page and the `/alerts` route where the README describes the app's pages/features.

### Success Criteria:

#### Automated Verification:

- Full e2e suite passes (sandbox disabled for wrangler): `npx playwright test`
- Unit and worker tests still pass: `npm run test:ci`, `npm run test:worker`
- Linting passes: `npm run lint`

#### Manual Verification:

- README reads correctly and matches the real routes.

---

## Testing Strategy

### Unit Tests:

- Worker: new endpoint cases listed in Phase 1, including RSI parity with the history endpoint.
- Angular: filter helper and Dashboard component (Phase 2).

### Integration Tests:

- Playwright: Dashboard e2e plus repointed alert specs (Phase 3).

### Manual Testing Steps:

1. Log in, confirm the landing page is Pulpit and compare a row with the same instrument on Instrument history.
2. Filter by type, by instrument and by both; clear filters; click each column header twice.
3. Open Alerty from the menu, create and delete an alert; confirm the FAB is only there.
4. Reload on `/alerts` and on `/`; visit an unknown URL and confirm it falls back to Pulpit.

## Performance Considerations

One window-function query returns at most 44 rows per instrument (about 20 instruments, roughly 900 rows) plus one instruments query, so two D1 subrequests per page load, far from the Workers Free limit. RSI calculation for about 20 series is cheap.

## Migration Notes

No schema change. Bookmarks to `/` that used to show alerts now show the Pulpit; alerts are reachable at `/alerts`.

## References

- GitHub issue: #167
- Similar implementation: `src/app/features/instrument-history/instrument-history.html`, `src/app/features/alerts/alert-filter.ts`, `src/app/features/alerts/alert-list/alert-list.ts`
- History endpoint: `src/worker/routes/instruments.ts:41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Latest-close endpoint

#### Automated

- [x] 1.1 Worker tests pass, including new latest-endpoint cases
- [x] 1.2 Existing history endpoint tests still pass unchanged
- [x] 1.3 Linting passes
- [x] 1.4 Build passes

#### Manual

- [ ] 1.5 Local `GET /api/instruments/latest` returns plausible latest values for the seeded instruments

### Phase 2: Dashboard page, routing and menu

#### Automated

- [ ] 2.1 Component and filter-helper tests pass
- [ ] 2.2 Linting passes
- [ ] 2.3 Production build passes (translations valid)

#### Manual

- [ ] 2.4 Login lands on Pulpit; menu order and highlighting are correct
- [ ] 2.5 Table rows match the newest row of Instrument history (incl. RSI)
- [ ] 2.6 Filters, clear, no-match message and sorting behave as described
- [ ] 2.7 `/alerts` shows alerts and the "Nowy alert" button; welcome card only on Pulpit

### Phase 3: E2E and documentation

#### Automated

- [ ] 3.1 Full Playwright suite passes
- [ ] 3.2 Unit and worker tests still pass
- [ ] 3.3 Linting passes

#### Manual

- [ ] 3.4 README matches the real routes and pages
