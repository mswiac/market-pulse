# F-03: Instrument Registry Implementation Plan

## Overview

Replace the hardcoded `VIX`/`NASDAQ100` instrument lists scattered across the backend (`YAHOO_SYMBOLS` in `market-data.ts`, `VALID_INSTRUMENTS`/`VALID_ALERT_TYPES` in `alerts.ts`) with a single `instruments` registry table. The `ticker` column is both the DB join key and the literal symbol sent to Yahoo Finance (`^VIX`, `^NDX`) — there is no separate internal-code/provider-symbol split. This is the prerequisite for S-04 (instrument-aware alert form) and S-07 (30-day history view), and eventually for adding GPW companies without further hardcoding.

## Current State Analysis

- `alerts`, `price_history`, and `market_data` all key on an `instrument` TEXT column storing the literal strings `'VIX'` / `'NASDAQ100'` (`migrations/0005_create_alerts.sql`, `0006_create_price_history.sql`, `0007_create_market_data.sql`).
- `alerts` and `market_data` each have a literal-based `CHECK` constraint hardcoding `'VIX'` to block RSI alerts/values for that instrument.
- `src/worker/lib/market-data.ts` hardcodes `YAHOO_SYMBOLS: Record<'VIX' | 'NASDAQ100', string>` mapping the internal code to the Yahoo symbol; `src/worker/scheduled.ts` iterates this map.
- `src/worker/routes/alerts.ts` hardcodes `VALID_INSTRUMENTS = ['VIX', 'NASDAQ100']` and checks `instrument === 'VIX'` directly to reject RSI alerts.
- The frontend (`alert-form.html/.ts`, `alert-list.ts`) also hardcodes `'VIX'`/`'NASDAQ100'` as the wire values — **this plan does not touch the frontend** (see What We're NOT Doing); the alert form will not work against the new ticker values until S-04 ships.
- Worker tests run via `vitest` + `@cloudflare/vitest-pool-workers` (`vitest.config.mts`), which applies all migrations fresh before each test run — this harness can exercise the migration's *resulting schema* but cannot exercise the *data-rewrite* behavior on pre-existing rows (there's nothing to rewrite in a fresh DB). Confirmed with the user: verify the rewrite manually against local D1, not via an automated migration test.
- `test/worker/alerts.test.ts` has a test (`'DB CHECK constraint rejects VIX+RSI on a direct insert'`) that inserts directly via raw SQL and asserts the DB `CHECK` rejects it — this test must be deleted, not updated, since the constraint it verifies is being removed.

## Desired End State

- An `instruments` table exists: `ticker` (PK, TEXT — e.g. `^VIX`), `name` (TEXT), `type` (TEXT, `CHECK (type IN ('index'))`), `rsi_eligible` (INTEGER 0/1), `provider` (TEXT — e.g. `yahoo`). Seeded with `^VIX` and `^NDX`.
- `price_history`, `market_data`, and `alerts` all use a `ticker` column (renamed from `instrument`) storing `^VIX`/`^NDX` instead of `VIX`/`NASDAQ100`. `market_data` and `alerts` no longer have instrument-specific `CHECK` constraints — RSI eligibility is enforced only at the application layer via `instruments.rsi_eligible`.
- `scheduled.ts` and `alerts.ts` read ticker/RSI-eligibility from the `instruments` table instead of hardcoded arrays/maps. `YAHOO_SYMBOLS` is deleted from `market-data.ts`.
- `GET /api/instruments` (session-protected, optional `?type=` filter) returns `[{ ticker, name, type }]`.
- Verify via: `npm run test:worker` passes; a manual local-D1 check confirms legacy-shaped rows (`instrument='VIX'`) get rewritten to `ticker='^VIX'` by the migration.

### Key Discoveries:

- `migrations/0002_users_email_schema.sql` used a shadow-table rebuild (`CREATE new → DROP old → RENAME`) for a `CHECK`/column change, but it did **not** copy data — at that point in the project there was no user data yet. This migration cannot follow that precedent as-is: `alerts` and `market_data` already hold real rows, so their rebuilds must `INSERT INTO new_table SELECT ... FROM old_table` with a `CASE` remap of the ticker value, not just recreate the schema.
- `price_history` has no `CHECK` constraint, so it doesn't need a shadow-table rebuild — a plain `ALTER TABLE price_history RENAME COLUMN instrument TO ticker` plus two `UPDATE` statements suffices. D1's SQLite version supports `RENAME COLUMN` (propagates to the existing index automatically) but not `DROP COLUMN` or modifying `CHECK` constraints in place — hence the rebuild is still required for `alerts` and `market_data`.
- `market-data.ts:fetchDailyCloses(symbol: string)` already takes a plain string — no signature change needed; `scheduled.ts` just needs to pass `ticker` directly instead of looking it up via `YAHOO_SYMBOLS[instrument]`.

## What We're NOT Doing

- Not touching the frontend (`alert-form.html/.ts`, `alert-list.ts`, `alerts.service.ts`) — confirmed with the user that a temporary broken window for alert create/edit in production (until S-04 ships) is acceptable, in exchange for keeping this slice strictly backend/foundation-scoped.
- Not adding the GPW ticker-ingestion endpoint, the WIG20/mWIG40/sWIG80 seed list, or the Mon-Fri 18:00 cron — deferred per the roadmap (F-03's scope is the registry only).
- Not building the S-07 history page or the S-04 alert-form UI changes — those are separate roadmap slices that consume this registry later.
- Not adding a dedicated automated test that exercises the migration's data-rewrite against pre-existing rows — verified manually instead (see Phase 1 Manual Verification).

## Implementation Approach

Two phases, each leaving the app in a working, fully-tested state:

1. **Schema + core refactor** — the migration and the two backend modules that directly depend on it (`alerts.ts`, `scheduled.ts`) must land together, since renaming the DB column breaks both immediately. Existing tests are updated in the same phase so `npm run test:worker` stays green throughout.
2. **New endpoint** — `GET /api/instruments` is net-new code with no coupling to phase 1 beyond reading the now-renamed table; kept separate to isolate its own test file and review surface.

## Critical Implementation Details

**Migration ordering within Phase 1**: `market_data` and `alerts` both reference ticker values that must match exactly what's seeded into `instruments` (`^VIX`, `^NDX`) — the `CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END` remap must be applied identically across `price_history`, `market_data`, and `alerts` in migration `0008_instrument_registry.sql`. A mismatch (e.g. a typo in one of the three `CASE` blocks) silently orphans rows from the registry with no FK to catch it — there is deliberately no `FOREIGN KEY (ticker) REFERENCES instruments(ticker)` in this migration (out of scope; not requested), so this must be checked by hand during the manual verification step.

## Phase 1: Instrument registry schema + core refactor

### Overview

Create the `instruments` table, migrate the three existing tables' `instrument` column to `ticker` with remapped values, drop the two `CHECK` constraints, and update `alerts.ts`/`scheduled.ts`/`market-data.ts` to read from the registry instead of hardcoded arrays/maps.

### Changes Required:

#### 1. New migration

**File**: `migrations/0008_instrument_registry.sql`

**Intent**: Create and seed the `instruments` table; migrate `price_history`, `market_data`, and `alerts` from `instrument` (`'VIX'`/`'NASDAQ100'`) to `ticker` (`'^VIX'`/`'^NDX'`); drop the DB-level RSI `CHECK` constraints on `market_data` and `alerts` (enforcement moves to the application layer).

**Contract**:

```sql
CREATE TABLE instruments (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('index')),
  rsi_eligible INTEGER NOT NULL,
  provider TEXT NOT NULL
);

INSERT INTO instruments (ticker, name, type, rsi_eligible, provider) VALUES
  ('^VIX', 'VIX', 'index', 0, 'yahoo'),
  ('^NDX', 'NASDAQ-100', 'index', 1, 'yahoo');

ALTER TABLE price_history RENAME COLUMN instrument TO ticker;
UPDATE price_history SET ticker = '^VIX' WHERE ticker = 'VIX';
UPDATE price_history SET ticker = '^NDX' WHERE ticker = 'NASDAQ100';

CREATE TABLE market_data_new (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  rsi REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO market_data_new (ticker, price, rsi, updated_at)
  SELECT CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END,
         price, rsi, updated_at
  FROM market_data;
DROP TABLE market_data;
ALTER TABLE market_data_new RENAME TO market_data;

CREATE TABLE alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, ticker, alert_type, threshold)
);
INSERT INTO alerts_new (id, user_id, ticker, alert_type, threshold, notification_email, created_at, updated_at)
  SELECT id, user_id,
         CASE instrument WHEN 'VIX' THEN '^VIX' WHEN 'NASDAQ100' THEN '^NDX' END,
         alert_type, threshold, notification_email, created_at, updated_at
  FROM alerts;
DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
```

#### 2. Alert route refactor

**File**: `src/worker/routes/alerts.ts`

**Intent**: Replace the hardcoded `VALID_INSTRUMENTS` array and the `instrument === 'VIX'` RSI check with a DB lookup against `instruments` (existence + `rsi_eligible`). Rename the `instrument` field to `ticker` throughout — request body field, `ALERT_ROW_COLUMNS` SQL alias, and all bound query parameters.

**Contract**: `normalizeInstrument` becomes an async lookup (`SELECT ticker, rsi_eligible FROM instruments WHERE ticker = ?`) returning the row or `null`; both `POST /` and `PUT /:id` call it and replace the `instrument === 'VIX' && alertType === 'RSI'` guard with `!row.rsi_eligible && alertType === 'RSI'`. The `'CHECK constraint failed'` catch branches for the RSI case are dead code after Phase 1 (the DB constraint no longer exists) and should be removed. Existing error message text (`'invalid instrument'`, `'RSI is not available for VIX'`) stays unchanged — this is a schema/lookup change, not a copy change.

#### 3. Cron refactor

**File**: `src/worker/scheduled.ts`

**Intent**: Iterate instruments from the registry (filtered to `provider = 'yahoo'`, matching today's only provider) instead of `Object.keys(YAHOO_SYMBOLS)`; use `rsi_eligible` instead of the `instrument === 'NASDAQ100'` check to decide whether to compute RSI; write to `price_history`/`market_data` using `ticker` as both the column value and the value bound in place of the old `instrument` parameter.

**Contract**: `handleScheduled` queries `SELECT ticker, rsi_eligible FROM instruments WHERE provider = 'yahoo'` at the top of the function, then loops over the returned rows instead of `YAHOO_SYMBOLS` keys — `fetchWithRetry(ticker)` replaces `fetchWithRetry(YAHOO_SYMBOLS[instrument])` since `ticker` already is the Yahoo symbol. Unlike the static `YAHOO_SYMBOLS` object it replaces, this query can throw (e.g. if the migration hasn't reached remote D1 yet) — wrap it in its own try/catch that logs and returns early, matching the per-instrument logging pattern already used inside the loop, instead of letting it propagate as an unhandled exception out of `handleScheduled`.

#### 4. Dead code removal

**File**: `src/worker/lib/market-data.ts`

**Intent**: Delete the now-unused `YAHOO_SYMBOLS` export (its only caller, `scheduled.ts`, no longer needs it after change #3).

**Contract**: Remove lines 1-4 (the `YAHOO_SYMBOLS` const and its type). No other export in this file changes.

#### 5. Test updates

**File**: `test/worker/alerts.test.ts`

**Intent**: Update all `instrument: 'VIX'` / `instrument: 'NASDAQ100'` literals in request bodies and response assertions to `ticker: '^VIX'` / `ticker: '^NDX'`. Delete the `'DB CHECK constraint rejects VIX+RSI on a direct insert'` test entirely — the constraint it verifies no longer exists at the DB layer (RSI-eligibility enforcement is now application-only, per the F-03 decision).

**File**: `test/worker/scheduled.test.ts`

**Intent**: Update the `MarketDataRow` interface's `instrument` field to `ticker`, and all `'VIX'`/`'NASDAQ100'` literal comparisons to `'^VIX'`/`'^NDX'`. The existing `encodeURIComponent('^VIX')` fetch-mock check (line 87) already uses the new ticker value and needs no change.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run migrate:local`
- Worker unit tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Before applying the migration to a scratch local D1, manually insert legacy-shaped rows (`instrument = 'VIX'` / `'NASDAQ100'`) into `price_history`, `market_data`, and `alerts`; apply `0008_instrument_registry.sql`; confirm every row now has the corresponding `ticker` value (`^VIX`/`^NDX`) and no rows were dropped
- Confirm `market_data` and `alerts` no longer reject a direct `INSERT` with `ticker = '^VIX', alert_type = 'RSI'` at the DB layer (the CHECK is gone) — expected, since enforcement moved to `alerts.ts`
- Confirm the existing (unmodified) frontend now fails to create/edit alerts against local dev (`npm run worker:dev` + `npm start`) — this is the accepted, expected regression until S-04 ships, not a bug to fix here

**Implementation Note**: After this phase's automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: GET /api/instruments endpoint

### Overview

Add a session-protected endpoint that serves the instrument registry to the frontend, consumed later by S-04 and S-07.

### Changes Required:

#### 1. New route

**File**: `src/worker/routes/instruments.ts`

**Intent**: Serve the instrument registry, optionally filtered by type, for later consumption by the alert form (S-04) and history view (S-07).

**Contract**: `GET /` (mounted at `/api/instruments` in `index.ts`) behind `sessionMiddleware`; optional `?type=` query param filters `WHERE type = ?`; response is `[{ ticker, name, type }]` — `rsi_eligible` and `provider` are deliberately omitted (internal routing/validation details, no current consumer needs them client-side).

#### 2. Mount the route

**File**: `src/worker/index.ts`

**Intent**: Wire the new route into the Hono app alongside the existing `alertsRoutes`/`authRoutes` mounts.

**Contract**: `app.route('/api/instruments', instrumentsRoutes)`.

#### 3. New test file

**File**: `test/worker/instruments.test.ts`

**Intent**: Verify auth gating, seeded data, the type filter, and the response shape.

**Contract**: Tests cover — unauthenticated request returns 401; authenticated request returns both seeded instruments (`^VIX`, `^NDX`) with only `ticker`/`name`/`type` keys present; `?type=index` returns both (both are type `index` today); `?type=gpw_company` (or any non-existent type) returns an empty array.

### Success Criteria:

#### Automated Verification:

- Worker unit tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- `curl` (or equivalent) against local dev confirms `GET /api/instruments` requires a session cookie and returns the expected two-row payload when authenticated

**Implementation Note**: After this phase's automated verification passes, pause here for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- Alert creation/update against valid and invalid tickers (existence check via `instruments` lookup)
- RSI rejection for a non-`rsi_eligible` ticker, both on create and update
- Cron `scheduled.ts` behavior driven by registry rows instead of the static map (existing tests already exercise this shape, just with renamed literals)
- `GET /api/instruments`: auth gating, type filter, response shape

### Integration Tests:

- None beyond the existing `vitest-pool-workers` worker test suite — no new integration surface beyond what's covered above.

### Manual Testing Steps:

1. Seed a scratch local D1 with legacy `instrument`-column rows, apply the migration, verify the rewrite by hand (Phase 1).
2. Confirm the DB no longer blocks a direct RSI+VIX-equivalent insert (Phase 1).
3. Confirm the existing frontend now fails against the new backend as expected (Phase 1, accepted regression).
4. `curl` the new endpoint locally with and without a session cookie (Phase 2).

## Performance Considerations

None beyond existing patterns — `instruments` has 2 rows today; lookups are trivial single-row queries comparable to the existing per-request session lookup.

## Migration Notes

This is a forward-only migration with no rollback path, consistent with the project's existing migration convention (`0002`, `0004`). Per project memory, D1 migrations are not auto-applied on deploy — `wrangler d1 migrations apply` against remote D1 must be run separately after merge, before the cron next fires (the cron would otherwise write to `price_history`/`market_data` using the old schema shape and fail).

## References

- Roadmap: `context/foundation/roadmap.md` (F-03: Instrument registry)
- Prior shadow-table precedent (schema-only, no data preserved): `migrations/0002_users_email_schema.sql`
- Prior non-`create_`-prefixed migration naming precedent: `migrations/0004_sessions_cascade_delete.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Instrument registry schema + core refactor

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run migrate:local` — 7d6670f
- [x] 1.2 Worker unit tests pass: `npm run test:worker` — 7d6670f
- [x] 1.3 Type checking passes: `npm run typecheck` — 7d6670f

#### Manual

- [ ] 1.4 Legacy-row rewrite verified by hand on scratch local D1
- [ ] 1.5 DB no longer rejects RSI+VIX-equivalent insert at the CHECK layer
- [x] 1.6 Existing frontend confirmed to fail against new backend (accepted regression) — 7d6670f

### Phase 2: GET /api/instruments endpoint

#### Automated

- [x] 2.1 Worker unit tests pass: `npm run test:worker`
- [x] 2.2 Type checking passes: `npm run typecheck`

#### Manual

- [x] 2.3 `curl` confirms auth gating and expected payload locally
