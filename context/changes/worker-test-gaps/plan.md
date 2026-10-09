# Close Remaining Worker Test Gaps Implementation Plan

## Overview

A one-off istanbul coverage run of `src/worker` (350 tests) showed 98.4% lines / 95.0% branches. The remaining uncovered lines are almost all defensive catch blocks; three of them are business-relevant (GitHub issue #187). This change adds worker integration tests for those three, and a permanent `test:worker:coverage` script so the measurement is repeatable.

## Current State Analysis

- `evaluateAlerts` wraps each alert in a try/catch that pushes `alert <id>: <error>` into `errors` (`src/worker/lib/alert-evaluation.ts:180-183`). No test makes one alert throw, so neither the continue-with-other-alerts behavior nor the path into the failure email (#172) is proven.
- `POST /api/admin/cron/run` returns 500 `cron_run_failed` when a phase throws (`src/worker/routes/admin.ts:137-139`). Untested.
- `ensureFreshMarketData` swallows a rejected `refreshInstruments` and lets the alert be created from stale data (`src/worker/routes/alerts.ts:139-142`). Only the "refresh returns an error" case is tested, not "refresh rejects".
- Coverage on workerd needs the istanbul provider (v8 is unsupported by the workers pool). `@vitest/coverage-istanbul` is not in `package.json`; it was installed locally only and the local copy (4.1.10) does not match `vitest` 4.1.11.

### Key Discoveries:

- A non-numeric `market_data.high` (SQLite is dynamically typed) makes `buildEmail` throw `TypeError` for exactly one alert, with no source mocking: use direction `down` so the firing value is `low` and the broken `high` is only touched by `buildEmail`.
- An exception outside `evaluateAlerts`' own try/catch is produced by a `vi.spyOn(env.DB, 'prepare')` that throws for `UPDATE alerts` while a disarmed alert is re-armed. The pattern already exists in `test/worker/scheduled.test.ts` (cron failure notice suite).
- A rejected `refreshInstruments` is produced by a `prepare` spy that throws for `INSERT INTO price_history` (the upsert statements are built outside its try blocks) with `fullWindow: true`, which skips `loadStoredCloses`.
- `vitest.config.mts` has no `coverage` block yet; `include` is `test/worker/**/*.test.ts`.

## What We're NOT Doing

- No production code changes.
- No tests for trivial error responses (bad JSON, duplicate email/ticker, 404s), the documented "unreachable" empty-closes guard, or live provider contract tests.
- No Stryker run in this change: the whole-worker Stryker run is a separate step after this lands.
- No manual break-verify of each new test against the source; mutation coverage is checked by that later Stryker run.
- No coverage threshold or CI gate for coverage.

## Implementation Approach

One phase, one commit. Add four tests following the existing helpers of each suite, then add the coverage script and config. Each test asserts observable outcomes (summary, HTTP response, email body, DB state), not the log call.

## Phase 1: Tests and coverage script

### Overview

Close the three gaps and make coverage measurable with one command.

### Changes Required:

#### 1. Per-alert evaluation failure

**File**: `test/worker/alert-evaluation.test.ts`

**Intent**: Prove that one throwing alert is reported in `errors` and does not stop the others.

**Contract**: New `describe` with one test. Two alerts: `^VIX` with `direction: 'down'`, armed, and `market_data.high` stored as text; `^NDX` healthy, armed, crossing. Assert `alertsEvaluated` is 2, `errors` has exactly one entry starting `alert <brokenId>: TypeError`, `emails` contains only the healthy alert as `sent`, the broken alert stays armed and the healthy one is disarmed.

#### 2. Per-alert failure reaches the failure email

**File**: `test/worker/scheduled.test.ts`

**Intent**: Prove the same failure appears in the cron failure notice of the evaluation run (#172).

**Contract**: New test in the `cron failure notice` suite using its `stubYahooAndResend` and `noticeBody` helpers. Seed the broken-high alert, run `handleCron(EVALUATE_CRON, env)`, assert exactly one Resend call (the notice) whose text contains `alert <id>: TypeError`.

#### 3. Admin cron run 500

**File**: `test/worker/admin.test.ts`

**Intent**: Cover the `cron_run_failed` branch.

**Contract**: New test in `POST /api/admin/cron/run`: disarmed alert with a retreated price, `prepare` spy throwing on `UPDATE alerts`, `phase: 'evaluate'`. Assert status 500 and body `{ error: 'cron run failed', code: 'cron_run_failed' }`. Restore the spy in `finally`.

#### 4. Refresh rejects on alert create

**File**: `test/worker/alerts.test.ts`

**Intent**: Prove an alert is still created from stale data when the refresh rejects, not just when it returns an error.

**Contract**: New test next to "still creates the alert from the stale data when the refresh fails": stale `^VIX` row, Yahoo stub returning a valid close, `prepare` spy throwing on `INSERT INTO price_history`. Assert 201, `active: false`, `currentPrice` equal to the stale value, and that the failure was logged for `^VIX`.

#### 5. Permanent coverage script

**File**: `package.json`, `vitest.config.mts`, `package-lock.json`

**Intent**: One repeatable command for worker coverage.

**Contract**: Add `@vitest/coverage-istanbul` as a devDependency at the exact `vitest` version in the lockfile, and a script `test:worker:coverage` = `vitest run --coverage`. In `vitest.config.mts` add `test.coverage` with `provider: 'istanbul'`, `include: ['src/worker/**']`, text reporter. `npm ci` must keep working with the lockfile unchanged otherwise. If the matching version still needs `--legacy-peer-deps` to install, stop and ask instead of adding that flag to the project.

### Success Criteria:

#### Automated Verification:

- New and existing worker tests pass: `npm run test:worker`
- Coverage run works and reports `src/worker`: `npm run test:worker:coverage`
- Clean install resolves with the new devDependency: `npm ci --dry-run`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`

#### Manual Verification:

- Coverage report no longer lists `alert-evaluation.ts:181-182`, `admin.ts:137-140` and `alerts.ts:139-142` as uncovered.
- GitHub Actions `npm ci` still succeeds on the PR (CI uses the pinned npm 11).

**Implementation Note**: After automated verification passes, pause for manual confirmation before the phase commit.

---

## Testing Strategy

### Integration Tests:

- Per-alert exception: summary, email body, alert state.
- Admin cron route 500.
- Alert create with a rejecting refresh.

### Manual Testing Steps:

1. Run `npm run test:worker:coverage` and check the three line ranges above are covered.

## References

- GitHub issue #187
- Coverage baseline: 98.41% lines, 94.97% branches (`src/worker`, istanbul)
- Similar patterns: `test/worker/scheduled.test.ts` (`cron failure notice`), `test/worker/alerts.test.ts` ("still creates the alert from the stale data when the refresh fails")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tests and coverage script

#### Automated

- [x] 1.1 New and existing worker tests pass: `npm run test:worker` — 7c60c89
- [x] 1.2 Coverage run works and reports `src/worker`: `npm run test:worker:coverage` — 7c60c89
- [x] 1.3 Clean install resolves with the new devDependency: `npm ci --dry-run` — 7c60c89
- [x] 1.4 Typecheck passes: `npm run typecheck` — 7c60c89
- [x] 1.5 Lint passes: `npm run lint` — 7c60c89

#### Manual

- [x] 1.6 Coverage report no longer lists the three target line ranges as uncovered — 7c60c89
- [ ] 1.7 GitHub Actions `npm ci` still succeeds on the PR
