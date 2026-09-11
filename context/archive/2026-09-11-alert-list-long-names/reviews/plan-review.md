<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Alert List Long Instrument Names — Implementation Plan

- **Plan**: context/changes/alert-list-long-names/plan.md
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths verified via `ls -l` and `Read`; 3/3 symbols verified against compiled `@angular/material` 22.0.4 source (not just grep) — `--mat-expansion-header-collapsed-state-height`/`-expanded-state-height` tokens confirmed real and correctly resolved under this project's `density: 0` theme config; `[expandedHeight]`/`[collapsedHeight]` inputs confirmed unbound in `alert-list.html` (so no competing inline `[style.height]`); `mat-expansion-panel`/`MatExpansionModule` usage confirmed limited to `alert-list.ts`/`.html` only (no blast radius elsewhere). Brief↔plan consistent. Progress↔Phase mechanical contract holds (2/2 phases, 11/11 success-criteria bullets matched, no stray checkboxes in Phase blocks).

## Findings

### F1 — Height override Contract omits the one detail that makes it work

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Change #2 ("Allow the instrument name to wrap without clipping")
- **Detail**: Traced Material 22.0.4's compiled source (`fesm2022/expansion.mjs` + bundled styles). Material's own stylesheet sets `.mat-expansion-panel-header { height: var(--mat-expansion-header-collapsed-state-height, 48px); }` — a class selector (specificity 0,1,0). The plan's Contract targeted the bare element selector `mat-expansion-panel-header` (specificity 0,0,1) — lower specificity, so a plain `height: auto;` there would be silently beaten by Material's own rule and change nothing on screen. The plan's prose gestured at "follow that existing pattern's specificity approach" but the Contract's own example snippet didn't show `!important`, so an implementer copying it literally would ship a no-op.
- **Fix**: Make the Contract explicit: `mat-expansion-panel-header { height: auto !important; min-height: var(--mat-expansion-header-collapsed-state-height, 48px) !important; }`.
- **Decision**: FIXED — plan.md Phase 2 #2 Contract updated to state `!important` explicitly with the specificity rationale.

### F2 — Phase 1 alone doesn't close issue #148

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach / Phase ordering
- **Detail**: If Phase 1 ships/merges alone, the alerts list's instrument-name column is unchanged (`11rem`) until Phase 2 lands, so the original reported bug (issue #148) isn't yet fixed — and the wider `64rem` container just pushes more blank space into the trailing "Threshold" column in the meantime.
- **Fix**: Added a note to the plan's Implementation Approach section clarifying Phase 1 alone doesn't close issue #148.
- **Decision**: FIXED — plan.md Implementation Approach updated with an explicit note.
