<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Alert CRUD (S-02) Implementation Plan

- **Plan**: context/changes/alert-crud/plan.md
- **Mode**: Deep
- **Date**: 2026-07-19
- **Verdict**: REVISE (initial) → SOUND (after triage fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓. Deep-mode sub-agent additionally confirmed: Angular Material 22.0.4 has all APIs the plan assumes (`MatExpansionModule`, `MatDialogModule`, `MatDialogRef.close()`, `MatDialog.open()`); a live D1 insert against the Phase-1 `CHECK` constraint throws `D1_ERROR: CHECK constraint failed: ...: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)` — the substring `"CHECK constraint failed"` the plan implies checking for is present, so Phase 2's contract is safe as written; `EMAIL_PATTERN`/`normalizeEmail` have zero other references outside `auth.ts` (safe to extract); `RETURNING` and camelCase SQL aliasing have no other precedent in the codebase (only used, respectively, once and never before this plan).

## Findings

### F1 — No fallback for an unmapped POST /api/alerts error

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Alert form (dialog content)
- **Detail**: The Contract only specifies Polish-message mapping for two known error cases: 409 (duplicate → "Taki alert już istnieje.") and the VIX+RSI 400 (→ "RSI nie jest dostępne dla VIX."). The `error: (err) => ...` handler has no named fallback for any other/unexpected response (a server 500, a network failure, or a validation 400 that isn't the VIX+RSI case slipping past client-side checks). Without a generic branch, an unmapped error risks exactly the "silent failure" the plan otherwise works hard to avoid.
- **Fix**: Add a default branch in the error handler — any error not matching the two named cases sets a generic form-level message ("Wystąpił błąd. Spróbuj ponownie.") via the same `setErrors({ server: true })` + `markAsTouched()` pattern, so no error path leaves the dialog silently stuck.
- **Decision**: FIXED — plan.md Phase 4 §1 Contract now specifies the fallback branch

### F2 — Phase 4 Progress has 8 manual rows, Phase block has 7 bullets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 Success Criteria vs. `## Progress`
- **Detail**: Phase 4's `#### Manual Verification:` block lists 7 bullets. The last one ("Click a created alert to expand it...") was split into two separate Progress rows (4.9, 4.10) with no matching split in the Phase block itself — a mechanical 1:1 mismatch in the Progress↔Phase contract that `/10x-implement`/`/10x-archive` rely on.
- **Fix**: Split the 7th Phase-4 manual bullet into two bullets (one for email/last-edited/price, one for the conditional RSI row) so the Phase block's bullet count matches Progress 4.3-4.10 exactly.
- **Decision**: FIXED — plan.md Phase 4 Manual Verification split into two bullets matching Progress 4.9/4.10

### F3 — camelCase SQL aliasing has no precedent in this codebase

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Alerts route module
- **Detail**: Verified via grep: `alert_type AS alertType`-style camelCase SQL aliasing has zero prior use anywhere in this codebase (`users`/`sessions` queries never alias, since their columns are already camelCase-clean). Not wrong, and a reasonable idiom for a no-ORM codebase — just a new pattern, not a reuse of an established one.
- **Fix**: None needed — noted for awareness only.
- **Decision**: ACCEPTED — no change; new idiom is reasonable for a no-ORM codebase
