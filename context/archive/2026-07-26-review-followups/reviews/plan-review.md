<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Review Follow-ups Implementation Plan

- **Plan**: context/changes/review-followups/plan.md
- **Mode**: Deep
- **Date**: 2026-07-26
- **Verdict**: REVISE (light — all findings are quick fixes)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 7/7 paths ✓, 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — Upsert trigger-firing claim is factually wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details
- **Detail**: The plan claims "the conflict path fires UPDATE triggers on the affected row, not INSERT triggers." Verified empirically against local D1: for `INSERT ... ON CONFLICT DO UPDATE`, BOTH the BEFORE INSERT and BEFORE UPDATE triggers fire on the same statement, in order (insert trigger, then update trigger) — never just one. The plan's stated reasoning is wrong, though the resulting decision (add both trigger types to market_data) is still correct — alerts.ts's separate plain INSERT (POST) and plain UPDATE (PUT) paths each genuinely need their own trigger regardless of the upsert question.
- **Fix**: Correct the Critical Implementation Details paragraph to state that D1 upserts fire both BEFORE INSERT and BEFORE UPDATE triggers on the same statement (verified empirically), and that market_data needs both trigger types primarily because alerts.ts's own INSERT/UPDATE paths are separate statements, not because of upsert semantics.
- **Decision**: FIXED

### F2 — Trigger test's FK dependency not specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Changes Required #2 (trigger test)
- **Detail**: `alerts.user_id` is `NOT NULL REFERENCES users(id)`, and D1 enforces `PRAGMA foreign_keys = 1` (confirmed empirically, not SQLite's off-by-default). The Contract's case (c) — "the equivalent valid inserts still succeed" — will fail on an unrelated FK violation unless the test first seeds a real user, but the plan doesn't say so.
- **Fix**: Add a line to the Contract noting the test must seed a real user first (reuse the `registerAndLogIn` helper pattern from `test/worker/alerts.test.ts`, or a direct `users` insert) before the valid-insert case.
- **Decision**: FIXED

### F3 — RETRY_DELAY_MS line reference is off by one

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis
- **Detail**: Plan says `src/worker/scheduled.ts:6`; `RETRY_DELAY_MS` is actually on line 7 (line 6 is `RETRY_ATTEMPTS`).
- **Fix**: Update the reference to `scheduled.ts:7`.
- **Decision**: FIXED

### F4 — Branch protection uses the deprecated `contexts` field

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Changes Required #2
- **Detail**: GitHub's docs mark `required_status_checks.contexts` as a "closing down" (deprecated but still functional) field. Since branch protection is being configured fresh here — not modifying something pre-existing — there's no reason to start with the deprecated shape. The modern replacement is `checks: [{context, app_id}]`; the app_id for "Cloudflare Workers and Pages" is `85455` (confirmed via `gh api .../check-runs`).
- **Fix**: Use `checks: [{"context": "Workers Builds: marketpulse", "app_id": 85455}]` instead of `contexts: ["Workers Builds: marketpulse"]`.
- **Decision**: FIXED
