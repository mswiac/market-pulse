<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Unify primary color (toolbar, FAB, active nav link)

- **Plan**: context/changes/unify-primary-color/plan.md
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — Nested MDC elements have their own independent color tokens; plain background/color override won't reach them

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff/non-trivial edit; think before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1, changes #1 (Toolbar) and #2 (FAB)
- **Detail**: The plan's fix for the toolbar and FAB is "set background-color/color on the host element." Verified directly in the installed Angular Material source that this won't fully work for either:
  - Toolbar: the "Log out" button inside it is a plain `mat-button`, whose M3 default text color is hardcoded to `--mat-sys-primary`, independent of any ancestor `color` (`node_modules/@angular/material/button/_m3-button.scss:109`: `button-text-label-text-color: map.get($system, primary)`). Today this renders fine because the toolbar background is muted/non-primary. Once the toolbar background becomes `--mat-sys-primary` (this plan's own change), the "Log out" label — still primary-colored — becomes invisible against an identical-colored background.
  - FAB: its icon and label foreground color is bound to its own `fab-foreground-color`/`fab-state-layer-color` tokens (`node_modules/@angular/material/button/_m3-fab.scss:41,67`), both set to `on-primary-container` — a token designed to contrast against `primary-container`, not `primary`. MDC components generally paint from their own internal CSS custom properties, not inherited `color`, so the plan's `color: var(--mat-sys-on-primary)` on `.new-alert-fab` may not actually reach the icon/label at all.
  - Precedent in this codebase: `alert-list.scss:21` needed `!important` to override `mat-expansion-panel-header`'s background — a real MDC component, same family as toolbar/FAB. `.active-link` (a plain `<a mat-list-item>`, not MDC-color-token-driven) works fine without it today, which is why the plan's active-link change is not at risk — only the two MDC-based changes are.
- **Fix A ⭐ Recommended**: Override Material's own internal CSS custom properties, not just background/color
  - Strength: Angular Material's documented, guaranteed theming override mechanism — sidesteps all specificity/inheritance uncertainty.
  - Tradeoff: Requires identifying the exact custom property names via devtools (computed styles on `.mdc-fab__icon`, `.mdc-fab-extended__label`, `.mdc-text-button__label`) during Phase 1 rather than guessing them in the plan text.
  - Confidence: HIGH — token independence confirmed directly in Angular Material's source; only the exact CSS custom property names need runtime confirmation.
  - Blind spot: None significant — the plan's existing manual verification step would have caught this before merge either way; this fix just makes it right the first time.
- **Fix B**: Keep the plain background-color/color override, verify empirically first
  - Strength: No extra investigation up front.
  - Tradeoff: Given the hardcoded-token evidence, the toolbar case is very likely to fail as-is.
  - Confidence: LOW — bets against confirmed source evidence.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — Phase 1's toolbar/FAB Contract now targets Material's internal CSS custom properties, plus a new "Critical Implementation Details" section explaining why)
