# E2E for admin instrument and user management — Plan Brief

> Full plan: `context/changes/e2e-admin-management/plan.md`

## What & Why

Cover the admin add-instrument, remove-instrument and remove-user screens in the browser (issue #185). They handle destructive actions behind confirm dialogs and are only tested manually today, so a regression that deletes the wrong row or skips the dialog would go unnoticed.

## Starting Point

The screens, their confirm dialogs and the admin API already exist. Admin E2E infrastructure (`chromium-admin`, admin session) shipped in #183; #184 added the first admin spec, with mocked network.

## Desired End State

Three spec files under `e2e/admin/` with six green tests, each red when its behavior breaks: add shows the new instrument in the picker; remove instrument and remove user work only after confirmation and really persist; cancel removes nothing; the admin's own account is not offered for removal.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Backend | Real Worker + local D1, nothing mocked | Actions are local, reversible, send no email; the risk is in the full chain | Plan |
| File layout | Three files, one per screen | One scenario group per file; independent and parallel-safe | Plan |
| Phases | One phase | Small independent specs, one PR | Plan |
| Test data | Created via API with unique ids; cleaned in `afterEach` | Tests stay independent; failures leave nothing behind | Plan |
| Self-delete | Asserted only as "own email absent from list"; 403 left to the worker test | A regressed guard would delete the dev admin (review F1) | Review |
| Complexity | LOW | No app changes, existing patterns | Plan |

## Scope

**In scope:** the three issue scenarios plus cancel paths, the generation prompt file.
**Out of scope:** validation-error scenarios, non-admin 403, cascade side effects, any app/worker/config change.

## Architecture / Approach

Each spec logs in through the existing admin `storageState`, creates its own data through the API (users via a fresh request context so the admin session survives), drives the real UI, asserts the visible outcome and the persisted state, and deletes its data in `afterEach`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Admin management E2E | Prompt + 3 specs, break-checked, CI green | Leftover data on a failed run; parallel collisions on global tables |

**Prerequisites:** #183 (admin session) merged; `E2E_ADMIN_*` set locally (already done).
**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- Instruments and users are global tables; unique run-specific ids are required so parallel runs and re-runs do not collide.
- Registration cost (PBKDF2) on the local Worker may slow the user specs slightly.

## Success Criteria (Summary)

- Six tests pass locally and in CI, and each fails when its guarded behavior is broken.
- A run leaves the instrument and user lists exactly as it found them.
