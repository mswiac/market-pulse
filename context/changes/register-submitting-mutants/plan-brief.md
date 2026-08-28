# Harden register tests against submitting-flag / double-submit mutants — Plan Brief

> Full plan: `context/changes/register-submitting-mutants/plan.md`

## What & Why

`register.ts` guards its submit with a `submitting` signal
(`if (this.form.invalid || this.submitting()) return;` → `set(true)` →
`set(false)` on error) — the same pattern #113 (admin) and #114 (alert form)
already hardened. `register.spec.ts` stubs `AuthService.register` synchronously,
so `submitting` never visibly holds `true`, nothing asserts the button
re-enables on error, and nothing calls `onSubmit` with an invalid form. A
Stryker run flags the guard, both `submitting.set()` calls, and the inline
`err instanceof HttpErrorResponse && err.status === 409` condition as survivors.
This is the per-component follow-up tracked as issue #115.

## Starting Point

`register.spec.ts` has 3 `it` blocks (two validator tests, one 409-conflict
test). Its helper `renderRegister(registerImpl)` already accepts a caller
`register` impl but does not wrap it in `vi.fn` and exposes only `form` on the
component. No mutation baseline exists for `register`.

## Desired End State

A scoped Stryker run over `register.ts:27-53` reports zero surviving guard /
`submitting` / targeted error-handler mutants (or documented equivalents).
`register.spec.ts` gains ~5 `it` blocks; the 409 test's button lookup moves to
`getByRole`. No production file changes. `test-plan.md` §3 records it; issue
#115 gets a before/after comment; a PR is open, unmerged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Error-handler coverage depth | Mandate + "cheap hits" (generic branch, `instanceof` / `&& ===409` split) | Mirrors the #114 decision; closes the whole inline handler in one pass | Plan |
| Dedicated `form.invalid` no-op test | Yes | Kills the guard's `form.invalid` term, which the in-flight test doesn't reach | Plan |
| Stryker baseline | Real scoped baseline in Phase 1 | Hard numbers for the before/after comment; catches surprises | Plan |
| Existing 409 test's button lookup | Migrate to `getByRole('button', { name: 'Register' })` | CLAUDE.md prefers `getByRole` over DOM-structure selectors | Plan |
| Stryker `--mutate` scope | Line range `register.ts:27-53` | `fb.nonNullable.group` initializer breaks `strictTemplates` under instrumentation (same as #114); Phase 1 confirms | Plan (carried from #114) |

## Scope

**In scope:**
- `register.spec.ts` — finish parameterizing the helper, add in-flight /
  double-submit / re-enable-on-error / `form.invalid`-no-op / error-branch tests,
  migrate the 409 test's button lookup.
- `context/foundation/test-plan.md` §3 Phase 3 note.
- Scoped Stryker baseline + "after" run; before/after comment on #115; PR.

**Out of scope:**
- Any production code change (`register.ts` / `.html` / `.scss`).
- `emailError.set(null)`, `markAsTouched()`, `navigateByUrl('/')` `StringLiteral`
  mutants → #110.
- `login` specs → #116.
- E2E, full-repo / worker Stryker.

## Architecture / Approach

Caller-controlled `Subject` pattern (`add-instrument.spec.ts:19-23,163-183`):
`renderRegister(() => pending)` holds the register call in flight; a
`fixture.detectChanges()` nudge after `pending.next()` / `.error()` flushes the
zoneless signal write to the DOM. Assertions read `submitButton().disabled` and
the `register` spy's call count; error-branch tests assert the rendered
`<mat-error>` text.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baseline + submitting/guard class | Scoped baseline; parameterized helper; in-flight, double-submit, re-enable, `form.invalid` tests; 409-test button migration | Whole-file Stryker scope fails `strictTemplates` — mitigated by the `:27-53` line range (confirmed in this phase) |
| 2. Inline error-handler cheap hits | Generic-branch + `instanceof`-gate tests; before/after comment | Plain-object error shape needs a type cast — minor |
| 3. Verification & close-out | "After" Stryker run; `test-plan.md` note; #115 comment; PR | Residual survivors need equivalence arguments |

**Prerequisites:** branch cut from current `main` (`f7d1f7e`). Use
`npm run test:ci` (not `npm run ci` — it hangs locally).
**Estimated effort:** ~1 session across 3 phases; ~2×(5-15 min) background Stryker runs.

## Open Risks & Assumptions

- Assumes `register.ts` hits the same `strictTemplates` instrumentation failure
  as `alert-form.ts` — Phase 1 verifies; if it unexpectedly compiles whole-file,
  use that scope and note it.
- Assumes `ng test` renders English source strings (confirmed against the
  existing validator + 409 tests).
- Assumes the `register.html:16` `emailError()` `@if` branch renders without a
  `.touched` check (confirmed by reading the template) — so message assertions
  don't depend on `markAsTouched()`.

## Success Criteria (Summary)

- Scoped Stryker over `register.ts:27-53`: no surviving guard / `submitting` /
  targeted `:41` mutants (or documented equivalents).
- `npm run test:ci` green; `git diff --stat main` = only `register.spec.ts` +
  `test-plan.md`.
- Issue #115 has a before/after comment; PR open, unmerged.
