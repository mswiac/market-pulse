<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Alert Pause

- **Plan**: context/changes/manual-alert-pause/plan.md
- **Scope**: Full plan (Phase 1 and Phase 2 of 2)
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria: typecheck, lint, Prettier (all changed files), 380 worker tests, 196 Angular tests and the pause/edit/delete e2e specs all passed after the Prettier pass; manual rows 1.4, 2.6 and 2.7 were confirmed by the user.

## Findings

### F1 — Resume forces armed = 1 without checking the threshold condition

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/alerts.ts (PATCH /:id, `armed = CASE WHEN ? = 0 THEN 1 ELSE armed END`)
- **Detail**: POST and PUT compute the initial armed state with `computeArmed`, so an alert whose condition is already met is stored disarmed and does not mail on the next cron run. Resume bypasses that: if the price is still past the threshold, the next cron run mails immediately although the user only resumed the alert. This was an explicit planning decision ("always arm", recorded in the plan's brief as an accepted risk), and the worker test "pauses an alert, keeps it paused through an edit, and resumes it re-armed" encodes it.
- **Fix A ⭐ Recommended**: Keep the decided behaviour and make it explicit
  - Strength: Matches the user's recorded decision; no extra Yahoo call or latency on a one-click action.
  - Tradeoff: A resumed alert with an already-met condition can mail once on the next cron run.
  - Confidence: HIGH — the plan and brief state this choice.
  - Blind spot: Real users may find the immediate mail noisy, which is the problem issue #199 targets.
- **Fix B**: Recompute armed on resume with `ensureFreshMarketData` + `computeArmed`, as PUT does
  - Strength: Consistent with create/edit; no surprise mail after resuming.
  - Tradeoff: Reverses a user decision; resume then costs a possible Yahoo refresh and the handler grows.
  - Confidence: MEDIUM — straightforward, but the user chose against it.
  - Blind spot: Resume latency when market data is stale.
- **Decision**: FIXED via Fix B — PATCH resume now refreshes market data and recomputes `armed` with `computeArmed`, like create/edit (reverses the planning-time "always arm" choice; plan.md and plan-brief.md still describe the old behaviour and are left as written). Worker tests updated and extended.

### F2 — Deploy order: migration 0016 must reach remote D1 before the worker

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: migrations/0016_alert_paused.sql, src/worker/routes/alerts.ts (ALERT_SELECT), src/worker/lib/alert-evaluation.ts (cron SELECT)
- **Detail**: `npm run deploy` does not apply migrations. A worker deployed before the migration returns 500 from GET /api/alerts and the cron evaluates nothing. The plan already records this under Critical Implementation Details.
- **Fix**: State the `npm run migrate:remote` step in the PR description so it is done before the deploy.
- **Decision**: FIXED — the `npm run migrate:remote`-before-deploy step goes into the PR description.

### F3 — pauseError reuses the delete-error CSS class

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-list/alert-list.html (pauseError paragraph)
- **Detail**: The pause error message uses `class="delete-error"`, which is now misleadingly named. Behaviour is correct.
- **Fix**: Rename the class to a neutral `action-error` in the template and alert-list.scss, or leave it.
- **Decision**: FIXED — `delete-error` renamed to `action-error` in alert-list.html and alert-list.scss.

### F4 — New messages.xlf units lack location context-groups

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/locale/messages.xlf (four alertList.* units)
- **Detail**: The units were added by hand because `extract-i18n` rewrote about 900 lines of the file. They have no `context-group` blocks, unlike neighbouring units; a later extraction will add them as diff noise. No functional effect.
- **Fix**: None needed now; the next deliberate i18n extraction normalises them.
- **Decision**: FIXED — `context-group` location blocks added to the four new messages.xlf units.
