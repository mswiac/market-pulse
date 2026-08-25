<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Plan Refresh (2026-08-25)

- **Plan**: context/changes/test-plan-refresh-2026-08-25/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-08-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — PR #91 file count is undercounted (12 vs. actual 14)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:283 (also research.md:57,71 and change.md's "13 modules" phrasing)
- **Detail**: test-plan.md's new §8 Freshness Ledger bullet states PR #91 touched "12 `test/worker/*.test.ts` files." `git diff --stat 8a2884f^..07bef80 -- test/worker/` shows **14 files changed**, not 12. The line-count figure ("~823 lines added") is correct. The error originates in research.md (which test-plan.md faithfully transcribed) and recurs as "13 modules" in change.md's Notes — same systemic miscount across all three change artifacts.
- **Fix**: Update "12" → "14" in test-plan.md:283 and research.md:57/71, and "13" → "14" in change.md's Notes.
- **Decision**: FIXED

### F2 — Commit-range notation implies 5 commits, text says 6

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:283 (also research.md:26,33)
- **Detail**: The range is written as `` `8a2884f`..`07bef80` `` alongside "6 commits." Git's `A..B` syntax excludes `A`; `git log 8a2884f..07bef80` returns 5 commits, not 6. Reaching 6 requires `8a2884f^..07bef80` (confirmed: `git log --oneline 8a2884f^..07bef80 | wc -l` → 6). A reader who pastes the cited range literally gets numbers that don't match the adjacent "6 commits" / "823 lines" claims.
- **Fix**: Change the notation to `` `8a2884f^`..`07bef80` `` (or list the 6 short hashes explicitly) in test-plan.md:283 and research.md:26,33.
- **Decision**: FIXED

### F3 — Risk #8's Guidance row lacks the file:line citation density of rows #1-7

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:82 ("Context `/10x-research` grounded" column)
- **Detail**: Rows #1-#7 in this column all pin specific `file:line` citations (e.g. row #7: `` `admin.ts:8,37-100`, `admin.test.ts:210-218` ``). Row #8 names files only (`remove-instrument.ts`, `remove-user.ts`) with zero line numbers, even though research.md's Code References section already has them (e.g. `remove-instrument.ts:35,76-118`, `remove-instrument-confirm.ts:16`, `remove-user.ts:33,44-94`, `add-instrument.ts:19-21,53-137`, `admin-panel.ts:46-133`).
- **Fix**: Backfill row #8's "Context grounded" cell with the specific line citations already in research.md's Code References section, matching rows #1-#7's citation density.
- **Decision**: FIXED

### F4 — Phase 5 scope note drops the required Key Discovery citations

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:104
- **Detail**: The plan's Contract for this item specifies the scope-note text should cite "(Key Discovery #2)" after the `admin-panel.ts` mention and "(Key Discovery #3)" after the cookbook-stays-TBD clause. The implemented bullet omits both citations, substituting an unplanned inline path to `research.md` instead. The underlying scope decision is correctly reflected (all 6 components, cookbook stays TBD) — this is a literal-text deviation from the Contract, not a scope or intent error.
- **Fix**: Add "(Key Discovery #2)" and "(Key Discovery #3)" at the cited points in the Phase 5 scope-note bullet, per the plan's Contract wording.
- **Decision**: FIXED
