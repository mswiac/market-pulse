# Cron MON-FRI Implementation Plan

## Overview

Replace the numeric day-of-week range `1-5` in the three cron triggers with the named range `MON-FRI`, so the fetch and evaluation crons run Monday–Friday instead of Sunday–Thursday (GitHub issue #210).

## Current State Analysis

Cloudflare numbers days of the week from Sunday (`1` = SUN), so `1-5` means Sunday–Thursday. All three crons ran Sun–Thu and never on Friday; Friday's close is only picked up on Sunday evening, so alerts crossed on Friday fire about two days late.

## Desired End State

`wrangler.toml` and the schedule constants in the Worker declare `MON-FRI`; after deploy, Settings → Triggers shows "Monday through Friday" and the crons run on Friday evening.

### Key Discoveries:

- `wrangler.toml:17` declares the three schedules.
- `src/worker/scheduled.ts:39-41` holds `PL_FETCH_CRON`, `US_FETCH_CRON`, `EVALUATE_CRON`; `handleCron` routes on exact string match, so both places must change together.
- `test/worker/scheduled.test.ts:1029` only asserts that the toml and the constants agree, so `1-5` would pass in both places.
- `context/foundation/infrastructure.md:130` carries the same `1-5` in a copy-paste example.

## What We're NOT Doing

- Changing the run times (16:30 / 23:00 / 23:15 UTC).
- Touching archived plans that mention `1-5`.
- Handling market holidays.

## Implementation Approach

Mechanical string change in four places, plus one assertion that guards against numeric day ranges coming back.

## Phase 1: Switch the crons to MON-FRI

### Overview

Change the schedules, the constants, the docs example and add the regression assertion.

### Changes Required:

#### 1. Schedules and constants

**File**: `wrangler.toml`, `src/worker/scheduled.ts`

**Intent**: Use named days so the range cannot be misread again.

**Contract**: the three expressions become `30 16 * * MON-FRI`, `0 23 * * MON-FRI`, `15 23 * * MON-FRI` in both files, identical strings.

#### 2. Regression test

**File**: `test/worker/scheduled.test.ts`

**Intent**: Fail if any cron's day-of-week field is not the named `MON-FRI`.

**Contract**: in the `cron expressions` describe, one test asserting the fifth field of `PL_FETCH_CRON`, `US_FETCH_CRON` and `EVALUATE_CRON` equals `MON-FRI`.

#### 3. Docs example

**File**: `context/foundation/infrastructure.md`

**Intent**: Remove the same Sunday–Thursday trap from the copy-paste example (line 130).

**Contract**: `crons = ["0 18 * * MON-FRI"]`.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- After deploy, Settings → Triggers reads "Monday through Friday"
- The Friday crons (16:30, 23:00, 23:15 UTC) show up in Workers Observability

## Testing Strategy

### Unit Tests:

- Existing toml ↔ constants agreement test stays.
- New assertion that the day-of-week field is `MON-FRI`.

## Migration Notes

No migration. Deploy is required for Cloudflare to re-register the triggers (`npm run deploy`).

## References

- GitHub issue #210

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Switch the crons to MON-FRI

#### Automated

- [x] 1.1 Worker tests pass
- [x] 1.2 Type checking passes
- [x] 1.3 Linting passes

#### Manual

- [ ] 1.4 After deploy, Settings → Triggers reads "Monday through Friday"
- [ ] 1.5 The Friday crons show up in Workers Observability
