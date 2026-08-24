# Abuse-Lens Test Gaps Implementation Plan

## Overview

Close the two narrow test gaps that are the only remaining scope of test-plan.md's Phase 4 ("Abuse-lens closure"): risk #6's admin-session-vs-non-admin-route cross-user gap plus a two-admin scenario, and risk #7's near-730-day boundary batch-size/latency observation. The local post-edit hook that was also part of Phase 4's original scope already shipped in PR #90, so this plan touches only test files plus one test-config line — no production code changes.

## Current State Analysis

- `src/worker/routes/alerts.ts:18` and `src/worker/routes/trigger-events.ts:40` mount only `sessionMiddleware` — user scoping happens exclusively via `user_id` in each SQL statement (e.g. `alerts.ts:296` `DELETE ... WHERE id = ? AND user_id = ?`). Neither route ever imports or checks `adminMiddleware`. This is already correct; the gap is that nothing asserts an admin session gets the same 404 as any other non-owning user would.
- `src/worker/lib/admin.ts:14-23` — `adminMiddleware` re-derives admin status from `users.email` on every request via `isAdminEmail()` (`admin.ts:4-6`), which splits `ADMIN_EMAILS` on comma and trims/lowercases each entry. Adding a second admin needs no code change, only a config value change.
- `vitest.config.mts:19` sets `ADMIN_EMAILS: "admin@example.com"` — a single admin identity. `test/worker/admin.test.ts` has no way today to exercise a second admin account.
- `test/worker/admin.test.ts:26-34` (`logInAsAdmin`) and `:210-218` (existing `range_too_large` boundary-rejection test at >730 days) are the two most relevant existing patterns to extend.
- `test/worker/admin.test.ts:92-113` already has `getUserId`, `insertAlert`, `insertTriggerEvent` helpers used by the existing single-user delete tests (`admin.test.ts:826-860` region) — the two-admin test reuses these directly.
- `src/worker/routes/admin.ts:82,90` — `POST /market-data` builds one `D1PreparedStatement` per close via `upsertPriceHistory` (`market-data.ts:149-158`) and writes them all in one `c.env.DB.batch(statements)` call. `context/archive/2026-08-02-admin-panel/plan.md:285` documents the original sizing rationale: ~730 days ≈ ~500 trading days ≈ one Yahoo fetch + one ~500-statement batch, reasoned to be "within D1 limits" but never exercised near that boundary in a test — only the >730 rejection path is tested today.
- `test/worker/admin.test.ts:270-285` already shows the `vi.spyOn(env.DB, 'batch')` pattern needed to inspect the statements array passed to a real batch call without needing a live D1 round-trip assertion beyond what's already exercised.

### Key Discoveries:

- `@cloudflare/vitest-pool-workers` isolates D1 storage **per test file**, not per `it()` block within a file (existing comments in `alerts.test.ts:63-66`, `scheduled.test.ts`, `rsi-eligibility-triggers.test.ts` all describe the within-file sharing; across files each gets fresh storage). This means `alerts.test.ts` cannot reuse the `admin@example.com` identity already registered inside `admin.test.ts` — it must register its own, in its own file, and that's safe since `ADMIN_EMAILS` makes `admin@example.com` an admin email regardless of which test file registers it.
- Deleting a user via `DELETE /api/admin/users/:id` cascades real `ON DELETE CASCADE` FKs on `sessions`, `alerts`, `trigger_events` (documented at `admin.ts:291-295`) — the second-admin identity used in the two-admin test must be scoped to only that one test (a fresh registration used nowhere else in the file) so the cascade delete doesn't invalidate state another test depends on.

## Desired End State

Three new test cases exist and pass under `npm run test:worker`:
1. An admin session gets 404 (not special access) when it PUTs/DELETEs another user's alert via the regular `/api/alerts/:id` routes.
2. With two admin accounts configured, one admin's admin-route actions (impact lookup + delete) against the other admin's user id behave exactly as they would against a regular target user — correctly scoped counts, no bypass, no mixing with the acting admin's own data.
3. A near-730-day (`~729`) backfill range produces a batch of the expected size (all trading-day closes, no chunking) and completes successfully, with actual timing observable in test output for future reference — no brittle hard threshold.

No production code changes; `src/worker/**` behavior is already correct per the current-state analysis above — this plan adds the coverage that proves it and guards against regression.

## What We're NOT Doing

- Not adding a `GET /admin/users` self-exclusion test for both admin accounts as its own scenario — covered implicitly by the two-admin resource-action test's `impact` call, not a separate case.
- Not extending this to `trigger-events.ts`'s `GET /` route — `alerts.ts` PUT/DELETE is the higher-risk (mutating) surface named in test-plan.md's Risk Response Guidance; the read-only trigger-events route stays out of scope for this phase.
- Not asserting a hard latency/CPU threshold in the risk #7 benchmark test — `vitest-pool-workers` timing doesn't reflect Cloudflare's real CPU budget (this work is I/O-bound per the original admin-panel plan, unlike the CPU-bound PBKDF2 cap), so a fixed threshold would be a flaky, unrelated signal.
- Not creating a new test file — all three cases extend `test/worker/alerts.test.ts` and `test/worker/admin.test.ts`, following this repo's one-module-one-test-file convention (CLAUDE.md §6.1).
- Not touching the local post-edit hook — already shipped in PR #90, no longer part of this phase's scope.
- No changes to `src/worker/**` production code.

## Implementation Approach

Extend the two existing test files in place, reusing every helper and pattern already present (`registerAndLogIn`, `logInAsAdmin`, `updateAlert`/`deleteAlert`, `yahooBody`, `vi.stubGlobal('fetch', ...)`, `vi.spyOn(env.DB, 'batch')`, `insertAlert`/`insertTriggerEvent`/`getUserId`). The only non-test change is widening `ADMIN_EMAILS` in `vitest.config.mts` to a comma-separated pair, which `isAdminEmail()` already supports without modification.

## Critical Implementation Details

**Cross-file D1 isolation**: `alerts.test.ts` must independently `registerAndLogIn('admin@example.com')` for its new test — it cannot import or rely on any identity `admin.test.ts` created, since each test file gets isolated D1 storage. Conversely, within `admin.test.ts`, the two-admin test's second identity must be a fresh registration (e.g. `admin2@example.com`) used only in that one test, because deleting it via the admin delete endpoint cascades real FK deletes that would break any later test reusing that identity.

## Phase 1: Abuse-lens test coverage — admin cross-user isolation and backfill batch-size observation

### Overview

Adds the three test cases described in Desired End State, plus the one-line test-config change that makes a two-admin scenario possible.

### Changes Required:

#### 1. Second admin identity for tests

**File**: `vitest.config.mts`

**Intent**: Provide a second admin email so a two-admin scenario is testable, without introducing any new test infrastructure.

**Contract**: Change the `ADMIN_EMAILS` miniflare binding from `"admin@example.com"` to `"admin@example.com,admin2@example.com"`. `isAdminEmail()` (`src/worker/lib/admin.ts:4-6`) already splits on comma and trims each entry, so no other code changes.

#### 2. Admin session vs. non-admin route (risk #6, gap 1)

**File**: `test/worker/alerts.test.ts`

**Intent**: Prove that a session whose email happens to be an admin email gets exactly the same 404 as any other non-owning user when it targets another user's alert through `/api/alerts/:id` — this route never checks `adminMiddleware`, so admin status must have zero effect here.

**Contract**: New `it()` block placed alongside the existing isolation tests (`alerts.test.ts:450-505`), following the same shape: `registerAndLogIn('admin@example.com')` for the "admin" session, `registerAndLogIn(...)` for a regular owner, create an alert as the owner, then call `updateAlert`/`deleteAlert` with the admin's cookie against that alert's id and assert `404` with `code: 'alert_not_found'` — mirroring the existing `'returns 404 updating another user\'s alert (isolation)'` test exactly, just with the non-owning cookie swapped for the admin one.

#### 3. Two-admin scenario (risk #6, gap 2)

**File**: `test/worker/admin.test.ts`

**Intent**: Prove that when a second admin account exists, one admin's admin-route actions against the other admin's user id are scoped correctly (no special immunity for being an admin, no accidental mixing with the acting admin's own alerts/trigger events).

**Contract**: New `it()` block using `logInAsAdmin()` for Admin A and `registerAndLogIn('admin2@example.com')` for Admin B (a fresh identity used only in this test, per the Critical Implementation Details note above). Seed one alert and one trigger event for Admin B via the existing `insertAlert`/`insertTriggerEvent`/`getUserId` helpers. Call `getUserImpact` with Admin A's cookie against Admin B's id and assert `alertsCount: 1, triggerEventsCount: 1`. Then call `removeUser` with Admin A's cookie against Admin B's id and assert `200` with `alertsDeleted: 1, triggerEventsDeleted: 1`, followed by a direct D1 check that Admin B's row in `users` is gone.

#### 4. Near-730-day backfill batch-size observation (risk #7)

**File**: `test/worker/admin.test.ts`

**Intent**: Close the gap where only the >730-day rejection path is tested — exercise a range just under the cap and observe the actual batch size and timing, without asserting a brittle hard threshold (this work is I/O-bound, not CPU-bound, per `context/archive/2026-08-02-admin-panel/plan.md:285`).

**Contract**: New `it()` block using `logInAsAdmin()`, a `from`/`to` range spanning 729 days (e.g. `2024-01-03` to `2026-01-01`), and a small local helper that generates weekday-only Unix timestamps across that range (so the mocked Yahoo response returns realistic trading-day density, ~520 entries, without hand-listing them). Stub `fetch` to return that generated `yahooBody(...)`, spy on `env.DB.batch` (same pattern as `admin.test.ts:277`) to capture the statements array and assert its length equals the number of generated closes (no chunking regression), assert the response is `200` with matching `daysWritten`, and wrap the call with `performance.now()` before/after to `console.log` the elapsed time — informational only, not asserted.

### Success Criteria:

#### Automated Verification:

- Unit/integration tests pass: `npm run test:worker`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full CI gate passes: `npm run ci`

#### Manual Verification:

- Skim the `console.log`'d timing from the risk #7 test in CI/local output once, to sanity-check it's in a reasonable range (seconds, not a stall) — no threshold, just a one-time human sanity check per this plan's own reasoning in "What We're NOT Doing."

---

## Testing Strategy

### Unit Tests:

- All three new cases described above, added directly to `alerts.test.ts` and `admin.test.ts`.

### Integration Tests:

- These are already integration-style tests (real D1 + real Hono routing via `exports.default.fetch`), consistent with every other test in `test/worker/`.

### Manual Testing Steps:

1. Run `npm run test:worker` and confirm all three new tests pass alongside the existing suite.
2. Read the risk #7 test's logged elapsed time once to confirm it's not surprisingly slow.

## Performance Considerations

None beyond the observational logging described above — no threshold, no production code path changes.

## References

- Test plan: `context/foundation/test-plan.md` §2 (risks #6, #7), §3 Phase 4
- Original 730-day sizing rationale: `context/archive/2026-08-02-admin-panel/plan.md:285`
- Existing isolation test pattern: `test/worker/alerts.test.ts:450-505`
- Existing admin/batch test patterns: `test/worker/admin.test.ts:26-34,92-113,210-218,270-285`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Abuse-lens test coverage — admin cross-user isolation and backfill batch-size observation

#### Automated

- [x] 1.1 Unit/integration tests pass: `npm run test:worker` — b99facf
- [x] 1.2 Typecheck passes: `npm run typecheck` — b99facf
- [x] 1.3 Lint passes: `npm run lint` — b99facf
- [x] 1.4 Full CI gate passes: `npm run ci` — b99facf

#### Manual

- [x] 1.5 Skim the risk #7 test's logged timing once for a sanity check — b99facf
