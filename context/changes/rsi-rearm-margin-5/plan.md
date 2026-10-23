# Reduce RSI Alert Re-arm Margin to 5 Points Implementation Plan

## Overview

RSI alerts re-arm once the RSI retreats a fixed number of points past the threshold. Lower that margin from 10 to 5 points so a fired alert becomes active again sooner (GitHub issue #230). PRICE alerts are untouched.

## Current State Analysis

- `RSI_RE_ARM_MARGIN_POINTS = 10` (`src/worker/lib/alert-evaluation.ts:6`) is read in one place, the RSI branch of the margin calculation in `evaluateAlerts`.
- Two worker tests encode the 10-point value: `test/worker/alert-evaluation.test.ts` "uses a fixed 10-point margin for RSI alerts instead of 10% of threshold" and "re-arms an RSI alert once it retreats past the fixed 10-point margin".
- No documentation, README or UI copy mentions the RSI margin (checked `context/foundation`, `README.md`, `src/app`, `e2e`).

## Desired End State

A `down` RSI alert at 35 that has fired re-arms at RSI >= 40 (was 45); an `up` alert at 70 re-arms at RSI <= 65 (was 60). Verified by the updated worker tests.

### Key Discoveries:

- Re-arm uses the close-based RSI value and `hasRetreatedPastMargin` (`alert-evaluation.ts:90`); only the constant changes, no logic.
- Extreme thresholds (down <= 5, up >= 95) can still make re-arming unreachable, as today. Accepted, not handled (decided during planning).

## What We're NOT Doing

- No change to the PRICE margin (10% of threshold).
- No per-alert or configurable margin.
- No clamping of the margin to the 0-100 range.
- No documentation changes (nothing references the margin).

## Implementation Approach

Change the constant, then update the two tests whose values and names depend on it.

## Phase 1: Lower the RSI margin and update tests

### Overview

One constant and two tests.

### Changes Required:

#### 1. Margin constant

**File**: `src/worker/lib/alert-evaluation.ts`

**Intent**: Set the fixed RSI re-arm margin to 5 points.

**Contract**: `RSI_RE_ARM_MARGIN_POINTS` equals 5; the existing comment about RSI being a bounded 0-100 index stays accurate.

#### 2. Worker tests

**File**: `test/worker/alert-evaluation.test.ts`

**Intent**: Make both RSI-margin tests assert the 5-point behavior while still proving the margin is fixed points rather than a percentage of the threshold.

**Contract**:
- Rename "fixed 10-point" to "fixed 5-point" in both test titles and comments.
- Low-threshold test (threshold 7, `up`): re-arm now needs rsi <= 2; the seeded rsi 5 must still leave the alert disarmed (a 10%-of-threshold margin of 0.7 would have re-armed it, so the test still discriminates). Update the arithmetic in the comments.
- Re-arm test (threshold 70, `up`): re-arm now needs rsi <= 65. The "not enough" step moves from 65 to a value above 65 (e.g. 68) and the re-arm step from 60 to 65.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Type checking and lint pass: `npm run build`

#### Manual Verification:

- None needed; behavior is fully covered by the worker tests.

---

## Testing Strategy

### Unit Tests:

- The two updated RSI-margin tests above; other tests use PRICE alerts or do not depend on the RSI margin value.

## References

- GitHub issue: #230
- Margin logic: `src/worker/lib/alert-evaluation.ts:5-6,90-97,214-233`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Lower the RSI margin and update tests

#### Automated

- [x] 1.1 Worker tests pass: `npm run test:worker`
- [x] 1.2 Type checking and lint pass: `npm run build`
