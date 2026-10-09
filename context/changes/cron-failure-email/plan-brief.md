# Cron Failure Email — Plan Brief

> Full plan: `context/changes/cron-failure-email/plan.md`

## What & Why

Email the admin when a scheduled cron invocation has problems, so failures that occur while nobody is using the admin panel are not visible only in the Cloudflare log (GitHub issue #172).

## Starting Point

`handleCron` discards the results of the fetch and evaluation phases. `evaluateAlerts` hides a failed alert load behind an empty clean summary and skips stale-data alerts with only a log warning.

## Desired End State

Each cron invocation with any problem sends one email to `RESEND_VERIFIED_EMAIL` naming the phase and the problems. A failed send is logged and ignored. The manual admin run sends nothing.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Threshold | Any problem | Single user; at most 3 mails a day; partial failures are the silent ones to catch |
| Problems covered | Ticker errors, instrument load error, failed alert emails, alert-load failure, stale data, unexpected exceptions | All are invisible when no one clicks in the panel |
| Send failure | Log only, no retry | Matches the issue; no extra subrequests |
| Content | Phase + problem list, max 20 lines | Cause is visible without opening logs |
| Where | `handleCron` only | Admin route already shows failures in its 207 response |
| Dedup | Date in subject | Resend dedups identical payloads for 24 h |

## Scope

**In scope:** problem reporting in evaluation, notifier, `handleCron` wiring, tests, short docs.
**Out of scope:** recurring-failure tracking, retries, end-user notices, mail from the manual run.

## Architecture / Approach

Phases report problems in their return values; `handleCron` collects them and calls `notifyCronFailure`, which sends through the existing Resend batch helper and never throws. Unexpected exceptions are notified and rethrown.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Evaluation reports every problem | Load failure and stale tickers appear in `errors` | Admin run now shows 207 for stale data (intended) |
| 2. Failure notice from handleCron | Notifier, wiring, tests, docs | Subrequest budget (about 44 of 50 worst case) |

**Prerequisites:** none. **Estimated effort:** about 2 sessions.

## Open Risks & Assumptions

- Persistent provider failure for one ticker mails daily; accepted.
- Mail goes only to `RESEND_VERIFIED_EMAIL` until a custom domain is verified.

## Success Criteria (Summary)

- A forced failure produces a correct email; a clean run produces none.
- Cron outcome is unchanged when the notice cannot be sent.
