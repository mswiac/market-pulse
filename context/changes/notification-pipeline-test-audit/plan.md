# Notification/Evaluation Pipeline Regression Audit Implementation Plan

## Overview

Close test-plan.md §3 Phase 1: verify and harden the two top-ranked risks
(#1 S-08 high/low firing logic has no independent oracle; #2 an uncaught
`fetch` throw inside `resend.ts` silently drops a notification with zero
trace) by fixing the identified code gap, exporting `buildEmail` for direct
testing, and adding unit tests that close every named untested branch.

## Current State Analysis

- `resend.ts:23-30` calls `fetch()` unguarded — a rejecting promise
  (network/DNS/timeout error, not an HTTP error response) propagates
  uncaught out of `sendAlertEmail`.
- `alert-evaluation.ts:116-161` wraps each alert's evaluation in a
  `try/catch` that only `console.error`s. Because the throw happens before
  the `env.DB.batch([...])` call at line 133, a thrown `sendAlertEmail`
  leaves the alert **armed** and writes **no** `trigger_events` row —
  today's actual behavior lets tomorrow's cron run retry naturally, but
  there is zero audit trail that anything happened.
- `test/worker/alert-evaluation.test.ts:251-284` ("keeps evaluating other
  alerts when one alert throws mid-run") already exercises this exact path
  via `stubFetchThrowingFor` and asserts today's behavior (`armed` stays
  `1`, zero `trigger_events` rows) as if it were correct — this test
  documents the gap rather than catching it.
- `market-data.ts:51` has the same shape of unguarded `fetch()` call inside
  `fetchDailyCloses`, but both call sites already catch it:
  `scheduled.ts`'s `fetchWithRetry` (3 attempts, fixed delay) retries and
  re-throws only after exhausting attempts, and `handleScheduled`'s outer
  per-instrument `catch` (`scheduled.ts:79-81`) logs and moves on. No
  code gap here — see Key Discoveries.
- `rsi.ts:1-5`'s `rsiFromAverages` has two branches: `avgLoss === 0` (tested
  at `rsi.test.ts:25-28`) and the implicit `avgGain === 0` case (strictly
  decreasing closes) — untested.
- `alert-evaluation.ts:34-66`'s `buildEmail` omits a high/low line when
  that value is `null` (`.filter(line => line !== null)` at line 54).
  Existing tests only cover "both present" and "both null" — the
  asymmetric case (one present, one `null`) is untested, and `buildEmail`
  is not exported, so it can only be tested indirectly today.

### Key Discoveries:

- `scheduled.ts:18-34` (`fetchWithRetry`) + `scheduled.ts:36-85`
  (`handleScheduled`'s per-instrument `try/catch`) already fully absorb a
  throwing Yahoo `fetch` — confirmed by reading both call sites, not by a
  new test. No fix needed in `market-data.ts` for Phase 1.
- A naive "catch and always disarm" fix for `resend.ts` would make
  transient-failure delivery *worse* than today: today's throw leaves the
  alert armed (implicit next-day retry); disarming on every failure means
  a purely transient blip requires the value to retreat past its margin
  and re-cross before the user is notified again — possibly never, if the
  value plateaus above threshold. The fix in this plan distinguishes
  transient (network-level, retry-worthy) from permanent (recipient not
  verified) failures and only disarms on the latter.
- `SendEmailResult`'s failure variant gains an optional `transient?: boolean`
  discriminator so `alert-evaluation.ts` can make that distinction without
  string-matching error messages.

## Desired End State

- A thrown `fetch` inside `sendAlertEmail` is caught, returned as
  `{ ok: false, error: 'network error: ...', transient: true }`, and
  `alert-evaluation.ts` records a `trigger_events` row with
  `email_status: 'failed'` for it **without** disarming the alert.
- `buildEmail` is exported and directly unit-tested for all four
  high/low presence combinations plus the RSI case.
- `sendAlertEmail` has a dedicated `test/worker/resend.test.ts` covering
  success, non-ok JSON response, non-ok non-JSON response, unverified
  recipient, and a throwing `fetch`.
- `rsi.ts`'s `avgGain === 0` branch is covered.
- `test-plan.md` §3 Phase 1 shows `shipped` with this change folder, and
  §6.1/§6.3 cookbook sections describe the patterns used above instead of
  reading `TBD`.
- Verify via: `npm run typecheck && npm run test:worker` all green;
  `test/worker/alert-evaluation.test.ts`'s renamed throw-path test asserts
  the alert stays armed with one recorded `failed` trigger event.

## What We're NOT Doing

- No retry loop inside `resend.ts` (mirroring `market-data.ts`'s
  `fetchWithRetry`) — rejected in the Fetch-throw design question in favor
  of the simpler "record + don't disarm, let tomorrow's cron retry"
  approach; added CPU cost per failed send wasn't judged worth it at
  current single-user MVP scale.
- No new automated regression test for `market-data.ts`'s already-caught
  fetch throw — documented as a Key Discovery instead (see Risk Response
  Guidance §2 cost×signal principle: don't test what's already provably
  correct).
- No change to the non-ok-HTTP-response or unverified-recipient failure
  paths' disarm behavior — both stay "permanent, disarm on failure" as
  today.
- No e2e or live-Resend-account testing — out of scope per test-plan §4/§7.

## Implementation Approach

Single phase: fix `resend.ts`, thread the `transient` distinction through
`alert-evaluation.ts`'s disarm logic, export `buildEmail`, then add/update
tests closing every named gap, and finish by updating `test-plan.md`'s
Phase 1 status and cookbook sections to match what shipped.

## Phase 1: Fetch-throw fix, transient-aware disarm, and full test closure

### Overview

Closes risks #1 and #2 from `test-plan.md` §2.

### Changes Required:

#### 1. `resend.ts` — catch a throwing fetch, distinguish transient failures

**File**: `src/worker/lib/resend.ts`

**Intent**: A rejecting `fetch()` promise (network/DNS/timeout) must not
propagate uncaught — it should resolve to the same `SendEmailResult`
shape as every other failure path, tagged so the caller can tell a
transient failure apart from a permanent one.

**Contract**: `SendEmailResult`'s failure variant becomes
`{ ok: false; error: string; transient?: boolean }`. Wrap only the
`fetch()` call itself (not the existing response-handling block, which
already has its own try/catch around `response.json()`) in a `try/catch`.
On catch, return
`{ ok: false, error: `network error: ${err instanceof Error ? err.message : String(err)}`, transient: true }`.
The non-ok-response and unverified-recipient paths are unchanged and never
set `transient`.

#### 2. `alert-evaluation.ts` — don't disarm on a transient send failure; export `buildEmail`

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: A transient send failure should still produce an audit
`trigger_events` row, but must not disarm the alert — leaving it armed is
what lets tomorrow's cron naturally retry the notification. A permanent
failure (e.g. unverified recipient) keeps disarming, matching today's
behavior. `buildEmail` needs to be directly unit-testable.

**Contract**: In the `armed === 1` firing branch (currently
`env.DB.batch([INSERT trigger_events, UPDATE alerts SET armed = 0])`),
build the statements array with the `INSERT` always included, and push
the `UPDATE alerts SET armed = 0 WHERE id = ?` statement only when
`!(!sendResult.ok && sendResult.transient === true)`. Add `export` to the
`function buildEmail(...)` declaration; no signature change.

### Success Criteria:

#### Automated Verification:

- [ ] Typecheck passes: `npm run typecheck`
- [ ] Worker test suite passes: `npm run test:worker`

#### Manual Verification:

- [ ] Skim the renamed `alert-evaluation.test.ts` throw-path test and
      confirm its new assertions read as intended (armed stays `1`, one
      `failed` trigger event recorded)
- [ ] Skim `test-plan.md` §6.1/§6.3 cookbook text for accuracy

---

## Testing Strategy

### Unit Tests:

- `test/worker/resend.test.ts` (new): success (asserts URL, auth header,
  request body `to`/`subject`/`text`), non-ok JSON response, non-ok
  non-JSON response (statusText fallback), unverified recipient (no
  fetch call), throwing fetch (transient: true).
- `test/worker/alert-evaluation.test.ts`: new `describe('buildEmail')`
  block — PRICE with both high/low present, high-only, low-only, both
  null, and RSI — asserting which value lines appear in `text`.
- `test/worker/rsi.test.ts`: new case for `avgGain === 0` (strictly
  decreasing closes → RSI `0`).

### Integration Tests:

- `test/worker/alert-evaluation.test.ts`'s existing throw-path test,
  renamed and re-asserted: armed stays `1`, exactly one `trigger_events`
  row with `email_status: 'failed'` and `email_error` containing
  `'network error'`; the healthy alert in the same run still fires
  normally (unchanged assertion).

### Manual Testing Steps:

1. Read the renamed throw-path test's new assertions against the Current
   State Analysis above and confirm the transient/permanent distinction
   is captured correctly.
2. Read the filled-in `test-plan.md` §6.1/§6.3 cookbook sections for
   accuracy against what actually shipped.

## References

- Test plan: `context/foundation/test-plan.md` §2 (Risk Map, Risk Response
  Guidance rows #1/#2), §3 (Phase 1 scope notes)
- Prior test-plan grounding: `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fetch-throw fix, transient-aware disarm, and full test closure

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Worker test suite passes: `npm run test:worker`

#### Manual

- [ ] 1.3 Skim the renamed alert-evaluation.test.ts throw-path test assertions
- [ ] 1.4 Skim test-plan.md §6.1/§6.3 cookbook text for accuracy
