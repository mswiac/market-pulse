<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E admin account infrastructure

- **Plan**: context/changes/e2e-admin-account-infra/plan.md
- **Scope**: Full plan (Phases 1-2 of 2)
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run during the review: `npm run lint` clean; `npx playwright test --list` shows 21 tests in 10 files with a correct project partition (`admin-gate-redirect.spec.ts` stays in `chromium`, `admin/admin-gate-pass.spec.ts` only in `chromium-admin`). The full suite (21 passed) and the deliberate-break check were run earlier in the implementation. Plan item 2.5 (CI green on the PR) is still pending by design.

## Findings

### F1 — Pre-push hook blocks pushes for anyone with an existing env file but no admin credentials

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .husky/pre-push:40-44 (with playwright.config.ts `setup-admin` project)
- **Detail**: The hook's header promises "skipped with a warning, never blocking" when the local E2E setup is incomplete, but it only checks that the local env file exists. With an env file that has only `E2E_EMAIL` / `E2E_PASSWORD` (every developer configured before this change), `npx playwright test` now fails in `setup-admin`, so any push touching `e2e/` or `src/app/` is blocked — including this branch's own push. The plan listed this as an accepted risk, but it contradicts the hook's documented contract.
- **Fix A ⭐ Recommended**: Make the hook skip E2E with a warning when the admin variables are absent from both the environment and the local env file (grep for the key names only, never print values).
  - Strength: Restores the hook's "never blocking" contract; the loud failure stays for direct `npx playwright test` runs.
  - Tradeoff: A push can go out without E2E when admin credentials are missing (same as when the env file is missing today).
  - Confidence: HIGH — mirrors the existing missing-env-file branch.
  - Blind spot: The grep must not echo the guarded file's contents.
- **Fix B**: Keep the hard failure and document it in the README as a required step.
  - Strength: No silent E2E skips.
  - Tradeoff: Existing setups get blocked pushes until they edit the env file.
  - Confidence: MEDIUM — matches the planning decision, but not the hook header.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (hook skips E2E with a warning when E2E_ADMIN_* are missing; verified syntax)

### F2 — Admin setup does not assert the session is actually an admin

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/admin-auth.setup.ts:31-34
- **Detail**: If the account is not listed in `ADMIN_EMAILS`, setup still succeeds (it only checks the "Pulpit" heading) and the failure surfaces later in `admin-gate-pass` as an unrelated-looking assertion on the admin panel heading.
- **Fix**: After the "Pulpit" check, assert the "Administrator" nav button is visible so a misconfigured account fails in setup with a pointed message.
- **Decision**: FIXED (setup now asserts the "Administrator" nav button; verified: admin account passes, non-admin account fails in setup-admin)

### F3 — CI admin email is duplicated between the env block and the generated Worker vars

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/e2e.yml:45 and :82
- **Detail**: `admin@ci.market-pulse.test` appears in `E2E_ADMIN_EMAIL` and in the `ADMIN_EMAILS` line of the generated Worker vars file. If one changes, `isAdmin` becomes false and only the admin spec fails. A comment already ties the two together.
- **Fix**: Leave as is (the comment documents the coupling) or make the vars heredoc unquoted and interpolate `${E2E_ADMIN_EMAIL}`.
- **Decision**: SKIPPED (the comment in e2e.yml documents the coupling)
