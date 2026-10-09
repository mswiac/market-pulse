# Close Remaining Worker Test Gaps — Plan Brief

> Full plan: `context/changes/worker-test-gaps/plan.md`

## What & Why

Add worker integration tests for the three business-relevant gaps a coverage run found (GitHub #187), plus a repeatable `test:worker:coverage` script. The failure email and the admin cron route are the safety net for cron problems, so their error paths should be proven, not assumed.

## Starting Point

`src/worker` is at 98.4% lines / 95.0% branches. Uncovered: the per-alert catch in `alert-evaluation.ts`, the 500 branch of `POST /api/admin/cron/run`, and the rejecting-refresh path when creating an alert. Coverage was measured with a locally installed, unpinned istanbul package.

## Desired End State

Those three paths have tests that assert outcomes (summary, response, email text, DB state). `npm run test:worker:coverage` reproduces the numbers.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Scope | 3 gaps + coverage script | User chose to include the script; Stryker deferred to a whole-worker run | Plan |
| Phases | One phase, one commit | Four tests plus config, LOW complexity | Plan |
| Email proof | Test both in evaluation and in scheduled | Proves the error reaches the #172 notice | Plan |
| Verification | Later whole-worker Stryker, no manual break-verify | User choice | Plan |

## Scope

**In scope:** four tests, coverage script and config, matching devDependency.
**Out of scope:** production code, trivial error responses, Stryker, coverage thresholds.

## Architecture / Approach

Reuse each suite's existing helpers. Force failures without touching source: a text `high` value for the evaluation throw, `DB.prepare` spies for the other two.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tests and coverage script | 4 tests, `test:worker:coverage` | Matching coverage package may still need `--legacy-peer-deps`; then stop and ask |

**Prerequisites:** none. **Estimated effort:** ~1 session.

## Open Risks & Assumptions

- Tests that go green without exercising the catch would be caught only by the later Stryker run.
- The devDependency install may conflict on peers; the plan stops and asks rather than adding the flag.

## Success Criteria (Summary)

- All worker tests pass and coverage shows the three paths covered.
- `npm ci` still works locally and in CI.
