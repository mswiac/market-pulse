# E2E admin account infrastructure — Plan Brief

> Full plan: `context/changes/e2e-admin-account-infra/plan.md`

## What & Why

The Playwright suite logs in only as a non-admin, so no admin screen can be covered. This adds an admin session and one spec so the follow-up admin specs (#184, #185) can run. GitHub issue #183.

## Starting Point

Two projects (`setup`, `chromium`) with a `storageState` for one user from the local e2e env file. CI already sets `ADMIN_EMAILS=admin@ci.market-pulse.test` but registers only the non-admin account.

## Desired End State

`npx playwright test` logs in as user and admin; specs in `e2e/admin/` run as the admin, everything else as the user. CI registers the admin account. One spec shows an admin passes the gate. Docs describe the setup.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Missing admin credentials | Setup fails with a clear error | Same as `E2E_EMAIL`; no silently skipped tests |
| Separating admin specs | Directory `e2e/admin/` | Visible by location; the existing admin-gate-redirect spec stays in the user project |
| Setup file name | `e2e/admin-auth.setup.ts`, user `testMatch` anchored | The unanchored `/auth\.setup\.ts/` would match both |
| Production code | Unchanged | Admin comes from `ADMIN_EMAILS` already |

## Scope

**In scope:** second Playwright project and login step, CI registration, docs (test-plan §6.6, README), one admin-gate spec.

**Out of scope:** admin feature specs (#184, #185), production code, required-check status.

## Architecture / Approach

Parallel chain `setup-admin` -> `chromium-admin` next to `setup` -> `chromium`. `chromium` ignores `e2e/admin/`. Admin session in `playwright/.auth/admin.json` (already gitignored).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Infra | Config, admin login step, CI registration, docs | `testMatch` regex collision between the two setups |
| 2. Spec | `e2e/admin/admin-gate-pass.spec.ts` via `/10x-e2e` | Spec must fail when the admin gate breaks |

**Prerequisites:** local admin account listed in `ADMIN_EMAILS`, its credentials in the local e2e env file.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Pre-push hook fails until the admin variables are in the local e2e env file.
- Assumes the CI admin registration works through the same `/api/register` call.

## Success Criteria (Summary)

- Full suite green locally and in CI with both sessions.
- Admin spec goes red when the admin gate is deliberately broken.
