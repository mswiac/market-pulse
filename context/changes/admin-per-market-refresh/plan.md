# Admin Per-Market Refresh Implementation Plan

## Overview

Make the admin "Force data refresh" page refresh the whole instrument catalogue (GitHub issue #170). Today one request fetches only instruments that have an alert and also evaluates alerts, all inside a single 50-subrequest budget. After this change the page drives three requests, each with its own budget: two per-market fetches in parallel (all instruments of the market), then one alert evaluation. The three summaries are merged into the one results table.

## Current State Analysis

- `POST /api/admin/cron/run` (`src/worker/routes/admin.ts:107`) takes no body and calls `handleScheduled` (`src/worker/scheduled.ts:53`): fetch phase for every type, then `evaluateAlerts`, in one invocation.
- The fetch phase selects instruments through `selectAlertInstruments` (`src/worker/lib/instruments.ts`), which requires an `EXISTS (alerts ...)` row. A catalogue instrument without an alert is never refreshed.
- The type-to-market mapping lives only in `FETCH_CRON_TYPES` in `scheduled.ts` (cron expression -> types). The endpoint has no access to a "market" notion.
- `CronRun` (`src/app/features/admin/cron-run/cron-run.ts`) calls `AdminService.triggerCronRun()` once and renders a single `CronRunSummary` (tickers table, alerts evaluated, emails table, errors list).
- `handleScheduled` is used only by the endpoint and by the "handleScheduled summary" tests in `test/worker/scheduled.test.ts`.

## Desired End State

- `POST /api/admin/cron/run` accepts `{ phase: 'fetch', market: 'pl' | 'other' }` or `{ phase: 'evaluate' }` and runs exactly that phase. Invalid or missing input is a 400.
- A fetch request refreshes **all** instruments of the market (alert or not); `pl` -> `pl_stock`, `other` -> `us_stock` + `index`.
- An evaluate request runs `evaluateAlerts` unchanged for all alerts.
- The page runs both fetches in parallel, then evaluates, and shows one merged result. If any request fails, the others still run and the failure is listed under "Errors".
- The market-to-types mapping exists in one place, used by both the cron triggers and the endpoint.
- The page description and its Polish translation say that every instrument is refreshed.

### Key Discoveries:

- `refreshInstruments` and `runFetchPhase(env, types)` from #161/#162 already take a type list; only the instrument *selector* differs (`src/worker/scheduled.ts:12`).
- `evaluateAlerts` already guards on market_data freshness (12 h), so evaluating after a failed fetch cannot fire on stale data (issue #170).
- Cron triggers stay alert-scoped (decision of #161); only the manual admin run fetches the full catalogue.
- No Angular spec exists for `CronRun`, and the project rule is to never generate spec files, so the UI is covered by typecheck, build and manual verification.

## What We're NOT Doing

- No change to the cron schedule or to what cron triggers fetch (#162 stays as is).
- No `market` column; `instruments.type` remains the discriminator, with the same known limitation as #162.
- No migration, no change to `evaluateAlerts`, `refreshInstruments`, or the retry/budget logic.
- No new UI for progress per stage, no collapsing of the tickers table, no new component spec.
- No backwards-compatible "run everything in one request" mode.

## Implementation Approach

One phase. The worker side reuses the existing pieces: a shared market map, a second selector, and a `scope` argument on `runFetchPhase`. The endpoint dispatches on the body and answers with the existing `CronRunSummary` shape (fetch responses leave `alertsEvaluated: 0` and `emails: []`; evaluate responses leave `tickers: []`), so the client merges by concatenating lists and summing the counter. The component replaces its single call with `forkJoin` of the two fetches followed by the evaluation, converting each failed request into an entry in `errors` instead of aborting.

## Phase 1: Per-market admin refresh

### Overview

Shared market map and selector, phase-aware endpoint, three-request page flow, copy and tests.

### Changes Required:

#### 1. Shared market map and full-market selector

**File**: `src/worker/lib/instruments.ts`

**Intent**: Define the one place where markets map to instrument types, and add a selector that returns every instrument of the given types regardless of alerts.

**Contract**: `export const MARKET_TYPES = { pl: ['pl_stock'], other: ['us_stock', 'index'] }` with a `Market` key type; `selectInstruments(db, types)` returning `InstrumentRow[]` (same columns as `selectAlertInstruments`, no `EXISTS` filter, empty list for empty `types`).

#### 2. Cron triggers use the shared map

**File**: `src/worker/scheduled.ts`

**Intent**: Build `FETCH_CRON_TYPES` from `MARKET_TYPES` (`PL_FETCH_CRON -> pl`, `US_FETCH_CRON -> other`) so a type is reassigned in one place. Give `runFetchPhase` a `scope` parameter (`'alerts'` default, `'all'`) choosing the selector, so cron behaviour is unchanged. Remove `handleScheduled` and its now-unused imports; keep `CronRunSummary`.

**Contract**: `runFetchPhase(env, types?, scope: 'alerts' | 'all' = 'alerts'): Promise<FetchPhaseResult>`; `CronRunSummary` stays exported for the route.

#### 3. Phase-aware endpoint

**File**: `src/worker/routes/admin.ts`

**Intent**: Parse the JSON body and dispatch. `fetch` requires `market` in `MARKET_TYPES` and runs `runFetchPhase(env, MARKET_TYPES[market], 'all')`; `evaluate` runs `evaluateAlerts(env)`. Anything else is 400 with a stable `code` (e.g. `invalid_phase`, `invalid_market`), following the validation style of the neighbouring routes. Keep the auth middleware, the 500 `cron_run_failed` fallback, and 207 when any ticker, email, or error entry reports a failure. Update the route comment (no longer "the full pipeline").

**Contract**: request `{ phase: 'fetch', market: 'pl'|'other' } | { phase: 'evaluate' }`; response `CronRunSummary` (fetch: `alertsEvaluated: 0`, `emails: []`, `errors` holds `loadError`; evaluate: `tickers: []`).

#### 4. Client service

**File**: `src/app/features/admin/admin-panel.service.ts`

**Intent**: Replace `triggerCronRun()` with phase-specific calls.

**Contract**: `fetchCronMarket(market: 'pl' | 'other'): Observable<CronRunSummary>` and `evaluateCronAlerts(): Observable<CronRunSummary>`, both POSTing the body above.

#### 5. Page flow, merge and copy

**Files**: `src/app/features/admin/cron-run/cron-run.ts`, `src/app/features/admin/cron-run/cron-run.html` (description only), `src/locale/messages.pl.xlf`

**Intent**: `run()` runs the two fetches with `forkJoin`, then the evaluation, then publishes one merged `CronRunSummary` (tickers concatenated, `alertsEvaluated` summed, emails concatenated, errors concatenated). A failed HTTP request (any stage) becomes an error string in `errors` (using the existing `ERROR_MESSAGES`/`GENERIC_ERROR` lookup) and does not stop later stages; the evaluation always runs. Single spinner and button lock as today. Rewrite the description to say it refreshes every instrument, evaluates all alerts and sends emails; update the Polish target of `cronRun.description` accordingly.

**Contract**: no template structure change beyond the description text; the results card keeps its sections.

#### 6. Worker tests

**Files**: `test/worker/admin.test.ts`, `test/worker/scheduled.test.ts`

**Intent**: Rewrite the `POST /api/admin/cron/run` block for the new contract: 401/403 unchanged; 400 for missing/unknown phase and for a fetch without a valid market; `fetch` + `other` refreshes `^VIX`/`^NDX` **without any alert rows** and leaves a `pl_stock` instrument untouched (and the reverse for `pl`); 207 with a failing ticker marked error; `evaluate` fires an email and records a `trigger_events` row; 207 when the email send fails. In `scheduled.test.ts`, replace the "handleScheduled summary" block (the happy-path and failing-ticker cases move to the endpoint tests; keep the registry-load-failure case against `runFetchPhase`, asserting `loadError`) and add a case that `scope: 'all'` selects instruments without alerts while the default still requires one.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Typecheck passes: `npm run typecheck`
- Angular tests pass: `npm run test:ci`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On local `wrangler dev` + `ng serve`, "Force data refresh" shows one merged table that includes instruments without any alert
- With one market's fetch forced to fail (e.g. offline Yahoo for a ticker), the other market and the evaluation still run and the failure shows in the results
- The page description reads correctly in English and Polish

**Implementation Note**: After automated verification passes, pause for the human's manual confirmation (batched at the end, per project practice) before the commit ritual.

---

## Testing Strategy

### Unit / Worker Tests:

- Endpoint validation (400s), per-market selection of all instruments, evaluate-only path, partial-failure status codes (207).
- `runFetchPhase` scope: `'all'` vs default `'alerts'`.

### Manual Testing Steps:

1. Start the worker and the SPA locally, log in as the dev admin, open "Force data refresh".
2. Run it and check that all catalogue instruments appear and the alerts-evaluated counter is shown.
3. Break one ticker's fetch and re-run: only that row is an error, evaluation still ran.

## Performance Considerations

Each request has its own 50-subrequest budget. A fetch request stays under the 40-attempt cap for ~40 instruments per market (2 fixed D1 calls plus the session/admin middleware queries). The evaluation request is unchanged.

## Migration Notes

None. The old no-body request shape is removed; the SPA and API deploy together.

## References

- GitHub issue #170; depends on #161 (`context/archive/*-cron-run-capacity`) and shares the market mapping with #162 (`context/archive/2026-10-08-per-market-cron-triggers`)
- Selector pattern: `src/worker/lib/instruments.ts`
- Existing route tests: `test/worker/admin.test.ts:1128`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-market admin refresh

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker`
- [x] 1.2 Typecheck passes: `npm run typecheck`
- [x] 1.3 Angular tests pass: `npm run test:ci`
- [x] 1.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 1.5 Force data refresh shows one merged table including instruments without any alert
- [ ] 1.6 A failing fetch for one market does not stop the other market or the evaluation, and shows in the results
- [ ] 1.7 The page description reads correctly in English and Polish
