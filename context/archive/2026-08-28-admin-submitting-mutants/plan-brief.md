# Harden admin panel tests against submitting-flag / double-submit mutants — Plan Brief

> Full plan: `context/changes/admin-submitting-mutants/plan.md`

## What & Why

Issue #113. The scoped Stryker pass in #109 / PR #112 deliberately left one
class of survivor across all four admin components: the `submitting` signal's
`BooleanLiteral` mutants and the related `canSubmit` computed / submit-guard
mutants. These guard against **double-submit** — a fast double-click or Enter
firing a second in-flight request (a second DELETE, a duplicate create). We add
the assertions that kill them.

## Starting Point

Every admin spec stubs `AdminService` with synchronous `of(...)`, so
`submitting` flips `false → true → false` in one tick — no test observes the
`true` state, and none asserts the submit control re-enables on the error path.
35 `submitting` / `canSubmit` mutants survive across `admin-panel`,
`add-instrument`, `remove-instrument`, `remove-user`. The caller-controlled
`Subject` pattern needed to fix this already exists in the repo
(`remove-user.spec.ts:18`, the `dialogSubject`).

## Desired End State

A re-run of the scoped Angular Stryker profile reports zero surviving
`submitting` / `canSubmit` mutants in the four components (or a written
equivalence argument for any residual). `npm run test:ci` stays green. No
production code changed. Issue #113 has a before/after comment; a PR is open,
unmerged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| `canSubmit` mutant scope | Whole submit-guard unit: all `canSubmit` operator/conditional mutants + the `if` guard + `submitting.set()` | They're one logical unit in a single `computed`; the next Stryker run would surface the field-validation ones anyway | Plan |
| `add-instrument` L113 (success-handler `set(false)`, masked by `resetForm()`) | Add a re-fill-after-success assertion | Verifies a real behavior — admin can add a second instrument in a row | Plan |
| Assertion placement | Dedicated new `it` blocks; existing tests untouched | Clear intent, one-to-one test→mutant mapping | Plan |
| Double-submit assertion style | Button `disabled` in flight **and** service mock called exactly once after a second `onSubmit()` | The call-count assertion is the only thing that kills `if (!canSubmit()) return` → `if (false)` | Plan |
| `mat-select [disabled]="submitting()"` in dialog components | Assert it too, alongside the button | Second independent observation point for `submitting()` | Plan |
| Phasing | Simple forms → dialog forms → verification | Dialog components have a 3-stage in-flight window worth isolating | Plan |
| Stryker verification scope | One full admin-glob run at the end (~19 min, background) | Matches issue #113's checklist command; clean before/after | Plan |

## Scope

**In scope:**
- `admin-panel.spec.ts`, `add-instrument.spec.ts`, `remove-instrument.spec.ts`, `remove-user.spec.ts` — new `it` blocks + minor `component` cast additions
- `test-plan.md` §3 Phase 5 note
- One scoped Stryker run, a #113 comment, a PR

**Out of scope:**
- Any production code change (residual mutants are documented as equivalent, not fixed)
- The other ~98 survivors in these files (error maps, snackbar config, suffix logic, sort order)
- `alert-form` / `register` / `login` (#114 / #115 / #116)
- E2E tests, `*-confirm` dialog components, worker/full-repo Stryker profiles

## Architecture / Approach

Per component: thread a `Subject` (or a never-emitting observable) through the
render helper for the relevant `AdminService` call. Add two dedicated `it`
blocks — (1) in-flight: submit, don't emit, assert submit control disabled,
call `onSubmit()` again, assert one service call; (2) re-enable-on-error: emit
an error, assert the control is enabled. Plus component-specific extras
(admin-panel post-success re-enable; add-instrument re-fill; dialog components'
three in-flight windows + `mat-select` + post-success re-enable). Zoneless
`Subject.next()` from the test needs a `fixture.detectChanges()` nudge — the
established pattern in these specs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Simple-form components | `admin-panel` + `add-instrument` specs cover in-flight / error / double-submit / `canSubmit` operators | `add-instrument` L113 needs the re-fill step to be observable |
| 2. Dialog-flow components | `remove-instrument` + `remove-user` specs cover all three in-flight windows + `mat-select` | Locating the `mat-select` disabled state with an a11y-first locator, not CSS |
| 3. Verification & close-out | Stryker confirms mutants dead; `test-plan.md` note; #113 comment; PR | A residual mutant that needs an equivalence argument instead of a kill |

**Prerequisites:** Fresh `main` (PR #112 merged). Branch `test/113-admin-submitting-mutants`.
**Estimated effort:** ~1 session across 3 phases; Phase 3's Stryker run is ~19 min background.

## Open Risks & Assumptions

- Assumption: every `submitting` / `canSubmit` mutant in the baseline table is killable by an in-flight or re-enable assertion. Some `if`-guard re-association mutants may prove equivalent — the plan allows documenting rather than forcing a kill.
- Assumption: the `mat-select` exposes a queryable disabled state to `@testing-library` without a CSS selector. If not, fall back to asserting only the button (still kills the `BooleanLiteral` mutants).
- The `canSubmit` `ConditionalExpression → true` mutants survived the *existing* disabled-state tests for reasons not fully explained (possibly render-timing); the new tests assert after an explicit `detectChanges` and a second `onSubmit()` call, which should close that gap regardless of the cause.

## Success Criteria (Summary)

- Re-run Stryker on the admin glob → zero surviving `submitting` / `canSubmit` mutants in the four components (or documented-equivalent).
- `npm run test:ci` green; `git diff --stat main` shows only `*.spec.ts` + `test-plan.md`.
- Issue #113 has a before/after comment; PR open and unmerged.
