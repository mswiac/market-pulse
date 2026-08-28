<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Harden register tests against submitting-flag / double-submit mutants

- **Plan**: context/changes/register-submitting-mutants/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Re-enable-on-error test adapted from the plan's literal assertion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/features/auth/register/register.spec.ts:107-127
- **Detail**:
  Plan Phase 1 §4 specified: `pending.error(new HttpErrorResponse({ status: 500 }))`
  then `expect(submitButton().disabled).toBe(false)` directly. That assertion is
  wrong for `register` — the error handler runs `form.controls.email.setErrors({ server: true })`
  unconditionally (register.ts:49), so the form stays invalid and the button stays
  disabled after the error regardless of `submitting`. The implementation adapted:
  the test now edits the email control (clearing the server error) and only then
  asserts the button re-enables — which still isolates `submitting.set(false)`
  (mutant `:40` would keep the button disabled even after the edit). The deviation
  is documented in the phase-1 commit body and was surfaced at the manual gate.
  The Stryker after-run independently confirms mutant `:40` is killed.
- **Fix**: None needed — keep the adapted test. Optionally backfill a one-line note
  into the plan's Phase 1 §4 contract so the plan matches what shipped.
- **Decision**: FIXED — plan.md Phase 1 §4 contract updated with the adaptation note.

### F2 — `submitValidForm` helper and untyped thrown error not in the plan

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/features/auth/register/register.spec.ts:132-140, 149
- **Detail**:
  The plan didn't name a `submitValidForm` helper, but it mirrors
  `alert-form.spec.ts`'s `submitValidCreate` (the plan's stated reference pattern),
  de-dupes the two error-branch tests, and reads cleanly. The plain-object throw
  `throwError(() => ({ status: 409 }))` at :149 is deliberate (the test's whole
  point is a non-`HttpErrorResponse`) and compiles because RxJS's `throwError`
  factory is `() => any`; a cast would obscure intent. Both are benign.
- **Fix**: None — leave as is.
- **Decision**: SKIPPED — both match the sibling pattern and are benign.
