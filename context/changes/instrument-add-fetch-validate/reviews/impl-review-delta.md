<!-- IMPL-REVIEW-REPORT -->
# Implementation Review (delta): Fetch and Validate Market Data When an Instrument Is Added

- **Plan**: context/changes/instrument-add-fetch-validate/plan.md
- **Scope**: delta `501528d..26037ad` (changes made after the first review) plus the e2e specs it touches
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations (all handled below)

Plan adherence, docs consistency and the new unit tests were checked and match. Stale "skip flag" sentences in `plan.md` (three places) and `plan-brief.md` (one) were found and fixed.

## Findings

### F1 — Cancel test only saw DELETEs for the picked ticker

- **Severity**: ⚠️ WARNING
- **Dimension**: Safety & Quality
- **Location**: e2e/admin/remove-instrument.spec.ts
- **Detail**: The DELETE was recorded only inside the route for the picked ticker, so a delete aimed at another instrument would fall through to the real Worker unseen. Weaker than the previous page-level listener.
- **Decision**: FIXED — every DELETE under /api/admin/instruments/ is recorded; the confirm test asserts exactly one DELETE for the picked ticker; the cancel test asserts none.

### F2 — Mock payloads are not typed against the real contracts

- **Severity**: ⚠️ WARNING
- **Dimension**: Pattern Consistency
- **Location**: e2e/admin/add-instrument.spec.ts, e2e/admin/remove-instrument.spec.ts
- **Detail**: Mock shapes match the real code today, but nothing links them. `e2e/` is not part of any tsconfig and `npm run typecheck` does not cover it, so `satisfies` would not catch drift.
- **Decision**: SKIPPED — no tool would enforce it; the real routes are covered by worker tests and the plan lists mock drift as a known risk.

### F3 — Last assertion of the cancel test was nearly tautological

- **Severity**: OBSERVATION
- **Dimension**: Success Criteria
- **Location**: e2e/admin/remove-instrument.spec.ts
- **Detail**: It checked the test's own stub array.
- **Decision**: FIXED — replaced by a UI check that the picker still offers the ticker.

### F4 — Prettier width in the remove spec

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: e2e/admin/remove-instrument.spec.ts
- **Decision**: FIXED — formatted with prettier (other files under test/ and e2e/ already fail the check; prettier is not enforced, left alone).

### F5 — messages.xlf regeneration dominates the diff

- **Severity**: OBSERVATION
- **Dimension**: Scope Discipline
- **Location**: src/locale/messages.xlf
- **Detail**: Pure extract-i18n output (+913/-194), disclosed in the commit message. Ids match messages.pl.xlf except the pre-existing dead `dashboard.column.rsi` entry in the Polish file.
- **Decision**: SKIPPED — already committed as part of the review fixes.

### F6 — Pre-existing dead entry in messages.pl.xlf

- **Severity**: OBSERVATION
- **Dimension**: Scope Discipline
- **Location**: src/locale/messages.pl.xlf (`dashboard.column.rsi`)
- **Detail**: Present before this change (added by an earlier dashboard commit), no longer used in templates.
- **Decision**: SKIPPED — unrelated to this change.

## Not verified

- Persistence and cascade of the remove flow are covered by test/worker/admin.test.ts, not by e2e (by design, see the spec header).
- A single `cron-run.spec.ts` failure was seen once in a full e2e run; it passed 41/41 twice afterwards, also without this branch's changes. Cause not identified.
