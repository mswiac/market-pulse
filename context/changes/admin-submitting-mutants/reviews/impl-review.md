<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Harden admin panel tests against submitting-flag / double-submit mutants

- **Plan**: context/changes/admin-submitting-mutants/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-08-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `prettier --write` reformatted pre-existing test code in all four specs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/app/features/admin/admin-panel.spec.ts, add-instrument/add-instrument.spec.ts, remove-instrument/remove-instrument.spec.ts, remove-user/remove-user.spec.ts
- **Detail**: `origin/main`'s versions of these four spec files were already prettier-non-conformant (`.prettierrc` `printWidth: 100`; they were merged that way in PR #106/#112). Running `prettier --write` on them during Phases 1–2 reformatted ~20+ pre-existing lines (arrow helpers split across lines, `expect(await screen.findByText(...))` wrapped, the `RESULT` object expanded, `throwError(() => new HttpErrorResponse(...))` wrapped). Consequences: (a) the plan's manual criterion 1.5 / 2.5 ("existing tests unchanged — diff only adds blocks + cast") no longer literally holds; (b) the PR diff mixes formatting churn with the real change; (c) the fix is partial — three sibling admin specs (`admin-panel.service.spec.ts`, the two `*-confirm` specs) remain prettier-dirty, so the admin test dir is now internally inconsistent. Prettier is not wired into any npm script, pre-commit hook, or CI gate, so there is no "fixes a broken gate" upside — it is pure diff noise. Semantically the existing tests are unchanged and still pass (63 green).
- **Fix**: Accept the reformatting and note it explicitly in the PR #117 body (the body already mentions line-wrapping — expand it to say "pre-existing prettier violations at printWidth 100 in the touched files were auto-fixed as a side effect; three sibling admin specs remain dirty"). `.prettierrc` is the documented repo standard (CLAUDE.md references it), the reformatted output is correct, and reverting would mean deliberately committing non-conformant new code. Optionally follow up with a standalone `chore: prettier --write src/app/features/admin/**/*.spec.ts` to make the whole dir conformant in one clearly-labelled commit.
- **Decision**: FIXED — PR #117 body extended with a "Formatting note" section (commit-free, PR-metadata only). Reformatting kept.

### F2 — `submitting()` observed via signal read, not the `mat-select` DOM node

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/features/admin/remove-instrument/remove-instrument.spec.ts, remove-user/remove-user.spec.ts
- **Detail**: Plan Phase 2 specified asserting the dialog components' `mat-select [disabled]="submitting()"` binding via an accessibility-first locator, as a second independent observation point. The implementation instead reads `component.submitting()` directly (a `protected` signal exposed through the existing test cast). This is more robust (no coupling to Angular Material internals) and gives the same kill coverage for the in-scope `BooleanLiteral` mutants — confirmed by the Stryker re-run (0 `submitting` survivors in both files). Trade-off: the `[disabled]="submitting()"` template binding on the `mat-select`s is now not asserted by any test. It is not mutated by any in-scope mutant (Stryker only mutates `.ts`), so no coverage was lost against this change's goal. The deviation is recorded inline in the plan's Progress section (item 2.4).
- **Fix**: None required — documented adaptation within the plan's explicit fallback clause ("If not, fall back to asserting only the button").
- **Decision**: SKIPPED — accepted as documented adaptation.

### F3 — one equivalent mutant left alive (`remove-user.ts:54`)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/app/features/admin/remove-user/remove-user.ts:54
- **Detail**: `if (!this.canSubmit() || id === null) return;` — Stryker's `ConditionalExpression` mutant replacing `id === null` with `false` survives. It is provably equivalent: `canSubmit = selectedUserId() !== null && !submitting()` and `id = selectedUserId()`, so whenever `!canSubmit()` is `false`, `id` is not `null` and the mutated operand never changes the outcome. The `id === null` check is a pure TypeScript control-flow-narrowing device for the `getUserImpact(id)` call below. Left alive and documented in the #113 before/after comment and the `test-plan.md` §3 Phase 5 note, consistent with CLAUDE.md's "don't chase 100%" and the #91 precedent. `admin-panel.ts`'s analogous `|| !from || !to` guard mutants were all killed (there each date can independently be null while `canSubmit` is false, so they are genuinely not redundant).
- **Fix**: None — correct call, correctly documented.
- **Decision**: SKIPPED — accepted; equivalent mutant, documented.
