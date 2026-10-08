# Per-Market Cron Triggers Implementation Plan

## Overview

Split the daily market-data fetch into two Cron Triggers, one per market group, so each gets its own 50-subrequest budget. A GPW trigger fetches `pl_stock` shortly after the Warsaw close; the existing 23:00 UTC trigger fetches `us_stock` and `index`. Alert evaluation stays a single run at 23:15 UTC. GitHub issue: #162 (builds on #161 / `cron-run-capacity`).

## Current State Analysis

- `runFetchPhase(env, types)` and `selectAlertInstruments(db, types)` already take a list of instrument types (`src/worker/scheduled.ts:11`, `src/worker/lib/instruments.ts:17`); the default is `ALL_INSTRUMENT_TYPES`.
- `handleCron(cron, env)` routes on two constants, `FETCH_CRON = '0 23 * * 1-5'` and `EVALUATE_CRON = '15 23 * * 1-5'` (`scheduled.ts:25-37`), and `index.ts:37` already passes `controller.cron`.
- `wrangler.toml:17` declares `crons = ["0 23 * * 1-5", "15 23 * * 1-5"]`; a test asserts it matches the constants (`test/worker/scheduled.test.ts:680-685`).
- `evaluateAlerts` reads every alert regardless of type and skips tickers whose `market_data` is stale, so it does not need to know about the split.
- The manual admin run (`handleScheduled`) fetches all types in one invocation. It is out of scope here (tracked in #170).
- `instruments` currently holds only `^VIX` and `^NDX` (both `index`), so the GPW trigger fetches nothing until Polish stocks exist.

## Desired End State

Three crons are declared: `30 16 * * 1-5` (fetches `pl_stock`), `0 23 * * 1-5` (fetches `us_stock` and `index`), `15 23 * * 1-5` (evaluates alerts). Each fetch cron only touches instruments of the types it owns. Behaviour for current data is unchanged (all current instruments are `index`).

### Key Discoveries:

- The 16:30 and 23:00 UTC times fall after the local close in both DST states, so no timezone code is needed (issue #162).
- `instruments.suffix` must not drive the split; it is a provider detail. Ownership is keyed on `instruments.type`.
- Evaluation tolerates data of any age up to its freshness limit, so GPW data fetched at 16:30 is still fresh at 23:15.

## What We're NOT Doing

- A second evaluation run for GPW alerts (mail stays at 23:15 for every market).
- A `market` column or migration.
- Changing the manual "Force data refresh" run to be split per market (#170).
- Timezone or DST handling in code.
- Frontend changes.

## Implementation Approach

Replace the single `FETCH_CRON` with an explicit map from cron expression to the instrument types it owns, and have `handleCron` look the expression up. Keeping the map explicit (not "PL versus the rest" as a negation) makes reassigning a type a one-line change.

## Phase 1: Per-market fetch triggers

### Overview

Add the GPW trigger, route both fetch triggers through the type map, and update the docs that describe the schedule.

### Changes Required:

#### 1. Cron routing

**File**: `src/worker/scheduled.ts`

**Intent**: Route each fetch cron to `runFetchPhase` with only the types it owns, keep the evaluation cron as is, and keep logging unknown expressions.

**Contract**: Export one constant per cron expression (`PL_FETCH_CRON = '30 16 * * 1-5'`, `US_FETCH_CRON = '0 23 * * 1-5'`, `EVALUATE_CRON` unchanged) and a map `FETCH_CRON_TYPES: Record<string, string[]>` with `PL_FETCH_CRON -> ['pl_stock']` and `US_FETCH_CRON -> ['us_stock', 'index']`. The comment above the constants is updated to explain why the UTC times are fixed (after the local close in both DST states) and that the maps must match `wrangler.toml`. `FETCH_CRON` is removed.

#### 2. Cron declaration

**File**: `wrangler.toml`

**Intent**: Declare the third trigger.

**Contract**: `crons = ["30 16 * * 1-5", "0 23 * * 1-5", "15 23 * * 1-5"]`.

#### 3. Tests

**File**: `test/worker/scheduled.test.ts`

**Intent**: Cover the routing and keep the wrangler-consistency test honest.

**Contract**: Update the imports and `runScheduled` to the renamed constants; the wrangler test expects all three expressions. Add tests: the GPW cron fetches a `pl_stock` instrument and does not fetch an `index` one; the US cron fetches `index` and `us_stock` and does not fetch `pl_stock`. Both need an alert seeded per instrument (the fetch is alert-scoped). The existing routing tests keep working against `US_FETCH_CRON`.

#### 4. Docs

**Files**: `README.md`, `context/foundation/admin-panel-notes.md` (only if they describe a single daily cron schedule)

**Intent**: Say that fetching now runs in two market-specific triggers followed by one evaluation. Do not touch `context/archive/`.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Typecheck passes: `npm run typecheck`
- GPW cron fetches only `pl_stock`, US cron only `us_stock` and `index` (new tests in `test/worker/scheduled.test.ts`)
- Declared crons in `wrangler.toml` match the constants (existing test, updated)

#### Manual Verification:

- After deploy, the Cloudflare dashboard lists three cron triggers (allow up to 15 minutes for propagation)
- After the first 16:30 UTC run, the Worker logs show a fetch run that touched no `index` instruments

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before the commit.

---

## Testing Strategy

### Unit Tests:

- Routing per cron expression to the owned instrument types, with one instrument of each type seeded.
- Unknown expressions are still ignored and logged.

### Manual Testing Steps:

1. After deploy, confirm three triggers in the Cloudflare dashboard.
2. After a 16:30 UTC run, confirm in Worker logs that only `pl_stock` was considered (empty until Polish stocks exist).

## Performance Considerations

None beyond the goal itself: each fetch invocation now carries its own subrequest budget, so the per-run cap of 40 fetch attempts applies per market group.

## Migration Notes

No database migration. Cron Triggers can take up to 15 minutes to propagate after deploy.

## References

- GitHub issue #162
- Prior change: `context/archive/2026-10-08-cron-run-capacity/plan.md`
- `src/worker/scheduled.ts`, `src/worker/lib/instruments.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-market fetch triggers

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker` — 8385772
- [x] 1.2 Typecheck passes: `npm run typecheck` — 8385772
- [x] 1.3 GPW cron fetches only pl_stock, US cron only us_stock and index — 8385772
- [x] 1.4 Declared crons in wrangler.toml match the constants — 8385772

#### Manual

- [ ] 1.5 After deploy, the Cloudflare dashboard lists three cron triggers
- [ ] 1.6 After the first 16:30 UTC run, Worker logs show a fetch run that touched no index instruments
