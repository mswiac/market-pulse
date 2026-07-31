<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Alert Notifications (S-05) Implementation Plan

- **Plan**: context/changes/alert-notifications/plan.md
- **Mode**: Deep
- **Date**: 2026-07-31
- **Verdict**: REVISE (both findings fixed during triage — see Decisions below)
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (pre-fix) |
| Plan Completeness | WARNING (pre-fix) |

## Grounding

10/10 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — New NOT NULL alerts.direction breaks existing trigger tests

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (schema) / Phase 2 blast radius
- **Detail**: Verified against `test/worker/rsi-eligibility-triggers.test.ts:22,32,48` — three raw `INSERT INTO alerts (...)` statements (deliberately bypassing `alerts.ts` validation, to test DB-level triggers directly) don't supply a `direction` value. The plan's `alerts_new.direction TEXT NOT NULL CHECK (direction IN ('up','down'))` had no `DEFAULT`, so all three would start failing a NOT NULL violation, two of which assert success. Neither Phase 1 nor Phase 2 mentioned this file.
- **Fix**: Give `direction` a `DEFAULT 'up'` in the `alerts_new` column definition (Phase 1), consistent with the "missing data defaults to 'up'" convention already used elsewhere in the plan's backfill logic. The application layer always supplies an explicit, validated direction on every write, so the DB-level default is only ever exercised by out-of-band raw SQL (this test file, the migration's own backfill) — it doesn't weaken API validation.
- **Decision**: FIXED — added `DEFAULT 'up'` to the `direction` column definition in Phase 1's migration contract, with a note explaining why (referencing the specific test file/lines).

### F2 — Un-batched trigger_events+armed writes risk duplicate fires

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — Cron Evaluation and Notification Logic
- **Detail**: Verified `src/worker/scheduled.ts:57` batches all per-ticker DB writes in one `env.DB.batch(...)` call, and `src/worker/routes/alerts.ts:128-132,189-192` explicitly justifies `db.batch()` to avoid a non-atomic window between two coupled writes. Phase 4's fire path described the `trigger_events` INSERT and `alerts SET armed = 0` UPDATE as sequential, un-batched steps — the only such case in the codebase's DB-write patterns. A D1 failure between the two statements could leave an alert armed with a trigger already recorded, risking a duplicate email on a later run for the same crossing.
- **Fix**: Wrap the `trigger_events` INSERT and `alerts SET armed = 0` UPDATE in a single `env.DB.batch([...])` call, matching the existing pattern. The Resend HTTP call stays outside the batch (D1 batches are DB-only); safe sequence: send email → `batch(insert trigger_events, update armed)`.
- **Decision**: FIXED — Phase 4 item 1's contract now specifies `sendAlertEmail` runs outside any batch, followed by a single `env.DB.batch([...])` for the INSERT+UPDATE pair, with an explicit cross-reference to the existing `alerts.ts` pattern and the duplicate-fire risk being avoided.
