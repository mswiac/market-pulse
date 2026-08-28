<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Harden alert-form tests against submitting-flag / double-submit mutants

- **Plan**: context/changes/alert-form-submitting-mutants/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Test-only change, one production-adjacent file (`alert-form.spec.ts`) plus a
`test-plan.md` §3 note and change-folder artifacts. `git diff origin/main` touches
**zero** production `.ts` / `.html` / `.scss`. Every planned `it` block landed;
the render helper was parameterized exactly as planned (options bag, matching
`remove-user.spec.ts`). The one plan deviation — Stryker `--mutate` scoped to
`alert-form.ts:146-181` instead of the whole file — was surfaced as a mismatch,
approved by the user, and written into the plan as an ADAPTATION note before
proceeding. Automated criteria all green (74 tests, build, prettier). Mutation
score on the scoped range: 0/42 → 37/42 detected; the targeted class (guard
`:147`, `submitting.set()` `:150`/`:161`, `messageFor` branches `:168-180`) is
100% killed. 5 residual survivors documented as out-of-scope (→ #110), one of
them equivalent.

## Findings

### F1 — Six messageFor `it` blocks where the plan enumerated four

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/app/features/alerts/alert-form/alert-form.spec.ts:277-289
- **Detail**: Phase 2's plan text says "Four new `it` blocks" for `messageFor`.
  The implementation has six: the four planned (409 / 404 / 400+rsi / generic)
  plus two added during Phase 3 verification
  ("needs BOTH a 400 and the rsi_not_eligible code…") to kill three surviving
  `LogicalOperator` / `ConditionalExpression` mutants on the `:176` condition.
  Also one extra guard block, "does not submit while the form is invalid"
  (:152), beyond Phase 1's five. All additions are within the user-approved
  "whole guard as a unit" + "cheap hits for the error map" decisions and each
  kills a real mutant — not scope creep, just finer granularity than the plan
  spelled out.
- **Fix**: None needed — accept as-is. The extra blocks are load-bearing (they
  move three mutants from Survived to Killed).
- **Decision**: SKIPPED — accepted as-is; extra blocks are load-bearing.

### F2 — Section-header block comments are heavier than the repo's spec style

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/alerts/alert-form/alert-form.spec.ts:142-147, 241-244
- **Detail**: Two multi-line `// ---` banner comments explain the pre-change
  coverage gap and the mutation-testing rationale. Sibling specs
  (`add-instrument.spec.ts`, `remove-user.spec.ts`) have no such banners, and
  CLAUDE.md asks for "minimal code comments — only non-obvious WHY". The WHY
  here (why these blocks exist, what mutants they target) is genuinely
  non-obvious to a future reader, so the comments have value — but they could
  be tightened to 1–2 lines each.
- **Fix**: Optionally trim each banner to a single sentence; or leave as-is —
  the content is accurate and the "why" is non-trivial.
- **Decision**: FIXED — both banners trimmed to a single sentence.
