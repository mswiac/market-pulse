# Full-repo Stryker run and tests for surviving mutants Implementation Plan

## Overview

Produce the first whole-project mutation baseline (worker + Angular), triage every surviving mutant, and add tests only for survivors that represent a real, business-relevant regression. Delivered as one PR (GitHub issue #190).

## Current State Analysis

- No full baseline exists. The only recent measurement is a 2-file worker run (`scheduled.ts` 91.04%, `cron-failure-notice.ts` 77.78%).
- Worker profile (`stryker.config.json`) runs the full worker suite per mutant (`vitest.related: false`), concurrency 4.
- Angular profile (`stryker.config.app.json`) runs `npm run test:ci` per mutant (command runner, `coverageAnalysis: off`), concurrency 2. Mutants that only break types show as "Survived".
- `thresholds.break` is `null` in both profiles; `/reports` and `.stryker-tmp/` are gitignored.
- #187 closed the remaining worker integration-test gaps, so the survivors now reflect assertion quality rather than missing coverage.

## Desired End State

- Mutation scores per file for both profiles are recorded in `context/changes/full-repo-stryker-run/triage.md`.
- Every survivor is classified: killed by a new test, or left with a written reason (noise, equivalent, type-only).
- A scoped control run on the files that received tests shows the targeted survivors killed.
- `npm run test:worker` and `npm run test:ci` stay green.

## What We're NOT Doing

- Chasing 100% or setting `thresholds.break`.
- Writing tests for equivalent mutants, log-text noise, or defaults with no observable effect.
- Changing production code, unless a survivor exposes a real bug (then stop and raise it with the user).
- Running both profiles in parallel.
- Narrowing the Angular scope to a subset of files.

## Implementation Approach

Run the worker profile to completion in the background, then the Angular profile, one at a time. Triage from the clear-text/html reports, deciding relevance independently (no mid-way checkpoint with the user). Write the tests as additional assertions or cases in existing test files, then re-run Stryker narrowed to just those files.

## Critical Implementation Details

- **Run duration**: the Angular run reruns the whole `ng test` per mutant and may take many hours. Run it as a background command with output in `$TMPDIR`, wait with an until-loop, and never chain `sleep` before commands.
- **Type-only survivors**: in the Angular report, a survivor that could only fail type checking must be hand-verified with a cold build before it is treated as a test gap or as noise.
- **Long survivor list**: if the business-relevant list exceeds roughly 25 survivors, finish the highest-value ones in this PR, list the rest in `triage.md`, and open a follow-up issue instead of widening the PR.
- **No parallel Stryker processes**: each invocation uses `.stryker-tmp/`; a second one would corrupt it.

## Phase 1: Full-repo run, triage, and survivor tests

### Overview

Everything in one phase: two sequential full runs, the triage record, the new tests, and the control run.

### Changes Required:

#### 1. Worker mutation run

**Intent**: Establish the worker baseline.

**Contract**: `npx stryker run` (profile `stryker.config.json`, default `src/worker/**/*.ts`), output captured to `$TMPDIR`; report in `reports/mutation/` (gitignored).

#### 2. Angular mutation run

**Intent**: Establish the Angular baseline after the worker run has finished.

**Contract**: `npx stryker run stryker.config.app.json` (default `src/app/**/*.ts` minus specs), output captured to `$TMPDIR`.

#### 3. Triage record

**File**: `context/changes/full-repo-stryker-run/triage.md`

**Intent**: Record per-file scores for both profiles and one row per survivor: location, mutation, decision (test / leave), and reason.

**Contract**: English markdown; tables `Worker scores`, `Angular scores`, `Survivors`; a closing section listing survivors left with their reason.

#### 4. New tests for business-relevant survivors

**Files**: existing `test/worker/*.test.ts` and `src/app/**/*.spec.ts` as the survivors dictate.

**Intent**: Add assertions or cases that fail when the mutant is applied. Known candidates from the issue: the `status === 'failed'` email filter in `scheduled.ts`, the group join separator, the scope default `'alerts'`, user-visible notice subject/log text.

**Contract**: tests only, `src/` production code unchanged; follow each file's existing structure and naming.

#### 5. Scoped control run

**Intent**: Prove the new tests kill their survivors.

**Contract**: `npx stryker run --mutate "<touched worker files>"` and/or `npx stryker run stryker.config.app.json --mutate "<touched app files>"` (multi-range allowed); scores appended to `triage.md`.

### Success Criteria:

#### Automated Verification:

- Worker full run completes and per-file scores are recorded in `triage.md`
- Angular full run completes and per-file scores are recorded in `triage.md`
- Every survivor has a decision row in `triage.md`
- New tests pass: `npm run test:worker` and `npm run test:ci`
- Lint passes: `npm run lint`
- Scoped control run shows the targeted survivors killed

#### Manual Verification:

- Triage table reviewed in the PR: relevance calls and left-out reasons are acceptable

**Implementation Note**: Manual verification is batched at the end of implementation (user preference); do not pause mid-phase for it.

---

## Testing Strategy

### Unit Tests:

- Added only per business-relevant survivor; each must fail against its mutant (proved by the control run).

### Integration Tests:

- Worker tests keep dispatching through `exports.default.fetch()` / `handleCron` as they do today.

### Manual Testing Steps:

1. Read `triage.md` in the PR and challenge any "leave" decision that looks business-relevant.

## Performance Considerations

Full runs are slow (worker: 354 tests per mutant; Angular: whole `ng test` per mutant). Run once each, in the background, sequentially.

## References

- Issue: #190 (follow-up to #187)
- Mutation notes: `context/foundation/stryker-notes.md`
- Configs: `stryker.config.json`, `stryker.config.app.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Full-repo run, triage, and survivor tests

#### Automated

- [x] 1.1 Worker full run completes and per-file scores are recorded in triage.md
- [x] 1.2 Angular full run completes and per-file scores are recorded in triage.md
- [x] 1.3 Every survivor has a decision row in triage.md
- [x] 1.4 New tests pass with npm run test:worker and npm run test:ci
- [x] 1.5 Lint passes with npm run lint
- [x] 1.6 Scoped control run shows the targeted survivors killed

#### Manual

- [ ] 1.7 Triage table reviewed in the PR: relevance calls and left-out reasons are acceptable
