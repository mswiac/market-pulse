<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin can remove a user

- **Plan**: context/changes/admin-remove-user/plan.md
- **Scope**: Phase 1 of 4 (full plan — all phases complete)
- **Date**: 2026-08-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations (F1 fixed, F2 skipped during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — DELETE /users/:id counts not batched with the delete itself

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/admin.ts:311-316
- **Detail**: The two `SELECT COUNT` queries (alerts, trigger_events) run via `Promise.all`, then `DELETE FROM users WHERE id = ?` runs afterward as a separate statement — not inside a `c.env.DB.batch([...])`. This deviates from the sibling `DELETE /instruments/:ticker` handler two functions above (admin.ts:227-233), which explicitly batches its count query with its deletes specifically so "the reported alertsDeleted always matches exactly what was removed, atomically." If alerts/trigger_events for the target user change between the count and the delete (a narrow window, admin-only low-frequency action), the reported `alertsDeleted`/`triggerEventsDeleted` in the response could be stale relative to what was actually removed. The cascade delete itself is unaffected (DB-level FK, not app-code-driven), so this is a reporting-accuracy issue, not a correctness/security issue.
- **Fix**: Wrap the two `COUNT` queries and the `DELETE FROM users` statement in one `c.env.DB.batch([...])` call, mirroring the instrument-delete handler's pattern, so the counts are computed atomically with the delete.
- **Decision**: FIXED — wrapped in `c.env.DB.batch([...])` with the same try/catch → 500 `delete_failed` shape as the instrument-delete handler; added a regression test (`admin.test.ts`, "returns 500 with code delete_failed when the D1 batch delete fails"). `npm run ci` passes (180/180 tests).

### F2 — Branch includes 4 files outside plan.md's declared scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; already explained and user-directed, no code fix needed
- **Dimension**: Scope Discipline
- **Location**: .claude/hooks/block-dev-vars.mjs, .claude/settings.json, .gitignore, context/foundation/lessons.md
- **Detail**: These four files are on the branch but not mentioned anywhere in plan.md's Changes Required sections. They are process/tooling hardening added reactively mid-implementation, after a manual-verification incident (the admin's local dev account was deleted/re-registered without asking, and `.dev.vars` was dumped in full while looking up `ADMIN_EMAILS`) — a `PreToolUse` hook now blocks tool calls referencing `.dev.vars`, and two new entries were added to `lessons.md` documenting both incidents. None of this touches the feature's application code paths (verified by the plan-drift sub-agent), and all of it was explicitly requested by the user in-conversation, not silently added.
- **Fix**: No code fix needed — this is documentation/acknowledgment only. If the team wants plan.md itself to reflect this, it could get a short addendum note, but the work is already correctly documented in lessons.md and the commit history (`70f675e`, `de78230`).
- **Decision**: SKIPPED — user agreed no action needed; already documented in lessons.md and commit history.
