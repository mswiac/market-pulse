# F-04: GPW Equity Support via Yahoo (.WA Suffix) — Implementation Plan

## Overview

F-04 was scoped on the roadmap as "Stooq provider support" — a second market-data fetch path for `instruments.provider = 'stooq'` rows (today only `pl_stock`/GPW equities, addable via S-10 but with zero working data fetch). During planning, live testing showed Stooq's CSV download endpoint (`stooq.pl` / `stooq.com` `/q/d/l/`) is now gated by a client-side JS proof-of-work anti-bot challenge — a plain `fetch()` (curl, or a Cloudflare Worker) cannot pass it without re-implementing that challenge-response flow, and it's unverified whether the block is JS-only or also IP-reputation-based against Workers' egress IPs.

Live testing also showed Yahoo Finance's existing chart API — already used for `^VIX`/`^NDX`/`us_stock` — already covers GPW equities via a `.WA` ticker suffix (e.g. `CDR.WA`), with the same JSON shape already parsed. This plan implements F-04 by extending the Yahoo path instead of building a Stooq path: `instruments` gains a `suffix` column (admin-set, defaulting per type), the fetch layer builds the Yahoo query symbol as `ticker + suffix` while every persisted/displayed value stays the bare `ticker`, and `instruments.currency` self-corrects against what Yahoo reports on every fetch.

## Current State Analysis

- `fetchDailyCloses` (`src/worker/lib/market-data.ts:40`) already accepts any Yahoo-compatible symbol and returns `close`/`high`/`low` — reused unchanged in shape; only its return contract grows to also carry currency (see Critical Implementation Details).
- `deriveProvider` (`src/worker/routes/admin.ts:108-112`) routes `pl_stock` → `'stooq'`; the cron (`src/worker/scheduled.ts:39-41`) only selects instruments `WHERE provider = 'yahoo'`. Together, any `pl_stock` row created via S-10 is inert today — creatable, never fetched.
- `migrations/0014_instrument_registry_extended_types.sql:24,26` — the `type` CHECK already includes `pl_stock`/`us_stock`; `provider` has never had a CHECK constraint (plain `TEXT NOT NULL`), so no constraint migration is needed to simplify it to always `'yahoo'`.
- `instruments.currency` (`migrations/0010_instrument_currency.sql`) is a pure display field today — the only downstream reader is `alert-evaluation.ts`, which interpolates it into alert-email text, never into a calculation or comparison. Safe to auto-correct without touching alert logic.
- Confirmed live (2026-08-09): Stooq's `/q/d/l/` endpoint returns a JS proof-of-work challenge page (SHA-256 nonce search, POST to `/__verify`, then reload) instead of raw CSV, for both `stooq.pl` and `stooq.com`, across multiple URL param variants including the exact format a prior Java/Spring implementation of this same fetch used successfully in the past.
- Confirmed live (2026-08-09): `query1.finance.yahoo.com/v8/finance/chart/CDR.WA` (same endpoint/shape `fetchDailyCloses` already parses) returns valid data — `meta.currency: "PLN"`, `meta.exchangeName: "WSE"`, populated `close`/`high`/`low` series.

## Desired End State

An admin can add a GPW-listed equity (`type = 'pl_stock'`) via the add-instrument form using a plain ticker (e.g. `CDR`, exactly as it appears everywhere else in the app) plus a `suffix` field that defaults to `.WA` for that type and can be freely overridden or cleared. The daily cron and the admin market-data backfill both fetch that instrument from Yahoo using `ticker + suffix` as the query symbol, while every persisted row (`price_history`, `market_data`) and every displayed value (alerts, instrument details, history) uses the bare `ticker`. `instruments.currency` is corrected automatically (and the correction logged) whenever a fetch's reported currency disagrees with the stored value.

Verify by: adding a real GPW ticker through the admin panel, running an admin backfill for a short date range, and confirming `price_history` rows land under the bare ticker with plausible values and `instruments.currency` reflects `PLN`.

### Key Discoveries:

- `src/worker/lib/market-data.ts:15-27` (`YahooChartResult`/`YahooChartResponse`) never parses `chart.result[0].meta` today — currency parsing is new, not a refactor of existing logic.
- `src/worker/routes/admin.ts:135-137` — ticker normalization (`trim().toUpperCase()`) is generic across all types; no per-type ticker format validation exists anywhere, and this plan doesn't add any (admin is trusted, same as today).
- `src/worker/routes/instruments.ts:19-39` (`GET /api/instruments`, public) never selects `provider` — the same precedent applies to `suffix`: it's a fetch-mechanism internal, not exposed on this endpoint.
- `test/worker/scheduled.test.ts:182-185` manually recreates the `instruments` table (for a "registry query fails" test) with a literal `CREATE TABLE` statement independent of the real migrations — this must gain the `suffix` column too, or that one test's schema silently drifts from production.

## What We're NOT Doing

- Not building a Stooq fetch path or a JS proof-of-work solver.
- Not building dynamic/admin-editable instrument categories (browsing + adding new `type` values like a hypothetical "Spółka DE") — raised during planning, explicitly parked as a separate future roadmap item; captured in the Phase 3 roadmap update.
- Not adding ticker-format validation/regex for any instrument type.
- Not exposing `suffix` via the public `GET /api/instruments` endpoint.
- Not changing `index`/`us_stock` fetch behavior beyond removing the now-dead `provider` filter — their fetches are functionally unaffected (`suffix` stays `''`).
- Not adding a currency-conversion/FX layer — `currency` remains a display-only field; only its *value* now self-corrects, no arithmetic ever reads it.

## Implementation Approach

Keep the fetch layer itself provider-agnostic and dumb: it always calls Yahoo, and the only per-instrument variable is the query symbol, computed as `ticker + suffix`. All the "which suffix" intelligence lives at instrument-creation time (admin form + `POST /api/admin/instruments`), not in the fetch/cron code — so `scheduled.ts` and the admin backfill route both stay a simple `SELECT ... , suffix, currency ...` plus string concatenation, with no branching on `type`. This also means a future non-GPW suffix (e.g. a German exchange) needs zero code changes — just a different value in the admin form's suffix textbox.

## Critical Implementation Details

**`fetchDailyCloses` return contract changes.** Today it resolves to `DailyClose[]`; it must resolve to `{ closes: DailyClose[]; currency: string | null }` so callers can run the currency-correction check without a second network round-trip (Yahoo's chart response already includes `meta.currency` in the same payload that carries the closes). This is a breaking signature change — every caller (`scheduled.ts`, `admin.ts`'s `/market-data` route) and roughly ten existing assertions in `test/worker/market-data.test.ts` that currently do `expect(result).toEqual([...])` must be updated to `expect(result.closes).toEqual([...])`. Extract `currency` from `body.chart?.result?.[0]?.meta?.currency`, defaulting to `null` if absent — never throw solely because `meta`/`meta.currency` is missing (unlike a missing/malformed close series, a missing currency shouldn't fail the whole fetch).

**Ticker vs. provider-symbol split.** `ticker + suffix` (e.g. `CDR.WA`) must be used *only* as the argument to `fetchDailyCloses`. Every database write — `upsertPriceHistory`, the `market_data` upsert in `scheduled.ts`, the currency-correction `UPDATE instruments` — must use the bare `ticker`. Getting this backwards would silently start writing `price_history` rows keyed on `CDR.WA` instead of `CDR`, breaking the join with `alerts`/`market_data` (both keyed on the admin-entered ticker) without any error surfacing.

## Phase 1: Schema + instrument creation

### Overview

Adds the `suffix` column, wires it through instrument creation (backend validation + insert, frontend form field with a per-type default suggestion), and collapses `deriveProvider` to a single always-`'yahoo'` value now that Stooq is out of scope.

### Changes Required:

#### 1. Migration

**File**: `migrations/0015_instruments_suffix.sql`

**Intent**: Add the column that lets an admin (not the server) declare what to append to a ticker before querying Yahoo, per instrument.

**Contract**: `ALTER TABLE instruments ADD COLUMN suffix TEXT NOT NULL DEFAULT ''`. A plain `ADD COLUMN` with a constant default — no shadow-table rebuild needed (that technique is only required for `CHECK`/`DROP COLUMN` changes, per `migrations/0014_instrument_registry_extended_types.sql`'s own comment). Existing `^VIX`/`^NDX` rows get `suffix = ''`, which is correct — their ticker is already the exact Yahoo symbol.

#### 2. Shared instrument row type

**File**: `src/worker/lib/instruments.ts`

**Intent**: Extend the shared row shape so `suffix` is available wherever `InstrumentRow` is used.

**Contract**: Add `suffix: string` to the `InstrumentRow` interface, alongside the existing `ticker`/`rsi_eligible`/`currency` fields.

#### 3. Admin instrument-creation route

**File**: `src/worker/routes/admin.ts`

**Intent**: Accept an explicit, optional `suffix` field on `POST /api/admin/instruments` instead of deriving it server-side from `type`; simplify provider derivation now that only Yahoo is used.

**Contract**: `parseInstrumentBody` gains `suffix?: unknown`. Validate as an optional string: `typeof body.suffix === 'string' ? body.suffix.trim() : ''` — no format restriction (consistent with the existing "admin is trusted" ticker contract), empty string is valid for any type. Replace `deriveProvider(type)`'s `type === 'pl_stock' ? 'stooq' : 'yahoo'` body with a hardcoded `'yahoo'` (or remove the function and inline the literal at the insert call site — either is fine, just delete the now-false comment above it referencing Stooq/F-04). `InsertedInstrumentRow` gains `suffix: string`; the `INSERT ... RETURNING` statement's column list and `.bind(...)` args both gain `suffix` in the same position, mirroring how `currency` is already threaded through.

#### 4. Admin panel service (frontend)

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Thread `suffix` through the HTTP call the same way every other admin-set field is threaded.

**Contract**: `CreatedInstrument` gains `suffix: string`. `addInstrument(...)` gains a `suffix: string` parameter and includes it in the POST body, in the same position pattern as `currency`.

#### 5. Add-instrument form

**File**: `src/app/features/admin/add-instrument/add-instrument.ts`

**Intent**: Give the admin a visible, editable suffix field, pre-filled with a sensible per-type suggestion so the common case (GPW stock) needs no typing, while an unanticipated future case (e.g. a German listing) is just a different typed value — no code change required later.

**Contract**: New `suffix` signal (default `''`). `onTypeChange(type)` additionally sets `suffix` to a per-type default suggestion — `'.WA'` when `type === 'pl_stock'`, `''` otherwise — this only fires on type *change*, so it won't fight the admin if they've already edited the field for the currently-selected type. New `onSuffixChange` handler mirroring `onTickerChange`. `onSubmit` passes `this.suffix().trim()` to `adminService.addInstrument(...)`. `resetForm` resets `suffix` to `''`.

#### 6. Add-instrument template

**File**: `src/app/features/admin/add-instrument/add-instrument.html`

**Intent**: Render the new field next to Ticker, with a Polish label per the UI-string convention.

**Contract**: A `mat-form-field`/`input` pair bound to `suffix()`/`onSuffixChange`, placed in the same `.filters` row as the Ticker field (or its own row — implementer's call based on layout). Label text in Polish (e.g. `Sufiks` with a short hint like `np. .WA`), added via `$localize`/`i18n` the same way every other label in this template is.

#### 7. Existing admin test update

**File**: `test/worker/admin.test.ts`

**Intent**: The pl_stock creation test currently asserts the now-obsolete `provider: 'stooq'` behavior.

**Contract**: In the test at lines 302-317 (`'creates a pl_stock instrument with provider derived as stooq...'`), change the expected `provider` to `'yahoo'` and update the test's own description. Add `suffix` to the request body and to both response assertions (the `POST /api/admin/instruments` result and the `GET /api/instruments` — note `GET /api/instruments` must NOT include `suffix`, per Key Discoveries, so only the creation-response assertion gains it). Add a new case confirming an omitted `suffix` defaults to `''` and is accepted for `index`/`us_stock` types.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run migrate:local`
- Type checking passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker`

#### Manual Verification:

- In the admin panel's "Add instrument" form, selecting "Spółki PL" pre-fills the new Sufiks field with `.WA`; the field is editable and can be cleared.
- Adding an `index` or `us_stock` instrument still works exactly as before (suffix stays empty, no visible change to that flow).

---

## Phase 2: Fetch layer + currency reconciliation

### Overview

Makes the cron and the admin backfill route actually use `suffix` to build the Yahoo query symbol, while writing every DB row under the bare `ticker`; adds currency parsing to the Yahoo fetch and a self-correcting reconciliation step on every successful fetch.

### Changes Required:

#### 1. Yahoo fetch — currency parsing + return contract

**File**: `src/worker/lib/market-data.ts`

**Intent**: Expose the currency Yahoo reports for an instrument (already present in the same response `fetchDailyCloses` parses) so callers can reconcile it against the stored value, without a second HTTP round-trip.

**Contract**: `YahooChartResult` gains `meta?: { currency?: string }`. `fetchDailyCloses`'s return type changes from `Promise<DailyClose[]>` to `Promise<{ closes: DailyClose[]; currency: string | null }>`; extract `body.chart?.result?.[0]?.meta?.currency ?? null` and return it alongside the existing `dailyCloses` array. A missing/absent `meta.currency` resolves to `null`, never throws — only the existing close-series failure modes (bad shape, non-ascending timestamps, zero valid closes) should still throw `MarketDataFetchError`.

Add a small reconciliation helper, e.g.:

```ts
export function buildCurrencyCorrection(
  db: D1Database,
  ticker: string,
  storedCurrency: string,
  fetchedCurrency: string | null,
): D1PreparedStatement | null {
  if (!fetchedCurrency || fetchedCurrency === storedCurrency) return null;
  return db.prepare('UPDATE instruments SET currency = ? WHERE ticker = ?').bind(fetchedCurrency, ticker);
}
```

Pure statement-building (no `db.batch()` call), matching `upsertPriceHistory`'s existing style — callers push the returned statement into their own batch when non-null, and log the correction themselves (they have the context — cron vs. admin backfill — to log meaningfully).

#### 2. Cron

**File**: `src/worker/scheduled.ts`

**Intent**: Fetch every instrument through Yahoo using its `ticker + suffix` as the query symbol, write all rows under the bare `ticker`, and reconcile currency — while dropping the now-meaningless `provider` filter.

**Contract**: `SELECT ticker, rsi_eligible, suffix, currency FROM instruments` (drop `WHERE provider = 'yahoo'` — every row is fetched now). `fetchWithRetry`'s return type follows `fetchDailyCloses`'s new shape; call it with `ticker + suffix` as the symbol, then use `.closes` for RSI/latest-price/`upsertPriceHistory` (all keyed on bare `ticker`, unchanged) and `.currency` for `buildCurrencyCorrection(env.DB, ticker, currency, result.currency)`, pushing a non-null result into the same `statements` batch. Log a correction the same way existing failures are logged here (`console.error('market-data-pipeline: ...')` — use `console.log` with the same prefix convention, since a correction isn't a failure).

#### 3. Admin backfill route

**File**: `src/worker/routes/admin.ts` (`POST /market-data`)

**Intent**: Same `ticker + suffix` / bare-`ticker` / currency-reconciliation logic as the cron, for the manual backfill path.

**Contract**: The instrument lookup query (`admin.ts:59`) grows from `SELECT ticker FROM instruments WHERE ticker = ?` to `SELECT ticker, suffix, currency FROM instruments WHERE ticker = ?`. Call `fetchDailyCloses(ticker + suffix, fromIso, toIso)`; use `.closes` for the existing `daysWritten`/`upsertPriceHistory` logic (bare `ticker`); add the `buildCurrencyCorrection` statement to the same `c.env.DB.batch(...)` call when non-null, logged similarly (`console.log('admin-market-data: ...')` or matching whatever convention Phase 2.2 lands on — keep the two call sites' logging consistent).

#### 4. Existing market-data tests

**File**: `test/worker/market-data.test.ts`

**Intent**: Update for the new return shape; add coverage for currency parsing and `buildCurrencyCorrection`.

**Contract**: Every existing `expect(result).toEqual([...])` becomes `expect(result.closes).toEqual([...])`. Add cases: currency parsed correctly from `meta.currency`; currency resolves to `null` when `meta` or `meta.currency` is absent (without throwing); `buildCurrencyCorrection` returns `null` when currencies match or `fetchedCurrency` is `null`, and returns a correctly-bound `UPDATE` statement on mismatch.

#### 5. Existing scheduled tests

**File**: `test/worker/scheduled.test.ts`

**Intent**: Keep the manually-recreated schema (lines 182-185) in sync with the real migration; add coverage for the suffix/bare-ticker split and currency correction in the cron path.

**Contract**: The `CREATE TABLE instruments (...)` literal at lines 183-184 gains `suffix TEXT NOT NULL DEFAULT ''` in its column list (matching migration 0015), and its `INSERT` for `^VIX`/`^NDX` should supply `suffix = ''` explicitly or rely on the default — either is fine since both are `''`. Add a new test seeding a `pl_stock`-style instrument with a non-empty `suffix` (e.g. ticker `TEST`, suffix `.WA`): assert the mocked `fetch` was called with a URL containing the encoded `TEST.WA`, while `price_history`/`market_data` rows are written under `TEST` (not `TEST.WA`). Add a currency-mismatch case: seed `instruments.currency` different from the mocked response's `meta.currency`, run the cron, assert `instruments.currency` was updated to match.

#### 6. Existing admin backfill tests

**File**: `test/worker/admin.test.ts`

**Intent**: Same coverage as scheduled.test.ts, for the manual backfill path.

**Contract**: Add a case: an instrument with a non-empty `suffix` gets fetched via `ticker + suffix` (assert on the mocked `fetch` call's URL) while `price_history` is written under the bare ticker. Add a currency-correction case mirroring the cron one, asserting `instruments.currency` is updated after the backfill call.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Worker unit tests pass: `npm run test:worker`
- Full CI passes: `npm run ci`

#### Manual Verification:

- Add a real GPW ticker (e.g. `CDR`, type "Spółki PL", suffix pre-filled `.WA`) via the admin panel; run an admin backfill for a short recent date range; confirm `price_history` rows exist under ticker `CDR` (not `CDR.WA`) with plausible close/high/low values.
- If the admin-entered currency for that instrument doesn't match what Yahoo reports (e.g. entered `USD` for a PLN-denominated GPW stock), confirm `instruments.currency` is corrected to `PLN` after the backfill and a correction is visible in `wrangler tail`/console logs.

---

## Phase 3: Documentation

### Overview

Brings `context/foundation/roadmap.md`'s F-04 entry in line with what was actually built, and records the parked "dynamic instrument categories" idea raised (and deliberately deferred) during this planning session.

### Changes Required:

#### 1. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: F-04's outcome, prerequisites-derived reasoning, and risk section currently describe a Stooq fetch path that this plan does not build — readers of the roadmap after this ships should see the real design (Yahoo `.WA` suffix, admin-set `suffix` column) and the reason for the pivot (Stooq's anti-bot challenge), plus a pointer to the parked dynamic-categories idea so it isn't lost.

**Contract**: Rewrite the `### F-04` section (currently lines 125-138) — title, outcome, and risk — to describe the `.WA`-suffix approach and the deliberate, scoped deviation from the "ticker = exact provider value" principle established for `index`/`us_stock`. Update the "At a glance" table row (line 45) and Stream C description (line 56) if their wording still implies a literal Stooq fetch. Add a new line under the `## Parked` section (or a new roadmap backlog row, whichever fits the doc's existing convention better) for "Dynamic instrument categories (browse + add new `type` values in the admin panel, e.g. for non-GPW/non-US markets)" with a one-line note that it surfaced during F-04 planning.

### Success Criteria:

#### Manual Verification:

- `context/foundation/roadmap.md`'s F-04 section describes the Yahoo `.WA` approach (no remaining claim that this ships a Stooq fetch path).
- The dynamic-categories idea is captured somewhere in the roadmap (Parked section or backlog) so it isn't lost.

---

## Testing Strategy

### Unit Tests:

- `fetchDailyCloses` currency parsing (present, absent, malformed `meta`).
- `buildCurrencyCorrection` — match, mismatch, `null` fetched currency.
- `deriveProvider`/insert path always yields `'yahoo'` regardless of `type`.
- `suffix` accepted, trimmed, defaults to `''` when omitted, on `POST /api/admin/instruments`.

### Integration Tests:

- Cron (`scheduled.ts`) end-to-end for a `suffix`-bearing instrument: correct fetch symbol, correct write-back ticker, correct currency correction.
- Admin backfill (`POST /market-data`) end-to-end, same three assertions.

### Manual Testing Steps:

1. Add a GPW instrument via the admin panel (type "Spółki PL", ticker `CDR`), confirm the suffix field pre-fills `.WA`.
2. Run an admin backfill for that instrument over a short recent range.
3. Confirm `price_history` rows exist under `CDR`, with plausible values, and `instruments.currency` is `PLN`.
4. Confirm the existing `index`/`us_stock` flows (creation and fetch) are unaffected.

## Performance Considerations

None beyond what already exists — no additional network round-trips (currency comes from the same Yahoo response already fetched), no new per-instrument work beyond a string concatenation and an optional single-row `UPDATE`.

## Migration Notes

`migrations/0015_instruments_suffix.sql` is a simple `ADD COLUMN ... DEFAULT ''` — safe to apply to both local and remote D1 with no data backfill beyond the column default, and no risk to existing `^VIX`/`^NDX` rows or any `pl_stock`/`us_stock` rows already created via S-10 (their `suffix` becomes `''`, same as today's inert/no-suffix behavior, until an admin edits them — out of scope here, no edit UI exists yet).

## References

- Roadmap: `context/foundation/roadmap.md` (F-04 section, lines 125-138 pre-update)
- Prior related work: `context/archive/2026-08-09-admin-add-instrument/` (S-10 — `deriveProvider`, ticker-format contract precedent)
- Prior related work: `context/archive/2026-07-24-market-data-pipeline/` (F-02 — why Stooq was originally dropped for VIX)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + instrument creation

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run migrate:local` — b70b6db
- [x] 1.2 Type checking passes: `npm run typecheck` — b70b6db
- [x] 1.3 Worker unit tests pass: `npm run test:worker` — b70b6db

#### Manual

- [x] 1.4 Selecting "Spółki PL" pre-fills the Sufiks field with `.WA`; field is editable/clearable
- [x] 1.5 Adding an `index`/`us_stock` instrument still works unchanged

### Phase 2: Fetch layer + currency reconciliation

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 0619532
- [x] 2.2 Worker unit tests pass: `npm run test:worker` — 0619532
- [x] 2.3 Full CI passes: `npm run ci` — 0619532

#### Manual

- [x] 2.4 Real GPW ticker added + backfilled; `price_history` rows land under the bare ticker with plausible values
- [x] 2.5 Currency auto-corrected (and logged) when admin-entered value disagrees with Yahoo's reported currency

### Phase 3: Documentation

#### Manual

- [x] 3.1 `roadmap.md` F-04 section describes the Yahoo `.WA` approach, not a Stooq fetch path
- [ ] 3.2 Dynamic-categories idea captured in the roadmap (Parked or backlog) — skipped per user (2026-08-09): manual/hardcoded category additions likely to remain the approach, dynamic categories deprioritized
