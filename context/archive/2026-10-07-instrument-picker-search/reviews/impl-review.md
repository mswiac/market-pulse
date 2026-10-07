<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Searchable InstrumentPicker

- **Plan**: context/changes/instrument-picker-search/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated re-run during review: typecheck (app + spec), lint, `test:ci` (118 passed), `build` all pass; Progress has 0 pending rows. E2E (6 passed) was last run at the end of Phase 4 and not repeated here because it mutates local dev data.

## Findings

### F1 — Planned picker unit tests missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/features/instruments/instrument-picker/instrument-picker.spec.ts
- **Detail**: The plan's Testing Strategy lists "select by click and keyboard" and "unresolved ticker before catalogue load". Neither is covered. The `disabled` input (used by remove-instrument while submitting) and `setDisabledState` are also untested.
- **Fix**: Add three cases: keyboard selection (ArrowDown + Enter), a ticker written before the catalogue loads that resolves its label once instruments arrive (needs a signal-backed `InstrumentsService` stub), and disabled state.
- **Decision**: FIXED (picker spec: keyboard selection, ticker before catalogue load, disabled input and form control)

### F2 — Source xlf not updated, contrary to the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/locale/messages.xlf
- **Detail**: The plan says new i18n ids go into both xlf files and orphaned ids are removed from both. Only `messages.pl.xlf` was edited. `messages.xlf` was already stale before this change (running `extract-i18n` rewrote ~700 lines), so the choice was deliberate but it is not recorded in the plan.
- **Fix**: Add a short addendum to the plan stating that `messages.xlf` is intentionally untouched because it is out of sync, and open a separate issue to regenerate it.
- **Decision**: FIXED (plan addendum records the deliberate omission of messages.xlf)

### F3 — Unplanned file and folder in the change

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: e2e/seed.spec.ts
- **Detail**: Phase 4 lists only `e2e/delete-alert.spec.ts`, but `e2e/seed.spec.ts` uses the same instrument-selection flow and had to change too. The first commit also carries `context/changes/alerts-list-filtering/` (a different change). Phase 5 (admin panel) was added to the plan before implementation, so it is not drift.
- **Fix**: Mention `seed.spec.ts` in the Phase 4 section of the plan.
- **Decision**: FIXED (plan addendum mentions seed.spec.ts)

### F4 — Invalid-instrument hint reappears while typing after the first blur

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/features/instruments/instrument-picker/instrument-picker.ts:46
- **Detail**: `touched` is set on blur and never reset, so once the field has been blurred the "Choose an instrument from the list" hint shows as soon as an existing selection is edited, while the user is still typing. Not verified in a browser; manual testing reported no problem.
- **Fix**: Optionally reset `touched` in `onInput` so the hint only appears after the next blur.
- **Decision**: SKIPPED (left as an observation; manual testing reported no issue)
