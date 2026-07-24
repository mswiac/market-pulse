# Market Data Pipeline (F-02) Implementation Plan

## Overview

Add a daily Cloudflare Cron Trigger that fetches VIX and NASDAQ-100 daily closes, stores them in D1, and computes RSI(14) for NASDAQ-100. This is the foundation slice that S-04 (market-data-display) and S-05 (alert-notifications) build on — no UI or notification changes happen in this change.

## Current State Analysis

- No `scheduled()` export exists in the Worker; `wrangler.toml` has no `[triggers]` block. F-01's plan explicitly deferred both to F-02 (`context/archive/2026-06-26-backend-scaffold/plan.md:35`).
- No outbound `fetch()` to any third-party host exists anywhere in `src/` — this is the first.
- No `price_history` or `market_data` tables exist; they are only referenced as planned names in `context/foundation/roadmap.md:93`.
- The `alerts` table (`migrations/0005_create_alerts.sql`) already encodes `instrument` as `'VIX' | 'NASDAQ100'` and enforces "no RSI for VIX" via app validation (`src/worker/routes/alerts.ts:6-7,85-87`) and a DB `CHECK` constraint — this change reuses the same two instrument codes and the same CHECK-constraint pattern for consistency.
- D1 access is ad hoc (`c.env.DB.prepare(...)` per call site) — no query-builder/ORM, no shared DB helper module. This change follows the same style.
- Migrations are numbered, forward-only, one logical table per file (`migrations/0001`–`0005`). Next available number is `0006`.
- Tests run via `vitest` + `@cloudflare/vitest-pool-workers` (`vitest.config.mts`), which auto-applies all `migrations/*.sql` before each test run (`test/setup/apply-migrations.ts`). Existing tests call `exports.default.fetch(...)` directly against the Hono app (`test/worker/auth.test.ts:1,14-19`); a `scheduled()` export is testable the same way via `exports.default.scheduled(...)`.
- `package.json` has no date/technical-indicator library — RSI must be hand-written.

## Desired End State

After this change:
- Every weekday at 23:00 UTC, the Worker's `scheduled()` handler fetches the last ~30 calendar days of daily closes for VIX and NASDAQ-100 from Yahoo Finance, upserts them into `price_history`, computes RSI(14) for NASDAQ-100, and upserts the latest price/RSI into `market_data`.
- `price_history` retains every close ever fetched (no deletion) — safe indefinitely at this data volume (see Performance Considerations).
- `market_data` holds exactly one row per instrument, always reflecting the latest known price/RSI.
- A failure fetching one instrument does not prevent the other instrument's data from being written.
- Verification: `wrangler d1 execute marketpulse-db --local --command "SELECT * FROM market_data"` (or `--remote` after deploy) shows both instruments with a recent `updated_at` after a cron run.

### Key Discoveries:

- Yahoo's chart API (`https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1mo&interval=1d`) returns both `^VIX` and `^NDX` from one endpoint, no API key, verified live during planning. Stooq and CBOE were both ruled out: Stooq has no VIX download; CBOE's free CSV only covers CBOE-computed indices (`NDX_History.csv` returns `403 Forbidden`, verified live) — Yahoo is the only source that covers both instruments from one place.
- `close[]` entries can be `null` for an in-progress trading day and must be filtered; `timestamp[]` marks the *start* of the trading session (13:30 UTC ≈ market open), not midnight — only the date portion matters; `meta.regularMarketPrice` must never be used as "the close" (it's a live intraday price, not the settled daily close).
- Workers' CPU-time billing excludes `fetch()` await time — only synchronous parsing/computation counts. RSI(14) over a ~20-row window and CSV/JSON parsing of a small payload are both sub-millisecond; the free tier's ~10ms CPU budget is not at risk here (unlike PBKDF2, which is CPU-bound per iteration — see `[[project_workers_pbkdf2_cap]]` memory).
- At 5 GB D1 free-tier storage and even a future 142-instrument scenario (140 GPW stocks + VIX + NASDAQ-100), `price_history` grows ~7.8 MB/year — over 600 years of headroom. No retention/cleanup logic is needed now or foreseeably.

## What We're NOT Doing

- No alert evaluation or email sending (S-05).
- No UI changes to display market data (S-04) — this change only writes to D1.
- No `trigger_events` table (S-05).
- No historical RSI storage or charting support — RSI is a pure function of `price_history`, so a future chart feature can recompute it from stored closes rather than needing a time-series `market_data` table today.
- No retention/deletion logic for `price_history` — confirmed safe indefinitely at this data volume.
- No dedicated `pipeline_runs`/observability table — failures are logged via `console.error` (visible in `wrangler tail`), matching the codebase's existing simplicity.
- No support for instruments beyond VIX/NASDAQ-100 (PRD non-goal).
- No one-time historical backfill script — the standing ~30-day rolling fetch window is self-healing after any gap (missed cron run, deploy downtime) without extra code.

## Implementation Approach

Two new, independently-testable library modules (`lib/market-data.ts` for fetch+validation, `lib/rsi.ts` for pure RSI computation) feed a thin orchestration handler (`scheduled.ts`) that Wires into the existing Hono Worker's default export. Each instrument is fetched and written independently so a transient failure on one doesn't block the other. No new Workers Secrets are needed — Yahoo's endpoint requires no API key.

## Critical Implementation Details

**Yahoo response gotchas**: the outbound `fetch()` should set an explicit `User-Agent` header — Yahoo's unofficial endpoint is more likely to reject default/generic Workers `fetch()` headers than a browser-like one. `close[]` entries must be filtered for `null` before use (in-progress trading day), and only the *date* portion of `timestamp[]` matters (it marks session start, not midnight).

**Per-instrument failure isolation**: VIX and NASDAQ-100 must be fetched and written as two independent units of work inside the same `scheduled()` invocation — catch errors per instrument, not around the whole handler — so a Yahoo hiccup on one symbol doesn't silently also drop the other.

## Phase 1: D1 Schema — `price_history` and `market_data`

### Overview

Add the two new tables via forward-only migrations, following the existing numbered, one-table-per-file convention.

### Changes Required:

#### 1. `price_history` table

**File**: `migrations/0006_create_price_history.sql`

**Intent**: Store every fetched daily close, keyed by instrument + date, kept forever (no retention logic — see Key Discoveries).

**Contract**:
```sql
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (instrument, date)
);
CREATE INDEX idx_price_history_instrument_date ON price_history(instrument, date);
```
`date` is an ISO `YYYY-MM-DD` string (date only, no time). The `UNIQUE (instrument, date)` constraint is what makes the daily upsert idempotent across re-runs and the rolling ~30-day re-fetch window.

#### 2. `market_data` table

**File**: `migrations/0007_create_market_data.sql`

**Intent**: Cache the latest known price/RSI per instrument for fast reads by S-04/S-05. Exactly two rows ever exist.

**Contract**:
```sql
CREATE TABLE market_data (
  instrument TEXT PRIMARY KEY,
  price REAL NOT NULL,
  rsi REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (NOT (instrument = 'VIX' AND rsi IS NOT NULL))
);
```
`instrument` is the primary key (no surrogate `id`) since upserts always target a known instrument code. The `CHECK` mirrors the existing "no RSI for VIX" backstop pattern already used in `migrations/0005_create_alerts.sql:11`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npm run migrate:local`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- `wrangler d1 execute marketpulse-db --local --command "SELECT sql FROM sqlite_master WHERE name IN ('price_history','market_data')"` shows the expected columns and constraints (note: `.schema` is a `sqlite3` CLI dot-command, not valid SQL — `wrangler d1 execute --command` rejects it with `near ".": syntax error`; querying `sqlite_master` directly is the working equivalent)

---

## Phase 2: Yahoo Fetch & Validation Layer

### Overview

A library module that fetches daily closes for one instrument from Yahoo, validates the response shape, and returns a clean, ordered array of `{ date, close }` — or throws a typed error the caller can retry against.

### Changes Required:

#### 1. Fetch + validation module

**File**: `src/worker/lib/market-data.ts`

**Intent**: Encapsulate the Yahoo chart API call, response validation, and null-filtering so the orchestration layer (Phase 4) never touches raw Yahoo JSON shape.

**Contract**:
- `export const YAHOO_SYMBOLS: Record<'VIX' | 'NASDAQ100', string> = { VIX: '^VIX', NASDAQ100: '^NDX' }`
- `export interface DailyClose { date: string; close: number }` — `date` is `YYYY-MM-DD`, ascending order (oldest first), matching Yahoo's native ordering.
- `export class MarketDataFetchError extends Error {}` — thrown for HTTP errors, non-2xx responses, `chart.error !== null`, missing/mismatched `timestamp`/`close` arrays, or zero valid (non-null) closes after filtering.
- `export async function fetchDailyCloses(symbol: string): Promise<DailyClose[]>` — calls `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d` with an explicit `User-Agent` header, validates the shape described above, filters `null` closes, converts each `timestamp[i]` to its UTC date (`YYYY-MM-DD`) paired with `close[i]`, and returns the array. Throws `MarketDataFetchError` on any validation failure (treated identically to a network/HTTP failure by the caller).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:worker` — covering: valid response → correct `DailyClose[]`; HTTP error status → `MarketDataFetchError`; `chart.error` non-null → `MarketDataFetchError`; trailing `null` in `close[]` → filtered out, no throw; empty/malformed body → `MarketDataFetchError`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- None — pure module, no live network call needed for verification (covered by mocked unit tests)

---

## Phase 3: RSI Calculation

### Overview

A pure, dependency-free function computing Wilder's RSI(14), independently unit-testable against hand-computed reference values.

### Changes Required:

#### 1. RSI module

**File**: `src/worker/lib/rsi.ts`

**Intent**: Implement Wilder's smoothing RSI so threshold evaluation (this change writes it; S-05 will later read it) uses a well-understood, testable formula rather than a black-box third-party value.

**Contract**:
- `export function calculateRSI(closes: number[], period = 14): number | null`
- Input: `closes` ordered oldest → newest (caller's responsibility — `fetchDailyCloses` already returns this order).
- Returns `null` if `closes.length < period + 1` (not enough data to seed the first average gain/loss).
- Otherwise: seed average gain/loss as the simple mean of the first `period` day-over-day changes, then apply Wilder's smoothing (`avg = (prevAvg * (period - 1) + current) / period`) for each subsequent change; return `100 - (100 / (1 + avgGain / avgLoss))` (with the standard `avgLoss === 0 → 100` edge case).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:worker` — asserting against a fixed series of closes matched to a hand-computed (or independently-sourced) Wilder's RSI reference value, per `context/foundation/test-plan.md:59`'s explicit warning against a tautological test; plus edge cases: fewer than 15 closes → `null`, `avgLoss === 0` → `100`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- None — pure function, fully covered by unit tests

---

## Phase 4: Cron Orchestration & Wrangler Config

### Overview

Wire the fetch and RSI modules into a `scheduled()` handler, register the Cron Trigger, and upsert results into D1 with per-instrument retry and failure isolation.

### Changes Required:

#### 1. Cron Trigger registration

**File**: `wrangler.toml`

**Intent**: Register the daily schedule.

**Contract**: add
```toml
[triggers]
crons = ["0 23 * * 1-5"]
```
23:00 UTC, Monday–Friday — comfortably after NASDAQ/VIX close (20:00–21:00 UTC depending on DST), giving Yahoo time to finalize the day's official close.

#### 2. Scheduled handler

**File**: `src/worker/scheduled.ts`

**Intent**: Orchestrate fetch → validate → upsert `price_history` → compute RSI (NASDAQ-100 only) → upsert `market_data`, per instrument, with retry and failure isolation.

**Contract**:
- `export async function handleScheduled(env: Env): Promise<void>`
- For each of `VIX`, `NASDAQ100` independently (a failure on one must not affect the other — see Critical Implementation Details):
  - Call `fetchDailyCloses` with up to 3 total attempts (1 initial + 2 retries, short fixed delay ~300ms between attempts) via a small retry wrapper. Before relying on this worst-case timing (up to 6 fetches + delays + real network latency across both instruments in one invocation), spot-check current Cloudflare docs for scheduled-Worker invocation duration limits — Workers' CPU-time exemption for `fetch()` await time (see Key Discoveries) is a CPU-time fact, not necessarily a wall-clock/duration one.
  - On persistent failure: `console.error` with the instrument and error, skip to the next instrument.
  - On success: compute RSI for `NASDAQ100` only via `calculateRSI(closes.map(c => c.close))` (VIX's `market_data.rsi` stays `null`, satisfying the table's `CHECK` constraint), then write everything for this instrument in a **single `env.DB.batch([...])` call** — one prepared `INSERT INTO price_history (instrument, date, close) VALUES (?,?,?) ON CONFLICT (instrument, date) DO UPDATE SET close = excluded.close` statement per returned `{date, close}`, plus one `INSERT INTO market_data (instrument, price, rsi, updated_at) VALUES (?,?,?,unixepoch()) ON CONFLICT (instrument) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, updated_at = excluded.updated_at` statement (using the most recent/last close as `price`), all passed to the same `batch()` array. `batch()` runs them as one round-trip in an implicit transaction — this instrument's rows land atomically (all or nothing) instead of via ~20-30 sequential awaited calls. This is the first use of `env.DB.batch()` in the codebase (no prior precedent either way — existing routes are single-row); worth a quick check during implementation that the statement count comfortably fits within D1's batch limits.

#### 3. Wire into Worker default export

**File**: `src/worker/index.ts`

**Intent**: Expose the `scheduled()` handler alongside the existing `fetch()` export.

**Contract**: change `export default { fetch: app.fetch };` (`src/worker/index.ts:24`) to also export `scheduled: (event, env, ctx) => handleScheduled(env)`, importing `handleScheduled` from `./scheduled`. No changes to the `Env` interface — no new secrets are required.

### Success Criteria:

#### Automated Verification:

- Unit/integration tests pass: `npm run test:worker` — a `scheduled()` test (via `exports.default.scheduled(...)`, mocking `fetch` for both symbols) asserting: both `price_history` and `market_data` rows exist after a run; a mocked failure on one instrument still leaves the other instrument's rows written; re-running with an overlapping date window doesn't create duplicate `price_history` rows (UNIQUE constraint + upsert)
- Type checking passes: `npm run typecheck`
- Migrations still apply cleanly and existing test suite (`auth.test.ts`, `alerts.test.ts`, `password.test.ts`, `smoke.test.ts`) still passes: `npm run test:worker`

#### Manual Verification:

- `wrangler dev --local --test-scheduled`, then trigger via `curl "http://localhost:8787/cdn-cgi/handler/scheduled"`, then `wrangler d1 execute marketpulse-db --local --command "SELECT * FROM market_data"` shows both instruments with real, current values
- After deploy: `wrangler d1 migrations apply marketpulse-db --remote` (per `[[project_d1_migrations_not_auto_applied]]` — not automatic on `npm run deploy`), then wait for or manually verify the next scheduled run, then `wrangler d1 execute marketpulse-db --remote --command "SELECT * FROM market_data"` confirms real production data. Note: Cron Trigger schedule changes can take up to 15 minutes to propagate after deploy (`context/foundation/infrastructure.md`) — don't treat a missed first run as a broken pipeline.

---

## Testing Strategy

### Unit Tests:

- `market-data.ts`: valid Yahoo response parsing, HTTP error, `chart.error` non-null, malformed/missing arrays, `null` close filtering — all via mocked `fetch` (`vi.stubGlobal('fetch', ...)`, no new dependency, per the decision to avoid adding MSW for a single external endpoint).
- `rsi.ts`: known-input/known-output reference case (not asserted against the implementation's own output — `context/foundation/test-plan.md:59`), insufficient-history edge case, zero-average-loss edge case.

### Integration Tests:

- `scheduled()` end-to-end via `exports.default.scheduled(...)` with mocked Yahoo responses for both symbols — covers the full fetch → upsert → RSI → upsert chain against the real (migrated) D1 test database.
- Per-instrument failure isolation: mock a failure for one symbol only, assert the other instrument's `price_history`/`market_data` rows still land.

### Manual Testing Steps:

1. `wrangler dev --local --test-scheduled`, trigger the scheduled event locally, inspect D1 via `wrangler d1 execute --local`.
2. Deploy, apply remote migrations, confirm the Cron Trigger fires on schedule (Cloudflare dashboard → Workers → Triggers, or wait for the next 23:00 UTC weekday run), then inspect remote D1.

## Performance Considerations

- CPU: Workers' CPU-time billing excludes `fetch()` await time; RSI computation and JSON parsing for ~20-30 rows × 2 instruments is sub-millisecond. The free-tier ~10ms CPU budget (tight for PBKDF2-style crypto work, per `[[project_workers_pbkdf2_cap]]`) is not a constraint for this pipeline.
- Storage: `price_history` grows ~7.8 MB/year even at a future 142-instrument scale — far under the 5 GB D1 free-tier storage limit.
- D1 writes: ~2 instruments × (~20-30 `price_history` upserts + 1 `market_data` upsert) per run ≈ 60 writes/day, against a 100,000/day free-tier limit.

## Migration Notes

Both migrations are pure `CREATE TABLE` — no existing data to migrate, no shadow-table pattern needed (that pattern is only required for destructive `ALTER`s, per `migrations/0002`/`0004`). Remember: per `[[project_d1_migrations_not_auto_applied]]`, `npm run deploy` does not apply D1 migrations — `wrangler d1 migrations apply marketpulse-db --remote` must be run separately after deploying this change.

## References

- Roadmap entry: `context/foundation/roadmap.md:91-103` (F-02)
- Prior slice this depends on: `context/archive/2026-06-26-backend-scaffold/` (F-01)
- `alerts` table CHECK-constraint precedent: `migrations/0005_create_alerts.sql:11`
- Existing scheduled-handler test pattern precedent: `test/worker/auth.test.ts:1,14-19`
- Test plan RSI/Stooq-validation risk register: `context/foundation/test-plan.md:46-59`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: D1 Schema — `price_history` and `market_data`

#### Automated

- [x] 1.1 Migrations apply cleanly: `npm run migrate:local` — 8c12176
- [x] 1.2 Type checking passes: `npm run typecheck` — 8c12176

#### Manual

- [x] 1.3 `.schema price_history` and `.schema market_data` show expected columns and constraints — 8c12176

### Phase 2: Yahoo Fetch & Validation Layer

#### Automated

- [x] 2.1 Unit tests pass: `npm run test:worker` — 93db0e3
- [x] 2.2 Type checking passes: `npm run typecheck` — 93db0e3

### Phase 3: RSI Calculation

#### Automated

- [x] 3.1 Unit tests pass: `npm run test:worker` — e17b120
- [x] 3.2 Type checking passes: `npm run typecheck` — e17b120

### Phase 4: Cron Orchestration & Wrangler Config

#### Automated

- [x] 4.1 Unit/integration tests pass: `npm run test:worker` — 7171b82
- [x] 4.2 Type checking passes: `npm run typecheck` — 7171b82
- [x] 4.3 Full existing test suite still passes: `npm run test:worker` — 7171b82

#### Manual

- [x] 4.4 Local `wrangler dev --local --test-scheduled` run produces correct D1 rows
- [x] 4.5 Post-deploy: remote migrations applied, remote D1 shows real production data after a scheduled run
