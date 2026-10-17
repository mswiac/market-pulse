# Post-release hardening — Plan Brief

> Full plan: `context/changes/post-release-hardening/plan.md`

## What & Why

After four releases (#214/#218, #216, #220, #222) nobody checked whether the new tests actually catch bugs, and two foundation docs are out of date. This change runs a scoped mutation sweep and updates the docs (issue #224).

## Starting Point

Worker integration tests cover the new logic. Stryker has not been run on it. The e2e item from the issue turned out to exist already in `e2e/admin/add-instrument.spec.ts`.

## Desired End State

Survivors in the four changed worker files are killed or documented; `app-overview.md` and `test-plan.md` reflect grouped emails, the `MON-FRI` guard and the sweep. No production code changed.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| E2E assertion | Dropped from scope | Full-text assertion for the currency-correction notice already exists | Plan |
| Stryker scope | 4 worker files | Only files changed by the releases; `scheduled.ts` is literals | Plan |
| Score target | No target | Triage survivors, don't chase 100% | Plan |

## Scope

**In scope:** scoped Stryker sweep plus new assertions; two doc updates.

**Out of scope:** e2e changes, README, Angular Stryker, production code.

## Architecture / Approach

Test-only sweep first, then docs, so the changelog can cite real before/after scores.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scoped mutation sweep | New worker assertions for meaningful survivors | Full suite runs per mutant, so the run is slow |
| 2. Documentation | app-overview sentence, test-plan changelog | None |

**Prerequisites:** none. **Estimated effort:** ~1 session.

## Open Risks & Assumptions

- The sweep may find real bugs, not just weak tests; those would need a separate change.

## Success Criteria (Summary)

- No unexplained survivors in grouping, deepest-threshold and failure-handling logic.
- Docs match shipped behaviour.
