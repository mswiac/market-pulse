<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin can add a new instrument to the registry

- **Plan**: context/changes/admin-add-instrument/plan.md
- **Scope**: Phase 5 of 5 (all phases)
- **Date**: 2026-08-09
- **Verdict**: NEEDS ATTENTION (pre-triage) → APPROVED (post-triage, all findings resolved)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — plan.md's Phase 5 text is stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/admin-add-instrument/plan.md:194-240
- **Detail**: Phase 5's "Changes Required" still described the abandoned design (second `mat-card` on `admin-panel.html`, currency text field with regex, no ticker-uppercase). Actual implementation (directed by the user mid-testing) is a separate route/component `AddInstrument` at `/admin/add-instrument`, a fixed EUR/PLN/USD select for currency, and ticker uppercase normalization server+client side.
- **Fix**: Rewrote Phase 5's Overview/Changes-Required text and the Desired End State's "second card" line to describe the actual two-page structure, currency select, and ticker normalization. Phase heading text left unchanged (Progress↔Phase mechanical contract).
- **Decision**: FIXED

### F2 — `rsiEligible` silently coerces invalid input to `false`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/admin.ts:150
- **Detail**: `const rsiEligible = body.rsiEligible === true;` silently coerced any non-boolean (missing, string `"true"`, `1`) to `false`, unlike every other field in the handler which explicitly rejects malformed input with its own error code.
- **Fix**: Added explicit `typeof body.rsiEligible !== 'boolean'` check returning `instrument_rsi_eligible_invalid` (400). Added matching frontend `ERROR_MESSAGES` entry + `messages.pl.xlf` translation + backend test (`admin.test.ts`).
- **Decision**: FIXED

### F3 — Missing malformed-JSON-body test for the new endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/worker/admin.test.ts (new `describe` block)
- **Detail**: `alerts.test.ts` has a "rejects a malformed JSON body with 400" test for its analogous `POST /`. The new `POST /instruments` suite lacked the equivalent.
- **Fix**: Added a test posting `'{not valid json'` to `/api/admin/instruments` asserting 400 with `code: 'invalid_body'`.
- **Decision**: FIXED

### F4 — Sidebar "History" group order: which alphabet?

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/core/shell/shell.html:33-45
- **Detail**: "History" group is ordered by Polish target text (Uruchomione alerty before Walory — U before W), which reverses the English source order (Instruments before Triggered alerts — already alphabetical pre-change). Confirmed with the user this is intentional (sorting by the rendered Polish UI, which is what the user actually sees).
- **Fix**: None — current state is the intended behavior.
- **Decision**: ACCEPTED
