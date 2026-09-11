<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Remove User Loading Flash

- **Plan**: context/changes/remove-user-loading-flash/plan.md
- **Mode**: Deep
- **Date**: 2026-09-11
- **Verdict**: REVISE (fixed during triage — see below)
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

Grounding: 9/9 paths ✓ (all 9 files the plan modifies exist), 4/4 symbols ✓ (`fetchUsers()`, `reload()`, absence of any pre-existing `loading` signal, `MatProgressSpinnerModule` export from `@angular/material/progress-spinner`), brief↔plan ✓.

Additional verification performed (deep mode, done via direct codebase inspection rather than a sub-agent):
- Confirmed `add-instrument.ts` does not share the loading-flash bug (uses a static type list, only calls `InstrumentsService.reload()` fire-and-forget after writes) — the plan's 3-component scope is complete and correctly excludes it.
- Confirmed `mat-progress-spinner`'s indeterminate animation is pure CSS (no `@angular/animations` import in the compiled bundle) — no `provideAnimations()` setup needed, and none exists in `app.config.ts` today.
- Confirmed all three affected `.spec.ts` files mock the relevant service calls with synchronous `of()`/`throwError()` (never `delay()` or a driven `Subject` for the *load* path) — the plan's claim that no spec changes are needed is well-grounded.
- Confirmed `angular.json`: `build` target's `defaultConfiguration` is `"production"`, and that configuration sets `localize: ["pl"]` + `i18nMissingTranslation: "error"` — this is what produced finding F1.

## Findings

### F1 — Missing PL translation entries will block `npm run build`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details (Accessibility) + Phase 1 item 2, Phase 2 items 2 and 5
- **Detail**: The plan adds 3 new `i18n`-tagged `aria-label` strings (one spinner per component). `angular.json`'s `build` target defaults to the `production` configuration, which sets `localize: ["pl"]` and `i18nMissingTranslation: "error"` — so `npm run build` (listed as Automated Verification in both phases) hard-fails on any `i18n` id without a matching `<trans-unit>` in `src/locale/messages.pl.xlf`. As originally written, the plan didn't mention this step, so Phase 1's own Automated Verification would fail immediately after adding the first `aria-label`. Also noted: `src/locale/messages.xlf` (the `ng extract-i18n` source output) is already out of sync with `messages.pl.xlf` (264 vs. 374 trans-units), confirming this repo's established practice is to hand-add entries directly to `messages.pl.xlf` rather than relying on `extract-i18n`.
- **Fix**: Add a "i18n translation entries (build-blocking)" note to Critical Implementation Details, and a one-line cross-reference in each phase's template-gating Contract, instructing the implementer to manually add a `<trans-unit id="...">` (with Polish `<target>`) to `src/locale/messages.pl.xlf` for each new `aria-label` id, before relying on `npm run build` to pass.
- **Decision**: FIXED (applied directly to plan.md — see Critical Implementation Details and Phase 1/2 Contract updates)

## Triage Summary

- Fixed: F1 (1)
- Skipped: none
- Accepted: none
- Dismissed: none

**Verdict after fixes: SOUND** — the plan's approach, scope, and phasing are correct; the one completeness gap found (missing i18n translation step) has been folded into the plan text.
