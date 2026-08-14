<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin can remove a user

- **Plan**: `context/changes/admin-remove-user/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE (fixed during triage → SOUND)
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (`migrations/0004_sessions_cascade_delete.sql:3`, `migrations/0008_instrument_registry.sql:32`, `migrations/0011_alert_notifications.sql:13,74`, `src/worker/routes/admin.ts:196-241`, `src/app/core/shell/shell.html:64-80`, `src/app/app.routes.ts:20-34`), 3/3 symbols ✓ (`Variables = { userId: number }` in `admin.ts:13`/`lib/admin.ts:9`, `adminMiddleware`, `parseAlertId` in `alerts.ts:235-238`), brief↔plan ✓.

## Findings

### F1 — Self-delete guard never fires (string vs number type mismatch)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — `DELETE /users/:id` contract (and `GET /users/:id/impact`)
- **Detail**: The original plan's `DELETE /users/:id` contract described the self-delete guard as `id === c.get('userId')`. `c.req.param('id')` in Hono always returns a `string`; `c.get('userId')` is typed `number` (`Variables = { userId: number }`, `src/worker/routes/admin.ts:13`). A string-to-number strict equality comparison (`'5' === 5`) always evaluates `false` in JS, so the guard as literally specified would never trigger — silently defeating the plan's own Desired End State promise that "Self-deletion is impossible... via direct API calls (cannot_delete_self)". The codebase already solves this exact problem elsewhere: `src/worker/routes/alerts.ts:235-238` defines `parseAlertId(idParam: string): number | null` (`Number(idParam)` + `Number.isInteger` guard), used at `alerts.ts:241`/`:289` with an explicit 400 `invalid_alert_id` on parse failure. This plan's `/users/:id` routes are the first numeric-id routes on `adminRoutes` (existing routes there key on `:ticker`, a string), so the type mismatch wasn't caught by copying an existing admin.ts pattern.
- **Fix**: Add explicit `:id` parsing via a `parseUserId`-style helper mirroring `alerts.ts`'s `parseAlertId` (`Number(idParam)` + `Number.isInteger` guard, 400 `invalid_user_id` on failure) in both `GET /users/:id/impact` and `DELETE /users/:id`, before any further logic — including the self-delete comparison. This also aligns the 400-vs-404 convention (malformed id vs. valid-but-missing id) with the existing `alerts.ts` pattern instead of relying on implicit SQLite type-affinity conversion.
- **Decision**: FIXED (applied directly to `plan.md`'s Phase 1 contracts for both endpoints, the Current State Analysis discovery note, and the Phase 1 test coverage description — the delete test for `cannot_delete_self` is now explicitly called out as the regression guard for this fix)
