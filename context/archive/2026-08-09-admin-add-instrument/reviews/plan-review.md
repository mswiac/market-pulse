<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin can add a new instrument to the registry

- **Plan**: context/changes/admin-add-instrument/plan.md
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE (pre-triage) → SOUND (post-triage, all findings resolved)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 6/6 paths ✓, 5/5 symbols ✓, brief↔plan ✓ — verified via a dedicated sub-agent sweep (migration/trigger safety, UNIQUE-error convention, i18n config scope, blast radius on error-shape consumers and `INSTRUMENT_TYPE_LABELS` duplicates, and constants-file precedent).

## Findings

### F1 — i18n "build fails" claim is wrong for dev-serve

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details (plan.md:43)
- **Detail**: Plan claimed both `ng build` and `ng serve --configuration development-pl` fail outright on a missing `messages.pl.xlf` id. Verified against `angular.json`: `i18nMissingTranslation: "error"` is set only under the `production` config (used by `ng build`/`npm run ci`); `development-pl` (used by `npm start`) has no such setting and only warns.
- **Fix**: Corrected the claim to distinguish build/ci (hard fail) from dev-serve (warning only); added a note not to rely on the dev server to catch a missing translation.
- **Decision**: FIXED

### F2 — No explicit test for `rsiEligible: false`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Tests contract (plan.md:96)
- **Detail**: The RSI-eligible checkbox exists specifically to handle an `index`-type instrument added with RSI off (mirroring `^VIX`). The Phase 2 test contract didn't explicitly require exercising `rsiEligible: false`, only the default-`true` success path.
- **Fix**: Added an explicit requirement to Phase 2's test contract to cover both `true` and `false`.
- **Decision**: FIXED

### F3 — Currency format constraint isn't mirrored client-side

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5, items 3/4 (plan.md:222, 230)
- **Detail**: Backend validates currency against `^[A-Z]{3}$`, but `canSubmitInstrument` only checked non-empty — an admin could submit a malformed currency and only discover it via a server round-trip.
- **Fix A ⭐ Recommended (applied)**: Added an Angular pattern validator + blur-time uppercase transform, mirroring the existing reformat-on-blur pattern for threshold in `alert-form.ts:142-149`.
  - Strength: Instant feedback; follows an existing in-repo UX pattern.
  - Tradeoff: A few more lines in the component/template.
  - Confidence: HIGH — pattern already exists in this exact form family.
  - Blind spot: Still only checks shape (3 uppercase letters), not a real ISO 4217 code.
- **Fix B**: Leave currency as plain non-empty text, rely entirely on the server's `instrument_currency_invalid` code.
- **Decision**: FIXED (Fix A)

### F4 — Duplicate-ticker 409 relies on an unverified-in-repo SQLite behavior

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2, item 1 (plan.md:86)
- **Detail**: Plan assumes a `TEXT PRIMARY KEY` violation raises an error containing "UNIQUE" (standard SQLite behavior, but this repo's existing `.includes('UNIQUE')` catches only guard declared `UNIQUE(...)` columns, not a PK). Self-correcting: Phase 2's own duplicate-ticker test exercises this exact path.
- **Fix**: None — accepted as-is; self-verifying via Phase 2's own test suite.
- **Decision**: ACCEPTED

### F5 — New file pattern, not an established one

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Phase 4, item 1 (plan.md:158)
- **Detail**: `src/app/features/instruments/instrument-types.ts` would be the first `*-types.ts`/constants-only file under `src/app/features/` — confirmed no such convention exists today. The plan's original wording implied precedent.
- **Fix**: Added a note in Phase 4 item 1's Intent that this is a new, small constants-module pattern for this codebase, not a continuation of an existing one.
- **Decision**: FIXED
