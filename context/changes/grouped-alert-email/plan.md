# Grouped Alert Email Implementation Plan

## Overview

When several armed alerts of the same kind fire in the same evaluation run, send one email per group instead of one per alert. The email shows the deepest crossed threshold; every alert of the group is disarmed and keeps its own `trigger_events` row. Source: GitHub issue #212.

## Current State Analysis

`evaluateAlerts` (`src/worker/lib/alert-evaluation.ts`) pushes every armed alert whose condition is met into `pendingSends` on its own. Each entry becomes one email in one `sendAlertEmailBatch` call, one `trigger_events` row, and one id in `disarmIds`. Three RSI alerts at 40/39/38 with RSI 37 therefore produce three identical emails.

The rest of the pipeline is already batched: one Resend batch request, one `env.DB.batch` for event inserts, disarms and re-arms. Grouping only shrinks the number of emails in that batch, so D1/subrequest usage does not grow.

## Desired End State

- One email per group, where a group is the alerts that fire together with the same `user_id`, `ticker`, `alert_type`, `direction` and `notification_email`.
- The email is built for the group's deepest alert (`down`: lowest threshold, `up`: highest) and reads exactly as a single-alert email does today.
- One `trigger_events` row per alert; all rows of a group share `email_status` / `email_error`.
- Transient send failure keeps the whole group armed; any other outcome disarms the whole group.
- A single alert behaves exactly as before.

### Key Discoveries:

- `src/worker/lib/alert-evaluation.ts:187-193` is the only place alerts are queued for sending; `pendingSends` is consumed at lines 212-287.
- Within a group the firing value is identical for every alert: `resolveFiringValue` depends only on type, direction and the ticker's market snapshot, so one `value` and one set of high/low serves the whole group.
- `AlertEvaluationSummary.emails` (one entry per alert) is read by `scheduled.ts`, `routes/admin.ts` and the Angular cron-run page; keeping one entry per alert leaves that contract untouched.
- The existing test "sends every firing alert in a single Resend request..." (`test/worker/alert-evaluation.test.ts:355`) seeds two same-user, same-direction VIX alerts (20 and 21) and will now correctly produce two events but one email; it must be adjusted.

## What We're NOT Doing

- No change to the email subject or body, and no mention of the other alerts in the group.
- No change to re-arming: each alert re-arms on its own.
- No change to the `emails` summary shape, to `trigger_events` schema, or any migration.
- No UI changes.

## Implementation Approach

After the per-alert loop has collected firing alerts, group them by the key and pick the representative alert per group. Send one `SendEmailInput` per group. Fan the group's result back out to every member when building event rows, the disarm list, and the summary entries.

## Critical Implementation Details

- **State sequencing** — the transient-failure rule must be evaluated per group, not per alert: if the group's result is a transient failure, none of its alerts is added to `disarmIds`, yet each still gets its `failed` event row, as a single alert does today.
- **Ties** — two alerts of one group with the same threshold are possible; either may be the representative, since the email is identical.

## Phase 1: Group firing alerts into one email

### Overview

Replace the per-alert `pendingSends` with per-group sends and adapt tests.

### Changes Required:

#### 1. Grouping in evaluateAlerts

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Collect firing alerts into groups keyed by user, ticker, alert type, direction and notification email, choose the deepest-threshold alert as the group's representative, and build one email per group from it.

**Contract**: `PendingSend` describes a group: its member alerts, the shared firing `value`, and the single `input` built by `buildEmail(representative, value)`. `sendAlertEmailBatch` receives one input per group, and `sendResults[i]` maps to group `i`. `buildEmail` and `AlertEvaluationSummary` keep their signatures.

#### 2. Fan the group result out to its alerts

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: For every member of a group, add one event row (own threshold, shared value, shared status/error), disarm it unless the group's failure was transient, and push one `emails` summary entry with the group's status or the write error.

**Contract**: `eventRows`, `disarmIds` and the final `emails` list are built by iterating groups then members; the single `env.DB.batch` call and its statements are unchanged in shape.

#### 3. Tests

**File**: `test/worker/alert-evaluation.test.ts`

**Intent**: Cover the issue's acceptance criteria and fix the test the new behavior invalidates.

**Contract**: New cases: RSI 40/39/38 down with RSI 37 gives one email mentioning threshold 38 and value 37, three disarmed alerts, three event rows; an `up` group picks the highest threshold; alerts differing in ticker, type, direction, user or notification email are not merged; a single alert is unchanged; a transient failure (5xx / thrown batch) leaves every alert of the group armed with all rows `failed`; a permanent failure (unverified recipient) disarms the whole group; PRICE alerts group the same way (100/99/98) using the day's low; summary has one entry per alert. Adjust "sends every firing alert in a single Resend request..." so its expectations match one email per group.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- In the admin panel, seed three armed RSI "down" alerts for one instrument and trigger a manual cron run: one email arrives mentioning the lowest crossed threshold, all three alerts show as triggered, and the history shows three events

---

## Testing Strategy

### Unit Tests:

- Grouping key boundaries (ticker, type, direction, user, notification email) and the deepest-threshold choice for both directions.
- Transient versus permanent failure applied to the whole group.

### Manual Testing Steps:

1. Create three RSI "down" alerts (e.g. 40/39/38) on one instrument whose current RSI is below all three.
2. Run the manual cron from the admin panel.
3. Check that one email arrives and the alerts page and history show three triggered alerts.

## Performance Considerations

Fewer emails per run lowers the Resend batch size; the D1 statement count is unchanged, so the Workers Free limits (50 subrequests, 10 ms CPU on `scheduled()`) are not affected.

## References

- GitHub issue #212
- Current logic: `src/worker/lib/alert-evaluation.ts:168-293`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Group firing alerts into one email

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [ ] 1.4 Manual cron run with three armed RSI "down" alerts sends one email with the lowest crossed threshold, disarms all three and records three history events
