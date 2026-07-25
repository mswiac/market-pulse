# Instrument Registry — Plan Brief

> Full plan: `context/changes/instrument-registry/plan.md`

## What & Why

Replace the hardcoded `VIX`/`NASDAQ100` instrument lists scattered across the backend (`YAHOO_SYMBOLS` map, `VALID_INSTRUMENTS` array) with a single `instruments` registry table. The `ticker` column is both the DB join key and the literal symbol sent to Yahoo Finance (`^VIX`, `^NDX`) — no separate internal-code/provider-symbol split. This is the prerequisite (F-03) that unlocks S-04 (instrument-aware alert form) and S-07 (30-day history view), and eventually GPW companies, without further hardcoding.

## Starting Point

`alerts`, `price_history`, and `market_data` all key on an `instrument` column storing literal `'VIX'`/`'NASDAQ100'` strings, with two DB `CHECK` constraints hardcoding `'VIX'` to block RSI. The backend independently hardcodes the same two instruments in two more places (`market-data.ts`, `alerts.ts`). The frontend also hardcodes these literals as wire values.

## Desired End State

An `instruments` table (ticker, name, type, rsi_eligible, provider) is the single source of truth. `price_history`/`market_data`/`alerts` are migrated to a `ticker` column holding `^VIX`/`^NDX`. `alerts.ts` and `scheduled.ts` read from the registry instead of hardcoded lists. `GET /api/instruments` serves the registry to the frontend (consumed by later slices). The existing frontend alert form is **not** updated in this change and will not work until S-04 ships — an explicitly accepted tradeoff.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Frontend sync | Accept a broken window | Keeps F-03 strictly backend/foundation-scoped; user explicitly accepted alert create/edit breaking until S-04 lands. |
| `type` column | `CHECK (type IN ('index'))` | Strongest data integrity now; widening later needs another migration, accepted tradeoff. |
| `GET /api/instruments` auth | Behind `sessionMiddleware` | Consistent "everything requires login" posture across the API. |
| Column naming | Rename `instrument` → `ticker` everywhere | Full consistency with `instruments.ticker`, despite touching more call sites. |
| API response shape | `ticker`, `name`, `type` only | `rsi_eligible`/`provider` are internal routing details with no current frontend consumer. |
| Migration-rewrite verification | Manual, on local D1 | The `vitest-pool-workers` harness applies migrations fresh each run — it can't exercise a pre-existing-data rewrite. |
| RSI enforcement | DB `CHECK` removed, app-layer only | Registry becomes the single source of truth; the existing CHECK-backstop test is deleted, not updated. |

## Scope

**In scope:**
- `instruments` table + migration rewriting `price_history`/`market_data`/`alerts`
- `alerts.ts` and `scheduled.ts` refactored to read from the registry
- `GET /api/instruments` endpoint (session-protected, `?type=` filter)
- Corresponding worker test updates/additions

**Out of scope:**
- Frontend changes (alert form, alert list) — deferred to S-04
- GPW ticker ingestion, the "add ticker" endpoint, the WIG20/mWIG40/sWIG80 list, the new Mon-Fri 18:00 cron
- The S-07 history page

## Architecture / Approach

A single forward-only D1 migration (shadow-table rebuild for `alerts`/`market_data` to drop their `CHECK` constraints; plain `RENAME COLUMN` for `price_history`, which has none) creates and seeds `instruments`, then remaps existing rows in the other three tables from the old literals to the new tickers. Backend code that previously hardcoded the instrument set now queries `instruments` at request/cron time — the same per-request DB access pattern already used for session lookups.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Instrument registry schema + core refactor | Migration + `alerts.ts`/`scheduled.ts` refactor + updated tests | A `CASE` remap typo in one of three tables silently orphans rows with no FK to catch it — checked by hand in manual verification |
| 2. GET /api/instruments endpoint | New session-protected endpoint + its test file | Low risk — net-new, no coupling beyond reading the renamed table |

**Prerequisites:** S-02, F-02 (both already done)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- Production D1 migrations are not auto-applied on deploy (per project convention) — `wrangler d1 migrations apply` against remote must be run manually right after merge, before the next cron fire, or the cron will fail against the old schema shape.
- The frontend alert form will be broken in production from the moment this merges until S-04 ships — accepted, not a defect to triage.

## Success Criteria (Summary)

- `npm run test:worker` and `npm run build` pass after both phases
- A manual check on local D1 confirms legacy-shaped rows are correctly rewritten by the migration
- `GET /api/instruments` returns the seeded registry, gated by session, filterable by type
