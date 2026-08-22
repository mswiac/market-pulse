# Notification/Evaluation Pipeline Regression Audit — Plan Brief

> Full plan: `context/changes/notification-pipeline-test-audit/plan.md`

## What & Why

Test-plan.md ranks two risks highest: (#1) the S-08 high/low firing logic
in `alert-evaluation.ts` has no independent oracle, and (#2) an uncaught
`fetch` throw inside `resend.ts` can silently drop a notification with
zero trace. This change fixes the real code gap behind #2 and closes every
named untested branch behind both risks.

## Starting Point

`resend.ts`'s `fetch()` call is unguarded — a network-level throw
propagates out of `sendAlertEmail`, is swallowed by a generic
`console.error` in `alert-evaluation.ts`, and leaves zero `trigger_events`
record. The existing test for this path (`alert-evaluation.test.ts:251`)
currently asserts that behavior as correct, effectively locking the bug in.

## Desired End State

A thrown `fetch` is caught, tagged `transient: true`, and recorded as a
`failed` `trigger_events` row — but the alert stays armed so tomorrow's
cron retries naturally. `buildEmail` is exported and unit-tested for every
high/low presence combination. `resend.ts` gets a dedicated test file.
`rsi.ts`'s `avgGain === 0` branch is covered. `test-plan.md` reflects that
Phase 1 shipped.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Transient vs. permanent send failure | Distinguish via a `transient` flag; only permanent failures disarm | A naive "always disarm on failure" fix makes transient-blip delivery *worse* than today's accidental armed-and-retry-tomorrow behavior | Plan |
| Retry inside `resend.ts` | No retry loop | Added CPU cost per failed send isn't worth it at current single-user MVP scale; record-and-let-cron-retry is simpler | Plan |
| Test file layout | New `test/worker/resend.test.ts`, export `buildEmail` for direct testing | Matches the existing one-file-per-module convention (`rsi.ts`→`rsi.test.ts`) and is the cheapest test per test-plan's cost×signal principle | Plan |
| `market-data.ts` fetch-throw | Document only, no new test | Already provably caught by `scheduled.ts`'s retry + outer catch — a new test would just prove `try/catch` works | Plan |
| `test-plan.md` cookbook | Fill in §6.1/§6.3 + flip Phase 1 status now | The doc's own convention says cookbook fills in once the phase ships | Plan |

## Scope

**In scope:** `resend.ts` fetch-throw fix, `alert-evaluation.ts` conditional
disarm + `buildEmail` export, new `resend.test.ts`, `alert-evaluation.test.ts`
updates (renamed throw-path test + new `buildEmail` tests), `rsi.ts`
`avgGain === 0` test, `test-plan.md` Phase 1 status + §6.1/§6.3 cookbook.

**Out of scope:** retry logic in `resend.ts`, a new `market-data.ts`
regression test, changes to the non-ok-response/unverified-recipient
disarm behavior, e2e/live-Resend testing.

## Architecture / Approach

`SendEmailResult`'s failure variant gains an optional `transient?: boolean`.
`alert-evaluation.ts`'s firing branch conditionally omits the
`UPDATE alerts SET armed = 0` statement from its `env.DB.batch(...)` call
when the failure is transient — same pattern `scheduled.ts` already uses
for its optional currency-correction statement.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fetch-throw fix, transient-aware disarm, full test closure | Code fix + all new/updated tests + doc update | Getting the transient/permanent disarm split wrong could regress today's accidental retry-tomorrow behavior |

**Prerequisites:** none — self-contained within `src/worker/lib/` and its tests.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes a rejecting `fetch()` in workerd surfaces the same way Node's
  `fetch` does (a thrown `TypeError`/`Error`, not a resolved error
  `Response`) — matches the existing `stubFetchThrowingFor` test helper's
  assumption, already in use in this test suite.

## Success Criteria (Summary)

- `npm run typecheck && npm run test:worker` pass.
- A transient send failure is recorded but the alert stays armed; a
  permanent one still disarms as today.
- Every named untested branch from test-plan.md §2 rows #1/#2 has a test.
