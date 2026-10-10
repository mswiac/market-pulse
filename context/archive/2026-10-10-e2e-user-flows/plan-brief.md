# E2E User Flows — Plan Brief

> Full plan: `context/changes/e2e-user-flows/plan.md`

## What & Why

Issue #186: only alert create, delete and filters have browser coverage. We add specs for alert editing, form validation, the current-value column, the register / log out / log in journey and smoke checks for both history pages, so regressions in these user-facing flows fail CI.

## Starting Point

The seed spec, alert specs and the admin chain exist. `e2e/admin/admin-api.ts` has throwaway-user helpers. No production changes are needed.

## Desired End State

Every bullet in #186 has a reviewed, break-verified spec that cleans up after itself.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Account-flow spec location | `e2e/admin/`, anonymous storageState | Only the admin API can delete the registered user |
| Current value check | Mock `GET /api/alerts` | Real values depend on local market data |
| Validation | One test per case (empty, ≤0, RSI range, duplicate) | User preference |
| History smoke | Trigger page real, instrument history rows mocked | Deterministic without seeded data |

## Scope

**In scope:** the six bullets of #186.
**Out of scope:** production code, alert pause (#199), currency prefill (#200), config changes.

## Architecture / Approach

Three phases, each generated via `/10x-e2e` from a prompt file and modelled on `seed.spec.ts`. A small `e2e/alerts-api.ts` helper creates and deletes alerts through the API.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Alerts | Edit, validation, current-value specs | Unique thresholds, leftover alerts |
| 2. Account | Register / logout / login, wrong password | Cleanup needs the admin API |
| 3. History | Two smoke tests | Data-dependent tables |

**Prerequisites:** both dev servers, local e2e credentials for a user and an admin.
**Estimated effort:** ~3 sessions across 3 phases.

## Open Risks & Assumptions

- Mocked responses can drift from the real API shape; worker tests cover the server side.

## Success Criteria (Summary)

- `npx playwright test` is green with the new specs.
- No leftover alerts or users in local D1.
