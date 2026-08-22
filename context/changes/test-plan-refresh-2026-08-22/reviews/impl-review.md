<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Plan Refresh (2026-08-22) Implementation Plan

- **Plan**: context/changes/test-plan-refresh-2026-08-22/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-08-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Roadmap slice count off by one ("18" should be "17")

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:9-10
- **Detail**: The header note reads "all 18 roadmap slices done." `context/foundation/roadmap.md`'s "At a glance" table lists exactly 17 slices (F-01, F-01a, F-02, S-01–S-03, F-03, S-04, S-07, S-05, S-06, S-08, S-09, F-04, S-10–S-12), all `done`. The "18" figure originated in `change.md`'s Notes and was echoed by `research.md`'s Research Question and `plan.md`'s Overview during earlier planning sessions, then propagated uncorrected into this phase's rewrite of the shipped document. The plan's own Desired End State requires `test-plan.md` to "accurately reflect the current codebase" — this is the one factual figure in the rewrite that doesn't hold up against `roadmap.md` itself (as opposed to `research.md`, which was the plan's stated grounding source and does state "18" — so this isn't research-drift, it's an uncaught error in research.md's own count that reached the shipped doc).
- **Fix**: Change "18" to "17" in `context/foundation/test-plan.md` line 9-10.
- **Decision**: FIXED

### F2 — §6 Cookbook Patterns still describes the old, pre-rewrite phase scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:137-155 (§6.1–§6.4)
- **Detail**: The plan's Implementation Approach explicitly left §6 as `TBD` (no rollout phase has shipped a test yet), which this phase correctly did not touch. But §3's phase table was fully renamed and rescoped by this same phase, and §6's parenthetical descriptions still describe the *old* phase content: §6.1 says "see §3 Phase 1 (RSI calculation, Stooq validation, and cron error surfacing patterns)" but the new Phase 1 is "Notification/evaluation pipeline regression audit" (resend.ts + S-08 gaps, nothing to do with RSI/Stooq/cron). §6.2 and §6.4 point at "Phase 2 (Hono endpoint + local D1 binding, two-fixture-user pattern)" but the new Phase 2 is multi-provider + admin-delete data integrity — the two-fixture-user pattern now belongs to Phase 4. §6.3 points at "Phase 3 (Resend stub call-assertion pattern...)" but the new Phase 3 is the Angular frontend test bootstrap. A future reader following "see §3 Phase N" to find a test-writing pattern will land on a phase description that no longer matches.
- **Fix**: Simplify §6.1–§6.4 to `TBD — see §3 Phase N.` without the stale parenthetical content-descriptions, since the parenthetical is what went stale, not the phase pointer itself.
- **Decision**: FIXED — also corrected §6.3's phase pointer from Phase 3 to Phase 1, since Phase 1's rescoped work (the `resend.ts` fetch-throw fix) is where the external-service-stub pattern will actually land, not Phase 3 (frontend bootstrap).

### F3 — Imprecise line citation for `conditionMet`

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md §2 Risk Response Guidance, row #1
- **Detail**: The cell cites "`resolveFiringValue`/`conditionMet`, `:76-97`" for both functions. `conditionMet` is actually defined at `alert-evaluation.ts:68`, outside that range — `research.md:47` only assigns `:76-97` to `resolveFiringValue`. The underlying claim (this S-08 logic has no independent oracle) is still correct; only the line pointer for `conditionMet` is off.
- **Fix**: Split the citation, e.g. `resolveFiringValue (:76-97), conditionMet (:68)`.
- **Decision**: PENDING

### F4 — "build command is `npm run ci`" stated without its source qualifier

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md §5, paragraph below the Quality Gates table
- **Detail**: `research.md:125` explicitly qualifies this as "Per the user" — the Cloudflare Workers Build's configured build command isn't independently checkable from this repo (Cloudflare dashboard config). `test-plan.md` states it as a bare fact. The load-bearing part of the claim — that a required, blocking status check exists on `main` — was independently re-verified by the reviewing agent via `gh api repos/mswiac/market-pulse/branches/main/protection`, so this is a sourcing-precision nit, not a wrong fact.
- **Fix**: Optional — add "(per the user)" or similar if a future refresh wants to preserve the verifiability distinction research.md drew.
- **Decision**: PENDING

## Notes

Two parallel sub-agents reviewed this change: **Plan Drift Detection** verified all 7 "Changes Required" items in Phase 1 against their Contracts and against `research.md`'s Detailed Findings — all 7 MATCH, every file:line citation in the new Risk Map / Risk Response Guidance tables (`resend.ts:23-42`, `alert-evaluation.ts:116,159-161`, `scheduled.ts:50`, `admin.ts:74`, `market-data.ts:149-158`, `alert-form.ts:18-23,72,101-111`, `admin.ts:227-233`, migrations `0004/0008:32/0011:13,75`, `admin.test.ts:592-643,826-860`, `alerts.ts:204-301`, `trigger-events.ts:47-59`, `lib/admin.ts:14-23`, `admin.ts:8,37-100`, `admin.test.ts:210-218`) checked out. No "What We're NOT Doing" boundary was violated (no test code, no `src/worker` changes, no Vitest/Karma tooling actually installed, no manual remote-D1 check run, no CLAUDE.md changes beyond the one named line). No unplanned scope creep — the only extra diff content is the standard 10x-toolkit bookkeeping (`change.md` status flip, `plan.md` Progress checkboxes).

**Safety, Quality & Pattern Compliance** independently spot-verified the change's load-bearing factual claims against the live codebase and `git log` (not just against `research.md`): confirmed no Karma package exists, `angular.json` has no `test` architect target, `tsconfig.spec.json` does declare `vitest/globals`, `resend.ts:23-42` really doesn't catch a throwing `fetch`, `MAX_RANGE_DAYS = 730` at `admin.ts:8`, the churn figures (14 commits/83 touches for `src/app/features`; 5/3/2/2/1/1 breakdown for `src/worker/lib`) match `git log --since` exactly, zero `.spec.ts` files exist, exactly 3 two-user isolation tests exist in `alerts.test.ts`, and the required Cloudflare Workers Builds status check on `main` is real (independently checked via `gh api`). All Markdown tables in §2 were programmatically checked for column-count integrity — none are broken despite long cells with backticks and em-dashes. No Polish text and no `lessons.md` violations in any of the 4 touched files.

Both agents' one substantive shared finding is F2 (§6's stale phase descriptions) — reported independently by each, which raises confidence it's real and worth fixing before the doc is considered fully fresh.
