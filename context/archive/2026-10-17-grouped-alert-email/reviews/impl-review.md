<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Grouped Alert Email

- **Plan**: context/changes/grouped-alert-email/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-10-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated checks (worker tests 432, typecheck, lint) pass. Manual step 1.4 is pending by design: the user verifies it on production after deploy, with the real cron.

## Findings

### F1 — Notification-email grouping case is not really tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: test/worker/alert-evaluation.test.ts (test "does not merge alerts that differ in ... notification email")
- **Detail**: The alert with a different notification email has threshold 41 "down", so if `notification_email` were dropped from the group key it would join the base group (threshold 40 is deeper) and the counts (5 sent bodies, 6 summary entries) would stay the same. The test passes either way.
- **Fix**: Add a dedicated test with two same-user alerts on one ticker, 40 to the verified address and 39 to an unverified one; assert one email to the verified address and two summary entries (merged, the deeper 39 alert would be the one sent and rejected, so nothing would be delivered).
- **Decision**: FIXED — dedicated notification-email test; verified it fails when the email is dropped from the group key

### F2 — Group tests do not assert per-alert threshold or high/low in events

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: test/worker/alert-evaluation.test.ts (grouping tests)
- **Detail**: A regression writing the representative's threshold (38) into every event row, or wrong `high_at_trigger` / `low_at_trigger`, would pass. The issue requires each alert's history to stay complete.
- **Fix**: Add `threshold` to the event assertions of the RSI test, and `threshold`, `high_at_trigger` 106 and `low_at_trigger` 97 to the PRICE test.
- **Decision**: FIXED — per-alert thresholds asserted for RSI and PRICE groups, high/low asserted in PRICE events

### F3 — Missing edge cases in grouping tests

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: test/worker/alert-evaluation.test.ts
- **Detail**: Not covered: PRICE "up" group (highest threshold, day's high), threshold ties, a group larger than the D1 chunk sizes (8 event rows, 90 ids per statement) now that the 101-alert test uses one user per alert, a write error on a multi-alert group, a 5xx (not only a thrown fetch) on a group, and a mixed run with one sent and one transient group.
- **Fix**: Add three tests: PRICE "up" group; a 95-alert single-user group (one email, 95 events, all disarmed); two groups in one run where one send fails transiently and the other succeeds.
  - Strength: Exercises the chunking and the per-group transient rule the plan flags as load-bearing.
  - Tradeoff: A few more tests, no production code change.
  - Confidence: HIGH — same helpers as existing tests.
  - Blind spot: Tie and write-error cases stay untested (same code path as covered cases).
- **Decision**: FIXED — added PRICE up, 95-alert group and mixed transient/permanent group tests (tie, write-error and 5xx cases left untested: same code paths)

### F4 — buildEmail runs for every firing alert, used for one per group

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/alert-evaluation.ts (per-alert loop)
- **Detail**: Emails are built per alert inside the per-alert try so a malformed row stays isolated, then only the representative's is used. This is the same number of `buildEmail` calls as before the change, so it is not a regression.
- **Fix**: None needed; leave as is (documented in the code comment).
- **Decision**: SKIPPED — not a regression, same number of buildEmail calls as before

### F5 — Dead fallback and extra lookup in groupFiringAlerts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/lib/alert-evaluation.ts (groupFiringAlerts)
- **Detail**: `items.find(...) ?? items[0]` never reaches the fallback; `deepestAlert` could operate on `FiringAlert[]` and return the item directly.
- **Fix**: Make `deepestAlert` take and return `FiringAlert`, drop the `find` and the fallback.
- **Decision**: FIXED — deepestAlert now works on FiringAlert, dead find/fallback removed
