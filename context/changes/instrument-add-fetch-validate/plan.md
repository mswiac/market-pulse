# Fetch and Validate Market Data When an Instrument Is Added — Implementation Plan

## Overview

Adding an instrument (`POST /api/admin/instruments`) becomes one atomic
"fetch, validate, seed" step: about 300 calendar days of daily closes are
fetched from Yahoo, the instrument row, its `price_history` and its
`market_data` (with the converged RSI) are written in a single `DB.batch()`,
and the add is rejected when Yahoo does not know the symbol. A provider
outage is reported as such, never as a bad ticker, and a currency that
disagrees with Yahoo is corrected to Yahoo's value and reported to the admin.
GitHub issue #213; builds on #211 (one RSI definition everywhere).

## Current State Analysis

From the frame brief (`frame.md`, confidence HIGH):

- The add endpoint only inserts a row (`src/worker/routes/admin.ts:224-233`).
  A typo surfaces at the first cron/alert, or never (the cron only fetches
  instruments that have an alert). A new instrument has no `price_history` /
  `market_data`.
- Every Yahoo failure is the same `MarketDataFetchError`, told apart only by
  message text (`src/worker/lib/market-data.ts:8-13, 65-124`). A network error
  or timeout is not wrapped at all. Real Yahoo answers an unknown symbol with
  HTTP 404 + `chart.error.code = "Not Found"`; the only test models it as
  HTTP 200 (`test/worker/market-data.test.ts:79-84`).
- No foreign keys on `price_history` / `market_data`; `DB.batch()` is the
  established atomic idiom (`market-refresh.ts:196-210`, `admin.ts:273-278`).
  The RSI-eligibility trigger (`migrations/0014:51-62`) aborts a batch that
  writes a non-null `rsi` for an instrument with `rsi_eligible = 0`.
- `refreshInstruments` cannot be reused for creation: no instrument INSERT,
  fixed 30-day window, errors swallowed into `status:'error'`, empty closes
  reported as `ok` (`market-refresh.ts:119-214`).
- The RSI input is defined once, in `price-history.ts` (`RSI_INPUT_SESSIONS`
  = 180, stored-row floor `RSI_INPUT_MAX_AGE_DAYS` = 300). The refresh path
  repeats the sort/truncate step inline (`market-refresh.ts:169-177`).
- Currency policy today: Yahoo always wins, silently, in the cron and the
  backfill (`market-data.ts:130-149`). The user confirmed Yahoo stays the
  source of truth.
- Add form: unknown error codes fall back to a generic message; there is a
  `submitting` signal but no progress text (`add-instrument.ts:35-48,
  112-133`). Strings are `$localize` with Polish in `src/locale/messages.pl.xlf`.
- E2E run against a real local worker (`wrangler dev --local`) that calls
  Yahoo itself, so fabricated `E2E…` tickers would be rejected.

## Desired End State

- Adding a real instrument stores about 200 sessions of history and a
  `market_data` row whose RSI equals what the history endpoints show for the
  same ticker, immediately, with no cron run needed.
- Adding an unknown symbol returns 422 `instrument_symbol_not_found` and
  writes nothing.
- A Yahoo outage or timeout returns 502 `instrument_provider_unavailable` and
  writes nothing; the admin retries.
- A currency different from Yahoo's is stored as Yahoo's, and the 201 response
  and the snackbar say so.
- The add form shows "Checking data…" on the button while the request runs.
- E2E keep working through a worker flag that skips validation, set only in
  CI and in the developer's local worker vars.

### Key Discoveries:

- Yahoo not-found is HTTP 404 with `chart.error.code = "Not Found"`
  (probed live), not HTTP 200.
- `to` must be tomorrow's date, otherwise today's close is excluded
  (`market-refresh.ts:65-71`).
- Production instruments already hold at least 179 stored closes (#211 plan),
  so seeding matters only for newly added instruments.
- A 200-row seed is 13 price statements + 1 market statement + 1 instrument
  insert in one batch; `ROWS_PER_STATEMENT = 16` keeps each under D1's
  100-parameter cap.

## What We're NOT Doing

- The admin "fetch market data" form and `POST /api/admin/market-data`: a
  separate component and code path; left unchanged.
- The 30-day Yahoo window of the cron thin-history rule and of
  `ensureFreshMarketData` (alert create/edit).
- Treating "fewer than 15 sessions" as an error: such an instrument is added
  with RSI `null`.
- Not retrying a not-found in the cron's `fetchWithRetry` (existing behavior).
- A DB-level guard: direct SQL inserts still bypass validation ("admin is
  trusted").
- Changing alert, cron or evaluation logic.

## Implementation Approach

Three phases, each independently shippable: (1) the fetch layer learns to
tell failure kinds apart; (2) a dedicated seed path and the endpoint use it,
with one shared RSI helper so there is still one definition; (3) the form
shows the new states and CI/e2e are adapted. No migration.

## Critical Implementation Details

- **State sequencing** — the instrument INSERT must be the first statement in
  the batch (the RSI-eligibility trigger looks up `instruments`), and `rsi`
  must be `null` for `rsiEligible = false`. The duplicate-ticker check runs
  before the Yahoo call so a duplicate costs no subrequest; the batch still
  maps a `UNIQUE` error to 409 for the concurrent-create race.
- **Timing & lifecycle** — e2e never calls Yahoo and there is no validation
  skip switch: the add-instrument spec mocks the endpoint response in the
  browser, and the remove-instrument spec mocks its list, impact and delete calls.

## Phase 1: Fetch layer tells failure kinds apart

### Overview

Make "Yahoo does not know this symbol" distinguishable from "Yahoo is
unavailable", without changing what the cron and the backfill do today.

### Changes Required:

#### 1. Failure kind on the fetch error

**File**: `src/worker/lib/market-data.ts`

**Intent**: Give `MarketDataFetchError` a `kind` so callers can branch on it,
and make every failure of `fetchDailyCloses` carry one, including network
errors and timeouts that currently escape unwrapped.

**Contract**: `MarketDataFetchError.kind: 'not_found' | 'provider'` (default
`'provider'`). `not_found`: HTTP 404, any response whose
`chart.error.code === 'Not Found'`, and the "contained no valid closes" case.
`provider`: other non-OK statuses (429, 5xx), bad JSON, unexpected shape,
non-ascending timestamps, and a rejected `fetch()` (network error, abort or
timeout), which is now wrapped in `MarketDataFetchError`. Messages stay as
they are, so existing message-based tests keep passing. A successful empty
series still returns `{ closes: [] }`.

#### 2. Tests

**File**: `test/worker/market-data.test.ts`

**Intent**: Cover the real Yahoo shape and the new kinds.

**Contract**: add cases for HTTP 404 with the `Not Found` body (kind
`not_found`), `chart.error` with 200 (`not_found`), 5xx and 429 (`provider`),
a rejected fetch and an aborted signal (`provider`), and all-null closes
(`not_found`). Existing assertions stay valid.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- New failure-kind tests cover 404, chart error, 5xx, 429, network error, abort and all-null closes

#### Manual Verification:

- Cron and backfill behavior is unchanged (existing `scheduled` and `admin` tests still pass without edits)

**Implementation Note**: After this phase's automated checks pass, pause for confirmation before Phase 2.

---

## Phase 2: Seed path and endpoint

### Overview

Add the atomic fetch-validate-seed step to `POST /api/admin/instruments`,
keeping one RSI definition and one currency rule.

### Changes Required:

#### 1. One RSI helper and one currency rule

**Files**: `src/worker/lib/price-history.ts`, `src/worker/lib/market-refresh.ts`, `src/worker/lib/market-data.ts`

**Intent**: Extract the "merge, sort, truncate to the newest `RSI_INPUT_SESSIONS`, `latestRsi`" step out of `refreshInstruments`, and the "is Yahoo's currency valid and different" rule out of `buildCurrencyCorrection`, so the new seed path reuses them instead of copying.

**Contract**: `rsiFromCloses(closesByDate: Map<string, number>): number | null` exported from `price-history.ts` and used by `refreshInstruments` (behavior unchanged); `RSI_INPUT_MAX_AGE_DAYS` exported. `resolveCurrency(entered: string, fetched: string | null): string` in `market-data.ts` returns the fetched code when it is a valid 3-letter code, else the entered one; `buildCurrencyCorrection` uses it.

#### 2. Seed function

**File**: `src/worker/lib/instrument-seed.ts` (new)

**Intent**: Fetch about 300 days for a not-yet-stored instrument, compute its RSI and build the single batch that creates it.

**Contract**: `seedInstrument(env, input)` returns a discriminated result: `{ ok: true, instrument, currencyCorrectedFrom: string | null }`, `{ ok: false, reason: 'symbol_not_found' }` (`not_found` kind or an empty series) or `{ ok: false, reason: 'provider_unavailable' }` (`provider` kind). Single fetch attempt, `SEED_TIMEOUT_MS = 6000` (a slower Yahoo must not hold the admin request; same idea as `REFRESH_TIMEOUT_MS`), window `from = today − RSI_INPUT_MAX_AGE_DAYS`, `to = tomorrow`. Batch order: `INSERT instruments` (with the resolved currency) first, then `buildPriceHistoryUpserts`, then `buildMarketDataUpserts` (price/high/low from the last close, `rsi` from `rsiFromCloses` or `null` when not RSI-eligible). A mismatch is logged like the cron does.

#### 3. Endpoint

**File**: `src/worker/routes/admin.ts`

**Intent**: Use the seed function after the existing body validation and a duplicate pre-check, and map outcomes to responses.

**Contract**: duplicate ticker -> 409 `instrument_duplicate_ticker` before any Yahoo call (batch `UNIQUE` error still maps to 409). `symbol_not_found` -> 422 `instrument_symbol_not_found`; `provider_unavailable` -> 502 `instrument_provider_unavailable`. 201 body is the existing instrument shape plus `currencyCorrectedFrom: string | null`.

#### 4. Tests

**Files**: `test/worker/admin.test.ts`, `test/worker/price-history.test.ts` (or `scheduled.test.ts` for parity)

**Intent**: Cover the new path and adapt the existing add tests.

**Contract**: the success-path add tests (trim, suffix, pl/us stock, lowercase, rsiEligible false, duplicate, plus dependent impact/delete blocks) get a stubbed Yahoo `fetch` using the file's existing `jsonResponse`/`yahooBody` helpers. New cases: rows written (about 200 `price_history`, one `market_data`), RSI equals `buildHistory`'s newest RSI for the same ticker, RSI `null` for `rsiEligible: false`, currency corrected (response field + stored value), invalid Yahoo currency ignored, 404 -> 422 with nothing written, 5xx and network error -> 502 with nothing written, empty series -> 422, duplicate -> 409 without a Yahoo call, skip flag -> plain insert without a fetch, fewer than 15 sessions -> 201 with `rsi` null.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The RSI stored at creation equals the history endpoint's newest RSI for the same ticker (parity test)
- A rejected or failed add leaves no rows in `instruments`, `price_history` or `market_data`

#### Manual Verification:

- Locally, adding a real ticker stores about 200 history rows and the same RSI on the dashboard and the instrument history page
- Locally, adding a made-up symbol is rejected and nothing is stored

**Implementation Note**: After this phase's automated checks pass, pause for confirmation before Phase 3.

---

## Phase 3: Form states, e2e and docs

### Overview

Show the new outcomes in the add form and keep e2e independent of live Yahoo.

### Changes Required:

#### 1. Service type and form messages

**Files**: `src/app/features/admin/admin-panel.service.ts`, `src/app/features/admin/add-instrument/add-instrument.ts`, `add-instrument.html`

**Intent**: Surface the new error codes, the currency correction and the waiting state.

**Contract**: `CreatedInstrument.currencyCorrectedFrom: string | null`. `ERROR_MESSAGES` gains `instrument_symbol_not_found` and `instrument_provider_unavailable` (`$localize` with `@@addInstrument.error.*` ids). `showResult` appends a "currency corrected from X to Y (reported by Yahoo)" sentence when `currencyCorrectedFrom` is set. The submit button shows "Checking data…" while `submitting()` is true (new `@@addInstrument.submitting` id).

#### 2. Translations

**Files**: `src/locale/messages.xlf`, `src/locale/messages.pl.xlf`

**Intent**: Keep the Polish bundle complete for the new strings.

**Contract**: run `npm run extract-i18n`, then add Polish targets for the new ids.

#### 3. Frontend specs

**File**: `src/app/features/admin/add-instrument/add-instrument.spec.ts` (existing)

**Intent**: Cover the new messages and the correction notice.

**Contract**: update the existing spec for the two new codes, the corrected-currency snackbar and the submitting label. No new spec files are created.

#### 4. E2E and docs

**Files**: `.github/workflows/e2e.yml`, `README.md` (e2e / local worker section), `context/foundation/test-plan.md` only if it lists e2e prerequisites

**Intent**: Keep e2e independent of Yahoo without any production switch, and document how.

**Contract**: `e2e/admin/add-instrument.spec.ts` mocks `POST /api/admin/instruments` with `page.route` and asserts the request payload and each outcome message (success, currency correction, 422, 502, in-flight button). `e2e/admin/remove-instrument.spec.ts` mocks the instrument list, the impact preview and the DELETE with a small stateful stub (seeding the local D1 from a second process raced the Worker with `SQLITE_BUSY`, so it was dropped). README and test-plan describe this. No worker flag, no CI or local vars change.

### Success Criteria:

#### Automated Verification:

- Angular tests pass: `npm run test:ci`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- i18n extraction is clean and `messages.pl.xlf` has a target for every new id: `npm run extract-i18n`
- Admin e2e pass locally: `npx playwright test --project=chromium-admin`

#### Manual Verification:

- The add form shows "Checking data…" on the button while a real add is running
- An unknown symbol shows the not-found message and a simulated Yahoo outage shows the retry message
- Adding a PL stock with the wrong currency shows the corrected-currency notice and stores Yahoo's currency
- After `npm run deploy`, adding a real instrument in production seeds history and RSI (no migration needed)

---

## Testing Strategy

### Unit Tests:

- Fetch failure kinds (Phase 1); RSI parity with the history endpoint, currency resolution, atomicity of the create batch, all endpoint outcomes (Phase 2); form messages (Phase 3).

### Integration Tests:

- Worker route tests with a stubbed Yahoo `fetch` against the test D1; e2e mock the add and remove calls in the browser, so they never depend on live Yahoo.

### Manual Testing Steps:

1. Start both dev servers, add a real ticker (for example `AAPL`) and compare its RSI on the dashboard and history page.
2. Add `ZZZZNOPE9`: expect the not-found message and no row.
3. Add a PL stock with a wrong currency: expect the correction notice.

## Performance Considerations

One Yahoo fetch (about 200 points) plus one batch of about 15 statements per add: far inside the Workers Free 50-subrequest limit. CPU is one JSON parse and one RSI over at most 180 closes, small next to the existing 730-day backfill. Re-measure CPU in Observability after deploy; `SEED_TIMEOUT_MS` bounds wall-clock time.

## Migration Notes

No migration. Existing instruments are untouched; the skip flag is absent in production, so validation is on there by default.

## References

- Frame: `context/changes/instrument-add-fetch-validate/frame.md`
- Issue: #213; related #211 (`context/archive/2026-10-17-rsi-single-calculation/plan.md`)
- Similar write idiom: `src/worker/lib/market-refresh.ts:196-210`; backfill route `src/worker/routes/admin.ts:40-103`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fetch layer tells failure kinds apart

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker` — c660ad4
- [x] 1.2 Type checking passes: `npm run typecheck` — c660ad4
- [x] 1.3 Linting passes: `npm run lint` — c660ad4
- [x] 1.4 New failure-kind tests cover 404, chart error, 5xx, 429, network error, abort and all-null closes — c660ad4

#### Manual

- [x] 1.5 Cron and backfill behavior is unchanged (existing `scheduled` and `admin` tests still pass without edits)

### Phase 2: Seed path and endpoint

#### Automated

- [x] 2.1 Worker tests pass: `npm run test:worker` — 655f185
- [x] 2.2 Type checking passes: `npm run typecheck` — 655f185
- [x] 2.3 Linting passes: `npm run lint` — 655f185
- [x] 2.4 The RSI stored at creation equals the history endpoint's newest RSI for the same ticker (parity test) — 655f185
- [x] 2.5 A rejected or failed add leaves no rows in `instruments`, `price_history` or `market_data` — 655f185

#### Manual

- [x] 2.6 Locally, adding a real ticker stores about 200 history rows and the same RSI on the dashboard and the instrument history page
- [x] 2.7 Locally, adding a made-up symbol is rejected and nothing is stored

### Phase 3: Form states, e2e and docs

#### Automated

- [x] 3.1 Angular tests pass: `npm run test:ci` — ad77a81
- [x] 3.2 Type checking passes: `npm run typecheck` — ad77a81
- [x] 3.3 Linting passes: `npm run lint` — ad77a81
- [x] 3.4 i18n extraction is clean and `messages.pl.xlf` has a target for every new id: `npm run extract-i18n` — ad77a81
- [x] 3.5 Admin e2e pass locally: `npx playwright test --project=chromium-admin`

#### Manual

- [x] 3.6 The add form shows "Checking data…" on the button while a real add is running
- [x] 3.7 An unknown symbol shows the not-found message and a simulated Yahoo outage shows the retry message
- [x] 3.8 Adding a PL stock with the wrong currency shows the corrected-currency notice and stores Yahoo's currency
- [ ] 3.9 After `npm run deploy`, adding a real instrument in production seeds history and RSI (no migration needed)
