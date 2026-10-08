# Cron Run Capacity Implementation Plan

## Overview

Decouple the daily cron's subrequest and CPU cost from the size of the instrument catalogue. The fetch phase only touches tickers that have an alert, writes in bulk after the loop, and reads RSI history from D1. Alert evaluation sends one batched Resend request and one batched D1 write, and runs as its own cron invocation. GitHub issue: #161. Follow-up: #162 (per-market fetch triggers) builds on this change.

## Current State Analysis

- `handleScheduled` (`src/worker/scheduled.ts:49-110`) loads every instrument, then per instrument does one Yahoo fetch (up to 3 attempts) and one `DB.batch()` inside the loop (~2 subrequests per instrument). It then calls `evaluateAlerts` in the same invocation.
- RSI is computed from the 30-day Yahoo payload (`CRON_LOOKBACK_DAYS`, `scheduled.ts:12`), sized to guarantee the 15 closes `calculateRSI` needs. `price_history` is written on every run but never read by the pipeline.
- `evaluateAlerts` (`alert-evaluation.ts:105-199`) sends one Resend POST per firing alert and one `DB.batch()` per firing alert; each re-arm is a separate `UPDATE`. It already re-reads everything from D1, so it does not depend on in-memory fetch results.
- `sendAlertEmail` (`resend.ts:17-56`) pre-checks the recipient against `RESEND_VERIFIED_EMAIL` and flags network errors and 5xx as `transient`; a transient failure leaves the alert armed so the next run retries it.
- `index.ts:36` discards the `ScheduledController`, so a second cron expression cannot be told apart. `wrangler.toml` has a single `0 23 * * 1-5` trigger.
- `POST /api/admin/cron/run` (`admin.ts:109`) calls `handleScheduled` and expects the `CronRunSummary` shape.
- `market_data.updated_at` exists but nothing reads it.
- The Workers Free plan allows 50 subrequests per invocation, D1 queries included.

## Desired End State

A fetch invocation costs about one subrequest per alert-bearing ticker plus a fixed handful of D1 calls, so roughly 44 tickers fit. Alert evaluation runs in its own invocation with its own budget, skips instruments whose data is stale, and sends all due emails in one Resend batch request. Observable behaviour for users is unchanged: the same emails, the same re-arm rules. Instruments without an alert are no longer refreshed by cron (admin backfill still covers them).

### Key Discoveries:

- Disarmed alerts need fresh data to re-arm (`alert-evaluation.ts:183-187`), so the instrument filter must be "has any alert row", not `armed = 1`.
- `price_history` has `ticker, date, close, high, low` and a unique `(ticker, date)`, so the existing upsert is idempotent and a short Yahoo window self-corrects a not-yet-final bar.
- D1 allows 100 bound parameters per statement: `price_history` rows bind 5 values (max 20 rows per statement), `market_data` rows bind 5 values plus `unixepoch()` inline. Use 16 rows per statement for both to keep one constant.
- The dashboard (#167) and chart endpoint read `price_history` for all instruments, so non-alert instruments will go stale there. This is accepted (decision below).

## What We're NOT Doing

- Per-market fetch triggers (GPW vs US/indices) - that is #162. This change only keeps the door open: the instrument-selection query takes a list of instrument types, and the handler reads `controller.cron`.
- Refreshing instruments that have no alert, including from the Force data refresh admin page. Making that page fetch all instruments through two parallel per-market requests (each with its own budget) is tracked in #170.
- Alert cooldown / de-duplication beyond the existing `armed` hysteresis.
- Frontend changes beyond the Force-refresh page description text.
- A new `market` column or migration.

## Implementation Approach

Three phases that each leave the system working: the fetch phase first (largest subrequest saving), then the evaluation phase, then the trigger split. Decisions taken during planning:

- Instruments without an alert are not refreshed (user decision).
- Alerts whose instrument data is older than 12 hours at evaluation time are skipped and logged, with no email and no state change (user decision).
- Retry attempts stay at 3 per ticker, but a per-run cap on total fetch attempts stops a few flaky tickers from exhausting the subrequest budget.
- Resend batch: recipients that fail the existing verified-address pre-check are removed before the batch so they cannot poison it; the rest go in chunks of up to 100. A failed chunk request is treated like a single-send failure (transient if network error or 5xx), applied to every alert in that chunk.
- `POST /api/admin/cron/run` runs both phases in one request, as today, and returns the same summary shape.

## Critical Implementation Details

- **State sequencing:** RSI must be computed from D1 history merged with the freshly fetched closes in memory (fresh rows override same-date rows). Computing it from D1 alone, before the new rows are written, would use yesterday's last close.
- **Fallback for thin history:** a ticker with fewer than 15 stored closes (new or just-added instrument) falls back to the existing long Yahoo window, otherwise its RSI would be null.
- **Ordering between triggers:** Cloudflare gives no ordering guarantee between cron invocations, which is why evaluation checks `market_data.updated_at` instead of assuming the fetch ran.

## Phase 1: Alert-scoped, batched fetch phase

### Overview

Rewrite the fetch loop in `scheduled.ts` so its cost scales with alert-bearing tickers and its D1 writes happen once after the loop.

### Changes Required:

#### 1. Instrument selection

**File**: `src/worker/scheduled.ts` (and `src/worker/lib/instruments.ts` if the row type lives there)

**Intent**: Replace the unfiltered `SELECT ... FROM instruments` with a query returning only instruments that have at least one row in `alerts`, filtered by a list of instrument types.

**Contract**: The selection function takes `types: string[]`; the daily trigger passes all types for now (#162 will pass per-cron subsets). Does not filter on `armed`.

#### 2. Short fetch window and D1-backed RSI

**File**: `src/worker/scheduled.ts`, `src/worker/lib/market-data.ts`

**Intent**: Shorten the Yahoo window to a few days (still ending tomorrow, see the existing comment on `to`). Read recent closes for all selected tickers from `price_history` in a single query, merge them with the fetched closes (fetched wins on the same date), then compute RSI and the latest close/high/low from the merged series.

**Contract**: Tickers with fewer than 15 stored closes use the existing 30-day window for that ticker. Update the stale "2 tickers/day" comment on `RETRY_DELAY_MS`.

#### 3. Bulk writes after the loop

**File**: `src/worker/scheduled.ts`, `src/worker/lib/market-data.ts`

**Intent**: Collect rows per ticker during the loop and, after it, emit multi-row upserts for `price_history` and `market_data` in chunks of 16 rows, plus the currency corrections, as one `DB.batch()`.

**Contract**: Keep the existing `ON CONFLICT` semantics. `upsertPriceHistory` keeps serving the admin backfill endpoint, so add a multi-row builder next to it rather than changing its signature.

#### 4. Attempt cap

**File**: `src/worker/scheduled.ts`

**Intent**: Bound the total number of Yahoo attempts in one run so retries cannot consume the whole subrequest budget; tickers skipped because of the cap are reported as `error` in the summary.

**Contract**: One named constant for the cap, sized below the 50-subrequest limit with room for the D1 calls.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Worker tests pass: `npm run test:worker`
- Lint passes: `npm run lint`
- Worker tests cover: a ticker with no alert is not fetched; a disarmed alert's ticker is fetched; RSI matches the old result when history is in D1; thin-history fallback; chunking above 16 rows; attempt cap.

#### Manual Verification:

- `POST /api/admin/cron/run` locally still writes `market_data` and `price_history` for alert-bearing tickers and returns the same summary shape.
- An instrument without an alert is not refreshed by the run.

**Implementation Note**: After this phase and its automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Batched alert evaluation

### Overview

Collapse the per-alert network and D1 calls in `evaluateAlerts` into one Resend batch request per 100 emails and one batched D1 write, and make evaluation skip stale data.

### Changes Required:

#### 1. Resend batch sender

**File**: `src/worker/lib/resend.ts`

**Intent**: Add a batch send that posts to `/emails/batch` in chunks of up to 100 and returns a per-message result list aligned with the input. Messages whose recipient fails the verified-address pre-check are not sent and get the same non-transient failure as today.

**Contract**: Keep `SendEmailResult` semantics: network error or 5xx on a chunk marks every message in that chunk `transient`; a 4xx marks them failed without `transient`. Keep `sendAlertEmail` if other callers use it.

#### 2. Evaluation flow

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Evaluate all alerts first (decide fire / re-arm / skip), then send one batch, then write everything in one `DB.batch()`: trigger_events inserts, `armed = 0` updates for non-transient outcomes, and `armed = 1` re-arms.

**Contract**: Behaviour per alert is unchanged (same firing value, same re-arm margins, same transient rule). `AlertEvaluationSummary` keeps its shape.

#### 3. Freshness check

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Select `m.updated_at` with the alert rows; alerts whose `updated_at` is older than 12 hours are skipped and logged (instrument and age), with no email and no state change.

**Contract**: One named constant for the 12-hour threshold.

### Success Criteria:

#### Automated Verification:

- Typecheck, lint and `npm run test:worker` pass.
- Tests cover: multiple firing alerts produce one Resend request; unverified recipient does not block the batch; 5xx on the batch keeps all its alerts armed; re-arms and trigger events land in one `DB.batch()`; stale data is skipped; >100 emails chunk correctly.

#### Manual Verification:

- With a crossed threshold locally, one email arrives and the alert disarms; a later run past the re-arm margin re-arms it.

---

## Phase 3: Separate evaluation trigger

### Overview

Run evaluation as its own cron invocation and route by `controller.cron`.

### Changes Required:

#### 1. Trigger and routing

**File**: `wrangler.toml`, `src/worker/index.ts`, `src/worker/scheduled.ts`

**Intent**: Add a second cron expression for evaluation shortly after the fetch trigger and pass `controller.cron` to the handler, which runs the fetch phase for the fetch expression and the evaluation phase for the evaluation expression.

**Contract**: Fetch stays `0 23 * * 1-5`; evaluation is `15 23 * * 1-5`. Export separate `runFetchPhase(env, types)` and `runEvaluationPhase(env)` from `scheduled.ts`. An unknown expression is logged and ignored.

#### 2. Admin endpoint

**File**: `src/worker/routes/admin.ts`

**Intent**: `POST /api/admin/cron/run` runs the fetch phase and then the evaluation phase and returns the same `CronRunSummary` as today.

**Contract**: Response shape and status codes unchanged.

#### 3. Force-refresh admin page copy

**File**: `src/app/features/admin/cron-run/cron-run.html`, `src/locale/messages.pl.xlf`

**Intent**: The page description says the run fetches fresh data "for every instrument"; after this change it fetches only instruments that have an alert. Reword the English source text and update the Polish translation (hand-edit `messages.pl.xlf` only, per the strict i18n rule). The ticker table now lists only alert-bearing instruments; no component logic changes.

**Contract**: Same `@@cronRun.description` id; the response shape consumed by the page is unchanged.

#### 4. Docs

**File**: `context/foundation/infrastructure.md` (if it documents the cron)

**Intent**: Record the two triggers, the 12-hour staleness rule and that non-alert instruments are not refreshed.

### Success Criteria:

#### Automated Verification:

- Typecheck, lint and `npm run test:worker` pass.
- Tests cover: each cron expression runs only its phase; an unknown expression runs nothing; the admin endpoint runs both phases in order.
- Production build with strict i18n passes: `npm run build`

#### Manual Verification:

- After deploy, both triggers show up in the Cloudflare dashboard and a scheduled run of each succeeds.
- CPU time per invocation and subrequest count are read from observability and recorded in the PR (answers the two open measurements from #161: whether `DB.batch()` counts as one subrequest, and CPU time per run).

---

## Testing Strategy

### Unit Tests:

- Instrument selection (alert existence, not `armed`), chunking, RSI merge, thin-history fallback, attempt cap.
- Resend batch result alignment, pre-check removal, transient classification, 100-message chunking.
- Freshness skip and the single batched D1 write.

### Integration Tests:

- Existing `test/worker/scheduled.test.ts`, `alert-evaluation.test.ts` and `resend.test.ts` are updated to the new call shapes; no new spec framework.

### Manual Testing Steps:

1. Run `POST /api/admin/cron/run` locally with an alert on one ticker and none on another.
2. Cross a threshold and confirm one email, one disarm, then a re-arm on a later run.
3. After deploy, read subrequest and CPU figures for each trigger from observability.

## Performance Considerations

Target: about one subrequest per alert-bearing ticker plus a fixed number of D1 calls in the fetch phase; evaluation costs a read, one Resend request per 100 emails and one write. CPU drops because only a few days of Yahoo payload are parsed per ticker.

## Migration Notes

No schema change. Deploy order does not matter: the new evaluation trigger is additive, and until it exists the old combined behaviour is replaced in the same deploy. D1 migrations are not involved.

## References

- Issue: #161; follow-up #162.
- Code: `src/worker/scheduled.ts`, `src/worker/lib/alert-evaluation.ts`, `src/worker/lib/resend.ts`, `src/worker/lib/market-data.ts`, `src/worker/index.ts`, `src/worker/routes/admin.ts`, `wrangler.toml`.

## Review Addendum

Differences between this plan and the code, found in the implementation review (`reviews/impl-review.md`):

- **No `runEvaluationPhase`.** Phase 3 names it, but evaluation is called directly as `evaluateAlerts(env)` from `handleCron` and `handleScheduled`; behaviour is identical.
- **`handleCron` router and `FetchPhaseResult.loadError`** are additions: the router maps `controller.cron` to a phase (unknown expressions are logged and ignored), and `loadError` lets `handleScheduled` keep its old "registry failed, skip evaluation" early return.
- **`refreshInstruments(env, instruments, { retryAttempts, fullWindow, timeoutMs })`** is split out of `runFetchPhase` and lives in `src/worker/lib/market-refresh.ts` (with the Yahoo retry, stored-history read and bulk-write helpers), so that both the cron and the alerts route can use it without the route depending on the cron module.
- **Alert create/edit refreshes stale market data** (`src/worker/routes/alerts.ts`, `ensureFreshMarketData`). Because instruments without an alert are no longer refreshed by the cron (user decision), the first alert on such an instrument would have its initial `armed` state computed from an old price. Data older than the 12-hour limit (or missing) is now refreshed with one Yahoo attempt before `computeArmed`; a failed refresh falls back to the stored data. The refresh runs with `fullWindow` (fetches the whole 30 days and skips the stored-history read, so a ticker that went unrefreshed for weeks gets a gap-free RSI series) and a 4-second timeout so a slow Yahoo cannot hold up saving the alert. On edit (PUT) it runs only after a cheap check that the alert exists for the user, so an unknown id costs no Yahoo call. This touches a user-facing route that the original plan listed under "not doing" for the frontend only, not the API.
- **Resend `Idempotency-Key`** is sent with every batch (SHA-256 of the payload), so a re-sent batch within 24 hours is not mailed twice if the D1 write after sending fails.
- **HTTP 429, 408 and 409** from Resend are classified as transient, so a rate-limited batch stays armed and is retried.
- **`context/foundation/infrastructure.md` was not updated** on purpose: it records platform-choice reasoning, not the cron schedule.
- **Known limitation (accepted): on-demand refresh and the freshness guard.** The refresh at alert create/edit stamps `market_data.updated_at` like the cron does. If it runs while a market is open, the stored row is Yahoo's partial intraday bar; should the nightly fetch then fail for that ticker, the evaluation within the next 12 hours treats the row as fresh and can send a "close" email with an intraday value. This needs a stale ticker, an alert created during the session, and a failed nightly fetch, so it is accepted rather than adding a "non-final row" marker. The mitigation, if it ever matters, is to stamp rows written by the on-demand path as non-final so evaluation skips them until the cron overwrites them.
- **Tracked elsewhere:** the Force data refresh page fetching all instruments through per-market requests and a separate evaluation request (#170), per-market cron triggers (#162), admin email on cron failure (#172).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Alert-scoped, batched fetch phase

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — aa8a064
- [x] 1.2 Worker tests pass: `npm run test:worker` — aa8a064
- [x] 1.3 Lint passes: `npm run lint` — aa8a064
- [x] 1.4 Worker tests cover alert-scoped selection, RSI merge, thin-history fallback, chunking and attempt cap — aa8a064

#### Manual

- [x] 1.5 `POST /api/admin/cron/run` locally writes data for alert-bearing tickers and returns the same summary shape
- [x] 1.6 An instrument without an alert is not refreshed by the run

### Phase 2: Batched alert evaluation

#### Automated

- [x] 2.1 Typecheck, lint and `npm run test:worker` pass — 12de856
- [x] 2.2 Tests cover single Resend request, unverified recipient, 5xx keeps alerts armed, single D1 batch, stale skip, 100-email chunking — 12de856

#### Manual

- [x] 2.3 A crossed threshold sends one email and disarms; a later run past the margin re-arms

### Phase 3: Separate evaluation trigger

#### Automated

- [x] 3.1 Typecheck, lint and `npm run test:worker` pass — ac5d37a
- [x] 3.2 Tests cover per-expression phase routing, unknown expression, and admin endpoint running both phases — ac5d37a
- [x] 3.5 Production build with strict i18n passes: `npm run build` — ac5d37a

#### Manual

- [x] 3.3 Both triggers visible in the Cloudflare dashboard and each scheduled run succeeds
- [x] 3.4 Subrequest count and CPU time per invocation recorded in the PR
- [x] 3.6 The Force data refresh admin page shows the updated description and lists only alert-bearing tickers
