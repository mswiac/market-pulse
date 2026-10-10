# E2E admin account infrastructure Implementation Plan

## Overview

The Playwright suite only authenticates as a non-admin, so no admin screen can be covered. Add a second, admin-authenticated Playwright project (own `storageState`), make CI register the admin account, document the setup, and prove the infrastructure with one spec: an admin passes the gate (the inverse of `admin-gate-redirect.spec.ts`). GitHub issue #183.

## Current State Analysis

- `playwright.config.ts` has two projects: `setup` (`testMatch: /auth\.setup\.ts/`) and `chromium` (user storageState, depends on `setup`, ignores `auth.setup.ts`). Credentials come from `E2E_EMAIL` / `E2E_PASSWORD`, loaded from the gitignored local env file under `e2e/`.
- `e2e/auth.setup.ts` logs in through the real login form and throws a clear error when the variables are missing.
- `isAdmin` is server-derived: the `ADMIN_EMAILS` Worker var is matched against the account email in `GET /api/me` and the login/register responses (`src/worker/routes/auth.ts`). The Angular `adminGuard` and the shell's `@if (isAdmin())` "Administrator" nav group consume it.
- `.github/workflows/e2e.yml` already sets `ADMIN_EMAILS=admin@ci.market-pulse.test` for the Worker, but registers only the non-admin account (`POST /api/register`, accepting 201/409).
- The saved-session directory `playwright/.auth` and the local e2e env file are already gitignored.

## Desired End State

`npx playwright test` logs in twice (user and admin), runs the existing specs as the non-admin and the specs under `e2e/admin/` as the admin. CI registers `admin@ci.market-pulse.test` before the run. One admin spec passes: the admin sees the "Administrator" nav group and can open `/admin`. `test-plan.md` §6.6 and the README describe the admin setup.

### Key Discoveries:

- `testMatch: /auth\.setup\.ts/` is an unanchored substring match, so a second setup file reusing that name pattern would land in the wrong project.
- The existing `admin-gate-redirect.spec.ts` lives in `e2e/` and must stay in the non-admin project (it needs a non-admin session).
- A missing admin credential must fail loudly, like `E2E_EMAIL` does today (decided in planning, so tests are never skipped silently).

## What We're NOT Doing

- Admin feature specs (instrument/user management, Force data refresh): follow-up issues #184 and #185.
- Any change to production code (`src/`) or to the existing user project's behavior.
- A skip-when-missing mode for admin credentials.
- Making the E2E workflow a required check.

## Implementation Approach

Keep the user flow untouched and add a parallel admin chain: `setup-admin` project, then `chromium-admin` project. Separate by directory: specs under `e2e/admin/` run only as admin, and the `chromium` project ignores that directory. Credentials mirror the user mechanism (local gitignored env file, real env wins in CI).

## Phase 1: Admin Playwright project, CI account and docs

### Overview

Everything except the spec: config, admin login step, CI registration, documentation.

### Changes Required:

#### 1. Admin login step

**File**: `e2e/admin-auth.setup.ts` (new)

**Intent**: Mirror `e2e/auth.setup.ts` for the admin: log in through the real login form with `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, and save the session to `playwright/.auth/admin.json`.

**Contract**: Throws a clear error naming both variables when either is missing. Success check is the same authenticated-shell check as the user setup (URL `/`, heading "Pulpit").

#### 2. Playwright config

**File**: `playwright.config.ts`

**Intent**: Add the admin chain and keep the user chain unchanged in behavior. Update the header comment that mentions only `E2E_EMAIL` / `E2E_PASSWORD`.

**Contract**: Projects `setup` (user), `setup-admin` (`admin-auth.setup.ts`), `chromium` (user storageState, ignores both setup files and `e2e/admin/`), `chromium-admin` (admin storageState, `testMatch` limited to `e2e/admin/`, depends on `setup-admin`). The existing `setup` `testMatch` is anchored so it no longer matches `admin-auth.setup.ts`.

#### 3. CI workflow

**File**: `.github/workflows/e2e.yml`

**Intent**: Export `E2E_ADMIN_EMAIL: admin@ci.market-pulse.test` and a throwaway `E2E_ADMIN_PASSWORD`, and register that account in the seed step so it is an admin (it matches the existing `ADMIN_EMAILS`).

**Contract**: Same register call and 201/409 handling as the user account, factored so both accounts are seeded before `npx playwright test`.

#### 4. Documentation

**Files**: `context/foundation/test-plan.md` (§6.6, plus a dated change-log line), `README.md` ("End-to-end tests (Playwright)")

**Intent**: Document the admin credentials in the local e2e env file, that the admin account must be listed in `ADMIN_EMAILS` locally, the `e2e/admin/` convention (specs there run as the admin), and the second saved session `playwright/.auth/admin.json`.

**Contract**: Prose only, English.

### Success Criteria:

#### Automated Verification:

- Config and setup compile and lint: `npm run lint`
- Playwright lists the new projects and specs without error: `npx playwright test --list`
- The user chain still passes with no admin specs yet: `npx playwright test --project=chromium`

#### Manual Verification:

- Admin credentials are added to the local e2e env file (local dev admin account listed in `ADMIN_EMAILS`) and `setup-admin` logs in successfully
- The docs read correctly

---

## Phase 2: Admin passes the gate spec

### Overview

One spec in `e2e/admin/`, generated via `/10x-e2e` (seed, anti-pattern review, deliberate-break verify). Test-plan Risk #6 (authorization boundary), the positive facet.

### Changes Required:

#### 1. Admin-gate pass spec

**File**: `e2e/admin/admin-gate-pass.spec.ts` (new), plus the `/10x-e2e` prompt file in `e2e/prompts/` per existing convention

**Intent**: An admin session sees the "Administrator" nav group and can open `/admin` (and stays there), the inverse of `admin-gate-redirect.spec.ts`.

**Contract**: Runs only in `chromium-admin`; role-based locators in the Polish build; no per-test login; no mutation, so no cleanup needed. Deliberate break: invert the `adminGuard` / `isAdmin` check and confirm the spec goes red, then revert.

### Success Criteria:

#### Automated Verification:

- The new spec passes: `npx playwright test --project=chromium-admin`
- The full suite passes (user and admin): `npx playwright test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Deliberate break of the admin gate turns the spec red and was reverted
- CI run on the PR is green, with the admin account registered

---

## Testing Strategy

### Manual Testing Steps:

1. Add `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` to the local e2e env file; run `npx playwright test`.
2. Confirm `playwright/.auth/admin.json` is created and gitignored.
3. Check the E2E workflow on the PR.

## Migration Notes

Existing local setups must add the two admin variables to the local e2e env file, otherwise `setup-admin` fails with a clear message (and so does the pre-push hook).

## References

- Issue: https://github.com/mswiac/market-pulse/issues/183
- Similar spec: `e2e/admin-gate-redirect.spec.ts`; setup: `e2e/auth.setup.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Admin Playwright project, CI account and docs

#### Automated

- [x] 1.1 Config and setup compile and lint: `npm run lint` — c964ca9
- [x] 1.2 Playwright lists the new projects and specs without error: `npx playwright test --list` — c964ca9
- [x] 1.3 The user chain still passes with no admin specs yet: `npx playwright test --project=chromium` — c964ca9

#### Manual

- [x] 1.4 Admin credentials added to the local e2e env file and setup-admin logs in successfully — c964ca9
- [x] 1.5 The docs read correctly — c964ca9

### Phase 2: Admin passes the gate spec

#### Automated

- [x] 2.1 The new spec passes: `npx playwright test --project=chromium-admin` — 0cb2435
- [x] 2.2 The full suite passes (user and admin): `npx playwright test` — 0cb2435
- [x] 2.3 Lint passes: `npm run lint` — 0cb2435

#### Manual

- [x] 2.4 Deliberate break of the admin gate turns the spec red and was reverted — 0cb2435
- [ ] 2.5 CI run on the PR is green, with the admin account registered
