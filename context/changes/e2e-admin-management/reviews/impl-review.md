<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E for admin instrument and user management

- **Plan**: context/changes/e2e-admin-management/plan.md
- **Scope**: Phase 1 of 1 (commit e3744a0; row 1.5 CI pending)
- **Date**: 2026-10-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Self-delete test sends a real DELETE for the admin's own id

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/remove-user.spec.ts:84-101
- **Detail**: If the `cannot_delete_self` guard (src/worker/routes/admin.ts:348) regressed, this test would really delete the dev admin account (and its sessions/alerts) from local D1; later runs then fail in admin-auth.setup.ts. The guard already has a worker test (test/worker/admin.test.ts:1019) that asserts the 403 and that the admin stays intact, so the E2E DELETE adds little beyond the risk.
- **Fix**: Keep the UI half (own email absent from the list, throwaway user present as a loaded-list sentinel) and drop the direct DELETE; leave the 403 contract to the worker test.
  - Strength: Removes the only way these specs can destroy non-test data; the 403 stays covered at the layer that can prove it.
  - Tradeoff: The E2E no longer proves the guard end to end; a UI-list regression and a guard regression are covered separately.
  - Confidence: HIGH — worker test covers the exact contract.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix now: direct DELETE removed, UI-only self check; plan and prompt updated)

### F2 — `user` is undefined/stale in afterEach after a failed beforeEach

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/remove-user.spec.ts:20-28
- **Detail**: If `registerUser` throws, the module-level `user` is undefined (first test in a worker) so afterEach throws a TypeError that masks the real failure, or holds the previous test's user (harmless 404).
- **Fix**: Type it `RegisteredUser | undefined`, reset it to undefined before registering, and guard afterEach with `if (user)`.
- **Decision**: FIXED (Fix now)

### F3 — Cleanup helpers swallow failures silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/admin-api.ts (deleteInstrument, deleteUser)
- **Detail**: Any status other than 200/404 (401, 500) leaves E2E rows in local D1 with no signal.
- **Fix**: Accept 200 and 404, throw on anything else so leftovers surface in the report.
- **Decision**: FIXED (Fix now)

### F4 — Post-reload "absent" assertions could pass before the list loads

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/remove-user.spec.ts:67-68, e2e/admin/remove-instrument.spec.ts:64-67
- **Detail**: Reviewer worried `toHaveCount(0)` / "Brak wyników" could pass on a not-yet-loaded list. Checked: both screens render the combobox only after loading finishes (`@else` branch), and the click/fill auto-waits for it, so the assertion runs on a loaded list; server-side proofs (login 401, GET /api/instruments) back it up anyway.
- **Fix**: None needed.
- **Decision**: NO CHANGE NEEDED

### F5 — Cancel tests read the recorded DELETE list right after the dialog closes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/remove-instrument.spec.ts:78-87, e2e/admin/remove-user.spec.ts:78-80
- **Detail**: `deletes.length === 0` could theoretically be read before a late `request` event, but the following server round-trips (instrument list, login 200) and `toBeEnabled()` (stays disabled while a real delete is in flight) catch it; the deliberate break (`confirmed || ticker` / `confirmed || id`) turned both cancel tests red.
- **Fix**: None needed.
- **Decision**: NO CHANGE NEEDED
