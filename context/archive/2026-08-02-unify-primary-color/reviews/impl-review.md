<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Unify primary color (toolbar, FAB, active nav link)

- **Plan**: context/changes/unify-primary-color/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-08-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Two unplanned CSS tweaks landed alongside the 5 planned items

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: shell.scss:31-33 (sidenav width 15rem→17rem), shell.scss:44-49 (nav-item label weight)
- **Detail**: Neither was in the plan's "Changes Required." Both emerged live during manual testing in this same conversation: the sidenav was too narrow for the plan's own renamed label ("Pobierz dane giełdowe") and got truncated, and the label-weight tweak was an explicit follow-up request comparing nav text to the FAB button. Both are small, low-risk, directly downstream of item 5 and the FAB fix already in scope.
- **Fix**: No code change needed — documentation formality only. Already captured in the phase-1 commit message; accepted with no further action.
- **Decision**: FIXED (accepted — no code change, matches proposed fix)

### F2 — Minor pattern-consistency notes (non-blocking)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: shell.html, home.html, shell.scss, home.scss
- **Detail**: `shell.html`/`home.html` fail `prettier --check`, verified pre-existing (baseline at eaab2d4 already fails identically) — not a regression. The new CSS-custom-property override technique is Angular Material's official M3 theming API, more idiomatic than the `!important`-on-selector technique already used in `alert-list.scss`/`instrument-history.scss` — two override styles now coexist in the codebase. New comments in `shell.scss`/`home.scss` are longer than the codebase's typical 1-liners, but content is legitimate non-obvious WHY, consistent with CLAUDE.md's "minimal comments" rule.
- **Fix**: No action needed now. Worth a mention if the project ever does a design-system consistency pass unifying override technique across all Material component overrides — out of scope for this change.
- **Decision**: FIXED (accepted — no code change, matches proposed fix)
