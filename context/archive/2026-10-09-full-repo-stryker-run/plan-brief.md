# Full-repo Stryker run and tests for surviving mutants — Plan Brief

> Full plan: `context/changes/full-repo-stryker-run/plan.md`

## What & Why

Get the first whole-project mutation baseline for the worker and Angular code, then add tests only where a surviving mutant would let a real regression through. Several areas changed since the last runs (cron failure email, per-market refresh, admin cron route) and #187 closed the test gaps, so this checks whether the tests actually assert behavior.

## Starting Point

Only a 2-file worker run exists (`scheduled.ts` 91.04%, `cron-failure-notice.ts` 77.78%). Both Stryker profiles are configured; `thresholds.break` is null.

## Desired End State

Per-file scores for both profiles and a decision for every survivor are recorded in `triage.md`. Business-relevant survivors are killed by new tests, confirmed by a scoped control run. Both test suites stay green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Angular scope | Whole `src/app` | Matches the issue and gives a complete baseline. |
| Run order | Worker, then Angular, sequential | Avoids CPU contention and false survivors from timeouts. |
| Record | `triage.md` in the change folder | Satisfies the "listed with a reason" acceptance and survives archiving. |
| Delivery | One PR, one phase | Simplest; split into a follow-up issue only if the list is long (~25+). |
| Triage | I decide, no mid-way checkpoint | User's choice; the table is reviewed in the PR. |

## Scope

**In scope:** two full runs, triage record, tests for relevant survivors, scoped control run.

**Out of scope:** 100% score, `thresholds.break`, equivalent/noise mutants, production code changes (unless a real bug appears), parallel runs.

## Architecture / Approach

Background runs with output in `$TMPDIR`; reports from `reports/mutation/` (gitignored); tests added to existing test files; control run narrowed with `--mutate`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Run, triage, tests | Baseline, `triage.md`, new tests, control run | Angular run may take many hours; type-only survivors are false gaps |

**Prerequisites:** PR #189 merged; branch from fresh `main`.
**Estimated effort:** one long session dominated by run time.

## Open Risks & Assumptions

- A long survivor list may force a follow-up issue.
- Angular type-only survivors need a cold-build check before being treated as gaps.

## Success Criteria (Summary)

- Both baselines and all survivor decisions recorded.
- Targeted survivors killed in the control run.
- `npm run test:worker`, `npm run test:ci`, `npm run lint` green.
