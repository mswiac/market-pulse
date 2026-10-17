# Post-release hardening Implementation Plan

## Overview

Close the gaps found after the #214/#218, #216, #220 and #222 releases (GitHub issue #224): run a scoped mutation sweep on the changed worker files and kill meaningful survivors, then update two foundation docs.

## Current State Analysis

- The recent worker changes (single RSI calculation, grouped alert email with the deepest threshold, transient vs permanent failure per group, `MON-FRI` crons) are covered by worker integration tests, but no Stryker run has looked at the new tests.
- The e2e task in the issue is already done: `e2e/admin/add-instrument.spec.ts` has the test "a currency corrected to Yahoo's is reported in the success message", which asserts the full Polish notice (`Waluta poprawiona z PLN na USD (według Yahoo)`) with a mocked response.
- `context/foundation/app-overview.md` does not mention grouped emails. `context/foundation/test-plan.md` §8 changelog has no entries for the grouping tests, the `MON-FRI` assertion or the sweep.

## Desired End State

- Stryker has been run on the four changed worker files; every survivor is either killed by a new assertion or listed as an accepted equivalent in the test-plan changelog entry.
- `app-overview.md` states the grouping behaviour; `test-plan.md` has the changelog entries.
- No production code changes.

### Key Discoveries:

- Worker Stryker profile needs `vitest.related: false` (already set); full suite runs per mutant, so scope strictly: `context/foundation/stryker-notes.md`.
- `scheduled.ts` is out of scope: the cron constants are literals already guarded by the `MON-FRI` test.

## What We're NOT Doing

- No e2e changes (assertion already exists; e2e never runs the cron or grouping).
- No README change (it lists cron times, not weekdays).
- No chasing a 100% score; no production code changes.
- No Angular Stryker run (the only UI change, #216, already has component and e2e coverage).

## Implementation Approach

Test-only sweep first, then docs, so the changelog entry can quote the real before/after numbers.

## Phase 1: Scoped mutation sweep

### Overview

Run Stryker on the changed worker files, triage survivors, add assertions for the meaningful ones.

### Changes Required:

#### 1. Worker tests

**File**: `test/worker/alert-evaluation.test.ts`, `test/worker/price-history.test.ts`, `test/worker/instruments.test.ts`, `test/worker/market-data.test.ts` (whichever covers each mutated file)

**Intent**: Kill survivors that represent user-visible or business-relevant bugs, namely grouping of alerts per user+instrument, picking the deepest crossed threshold, and transient vs permanent failure handling per group. Document harmless equivalents rather than asserting on them.

**Contract**: Test files only. Run: `npx stryker run --mutate "src/worker/lib/alert-evaluation.ts,src/worker/lib/market-refresh.ts,src/worker/lib/price-history.ts,src/worker/routes/instruments.ts"`. Record score before/after per file for the changelog.

### Success Criteria:

#### Automated Verification:

- Worker tests pass: `npm run test:worker`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Stryker re-run on the same scope shows no unexplained survivors in grouping, deepest-threshold or failure-handling logic

#### Manual Verification:

- Survivor triage list reviewed (killed vs accepted equivalent) and agreed

---

## Phase 2: Documentation

### Overview

Describe the grouped email behaviour and log the work.

### Changes Required:

#### 1. App overview

**File**: `context/foundation/app-overview.md`

**Intent**: One sentence under Alerts (or a short note near it): alerts that fire together for one user on one instrument produce a single email naming the deepest crossed threshold, while history keeps one row per alert.

**Contract**: Prose edit in English; no other sections touched.

#### 2. Test plan changelog

**File**: `context/foundation/test-plan.md`

**Intent**: Append dated entries to §8 Freshness Ledger for: grouping tests (#212/#220), the `MON-FRI` regression assertion (#210/#222), and this Stryker sweep with before/after scores and accepted equivalents. State that the issue's e2e item was already covered. No risk-map delta.

**Contract**: Same bullet style as the existing 2026-10-xx entries.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`

#### Manual Verification:

- Docs read correctly and match the shipped behaviour

---

## Testing Strategy

Test-only change; the mutation run itself is the verification. Deliberate-break check for any new assertion that is not obviously tied to a mutant.

## References

- Issue: https://github.com/mswiac/market-pulse/issues/224
- `context/foundation/stryker-notes.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scoped mutation sweep

#### Automated

- [x] 1.1 Worker tests pass — 97410a6
- [x] 1.2 Typecheck passes — 97410a6
- [x] 1.3 Lint passes — 97410a6
- [x] 1.4 Stryker re-run shows no unexplained survivors in grouping, deepest-threshold or failure-handling logic — 97410a6

#### Manual

- [x] 1.5 Survivor triage list reviewed — 97410a6

### Phase 2: Documentation

#### Automated

- [x] 2.1 Lint passes — 8966e51

#### Manual

- [x] 2.2 Docs read correctly and match the shipped behaviour — 8966e51
