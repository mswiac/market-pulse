# Cron Failure Email Implementation Plan

## Overview

When a scheduled cron invocation (GPW fetch, US fetch, alert evaluation) hits a problem, email the admin once per invocation so failures that happen while nobody is clicking in the admin panel stop being visible only in the Cloudflare log. GitHub issue #172.

## Current State Analysis

- `handleCron` (`src/worker/scheduled.ts`) awaits `runFetchPhase` / `evaluateAlerts` and discards their results. The only trace of a failure is `console.error`.
- `evaluateAlerts` swallows a failure to load alerts from D1 and returns `errors: []` (`src/worker/lib/alert-evaluation.ts:142-145`), so it looks like a clean run.
- Alerts whose market data is older than 12 h are skipped with only a `console.warn` (`alert-evaluation.ts:186-190`). That is the silent downstream effect of a failed fetch.
- `sendAlertEmailBatch` (`src/worker/lib/resend.ts`) already sends to `RESEND_VERIFIED_EMAIL`, with the sandbox pre-flight check and an `Idempotency-Key` derived from the payload (24 h dedup window at Resend).
- The admin "Force data refresh" route (`src/worker/routes/admin.ts`, `POST /cron/run`) calls the same `runFetchPhase` / `evaluateAlerts`; its operator already sees failures in the HTTP 207 response.

## Desired End State

- Any problem in a cron invocation produces one email to `RESEND_VERIFIED_EMAIL` naming the phase and the problems.
- A failure to send that email is logged and ignored; it never changes the outcome of the cron run.
- The manual admin run does not send these emails.

### Key Discoveries:

- Fetch cron: up to 40 fetch attempts (`MAX_FETCH_ATTEMPTS_PER_RUN`) plus about 3 D1 calls, so one extra Resend request stays under the 50-subrequest limit.
- Evaluation cron runs at 23:15 UTC, after both fetches (16:30 and 23:00 UTC), so data older than 12 h at that point means a fetch for that ticker failed or never ran.
- Resend deduplicates identical batch payloads for 24 h. A failure notice that is textually identical on consecutive days would be silently dropped, so the notice must carry the date.

## What We're NOT Doing

- No recurring-failure tracking (needs persistent state in D1).
- No retry of the failure email.
- No notification of ordinary users.
- No email from the manual admin run.
- No separate recipient setting; `RESEND_VERIFIED_EMAIL` only, until a custom domain is verified.

## Implementation Approach

Make the phases report everything that went wrong in their return values, then add one notifier that `handleCron` calls after each phase. Notification lives only in `handleCron`, so the admin route is unaffected.

## Critical Implementation Details

- **Idempotency key and date**: put the run date (UTC `YYYY-MM-DD`) in the email subject so the payload-derived idempotency key differs every day.
- **Unexpected exceptions**: `handleCron` wraps the phase in `try/catch`, sends the notice with the exception message, then rethrows so Cloudflare still records the invocation as failed. The notifier itself never throws.

## Phase 1: Evaluation reports every problem

### Overview

Make `evaluateAlerts` surface the two problems it currently hides.

### Changes Required:

#### 1. Alert evaluation summary

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: A failure to load alerts is reported instead of returning an empty clean summary. Each ticker skipped for stale data is reported once, with its age.

**Contract**: Both are appended to `AlertEvaluationSummary.errors` as strings (load failure: `failed to load alerts: <error>`; stale: `<ticker>: market data is <N>h old (limit 12h)`). Existing `console.error` / `console.warn` calls stay. No change to the type shape, so the admin route keeps working; it will now report 207 for these cases, which is correct.

#### 2. Tests

**File**: `test/worker/alert-evaluation.test.ts`

**Intent**: Cover the load-failure and stale-ticker reporting; adjust any existing assertion that expects `errors` to be empty with stale data (around line 350).

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- With a stale `market_data.updated_at` locally, the admin "Force data refresh" evaluation step shows the stale ticker as an error.

---

## Phase 2: Failure notice from `handleCron`

### Overview

Send the email after each cron phase when it has problems.

### Changes Required:

#### 1. Notifier

**File**: `src/worker/lib/cron-failure-notice.ts` (new)

**Intent**: Build and send one plain-text email to `RESEND_VERIFIED_EMAIL`. Never throws; any error (including missing configuration) is logged with `console.error` and ignored.

**Contract**: `notifyCronFailure(env: Env, phase: string, problems: string[]): Promise<void>`. Subject `MarketPulse: <phase> had problems (<YYYY-MM-DD>)`. Body lists the problems, truncated to 20 lines followed by `... and N more`. Sends through `sendAlertEmailBatch` with a single input.

#### 2. Cron handler

**File**: `src/worker/scheduled.ts`

**Intent**: Collect problems per phase and call the notifier when there are any.

**Contract**: Fetch phase problems = every ticker with `status: 'error'` (`<ticker>: <error>`) plus `loadError`. Evaluation problems = `errors` plus every email with `status: 'failed'` (`alert <id> <ticker>: <error>`). Phase labels: `GPW fetch`, `US fetch`, `alert evaluation`. A thrown exception is caught, notified (`unexpected error: <message>`), and rethrown. `runFetchPhase` and `evaluateAlerts` signatures are unchanged.

#### 3. Tests

**Files**: `test/worker/cron-failure-notice.test.ts` (new), `test/worker/scheduled.test.ts`

**Intent**: Notifier: subject and date, truncation, recipient, no throw when Resend fails or the key is missing. Handler: one email on ticker errors, on `loadError`, on failed alert emails, on stale tickers; no email on a clean run; no email from the admin route; exception path notifies and rethrows.

#### 4. Docs

**Files**: `README.md`, `context/foundation/admin-panel-notes.md`

**Intent**: One short paragraph that cron failures are emailed to `RESEND_VERIFIED_EMAIL` and that the manual admin run does not send them.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Angular tests pass: `npm run test:ci`

#### Manual Verification:

- Locally, trigger the scheduled handler with a forced fetch failure and confirm the failure email arrives at `RESEND_VERIFIED_EMAIL`.
- A clean local run sends no failure email.
- After deploy, the first real cron run sends no failure email (or a correct one if something is genuinely wrong).

---

## Testing Strategy

### Unit Tests:

- Notifier output and failure isolation.
- Problem collection per phase, including the empty case.

### Manual Testing Steps:

1. Run the worker locally and invoke the scheduled handler with an unreachable provider.
2. Check the mail, then rerun on a healthy setup and confirm silence.

## Performance Considerations

One extra Resend request per invocation: about 44 of 50 subrequests in the worst fetch case.

## References

- GitHub issue #172
- `src/worker/scheduled.ts`, `src/worker/lib/alert-evaluation.ts`, `src/worker/lib/resend.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Evaluation reports every problem

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [x] 1.4 A stale ticker shows as an error in the admin evaluation step

### Phase 2: Failure notice from handleCron

#### Automated

- [x] 2.1 Worker tests pass: `npm run test:worker`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Angular tests pass: `npm run test:ci`

#### Manual

- [x] 2.5 A forced local fetch failure sends the failure email
- [x] 2.6 A clean local run sends no failure email
- [ ] 2.7 The first real cron run after deploy behaves correctly
