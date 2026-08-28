# Harden alert-form tests against submitting-flag / double-submit mutants — Plan Brief

> Full plan: `context/changes/alert-form-submitting-mutants/plan.md`

## What & Why

`alert-form.ts` guards against double-submit with a `submitting` signal
(`onSubmit` sets it `true`, the error handler sets it back `false`, the guard
and the button's `[disabled]` both read it). `alert-form.spec.ts` stubs the
service call with a synchronous `of(...)`, so no test ever observes the
in-flight `true` state and none asserts the button re-enables on error — a
scoped Stryker run flags the `submitting.set(...)` and guard `||`/`&&` mutants
as survivors. This change adds the assertions that kill them. It is the
per-component follow-up to #113 (which did the identical work for the admin
components) and closes issue #114.

## Starting Point

`alert-form.spec.ts` has 5 `it` blocks, all validator tests — there is **no**
test of the submit path at all. `renderAlertForm()` hard-codes
`{ create: () => of(null), update: () => of(null) }` and exposes only `form`.
The caller-controlled-`Subject` render-helper pattern already exists in the
repo at `add-instrument.spec.ts` (shipped by #113) and ports directly.

## Desired End State

A scoped Stryker run over `alert-form.ts` reports zero surviving `submitting` /
guard mutants (`:147,150,161` + the `alert-form.html:85` binding) and zero
surviving `messageFor` mutants (`:167-181`). No production code changed —
`git diff --stat main` shows only `alert-form.spec.ts` + `test-plan.md`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Guard coverage scope | Whole guard as a unit — incl. the `loadError()` term | Matches #113's "whole `canSubmit` unit" decision; leaves no guard survivor | Plan |
| Service-path coverage | Both `create` and `update` (edit mode) | `submitting` guard proven on both `onSubmit` branches | Plan |
| Baseline | Run a scoped Stryker baseline before writing tests | Hard before/after numbers for the issue comment (no `alert-form` baseline exists) | Plan |
| Adjacent survivors | Also cover the `messageFor` error map (409/404/400/generic) | Zero coverage today; cheap to close while the submit-path seam is open | Plan |
| In-flight observation point | DOM `button.disabled` | Plain `<button>` — simpler than #113's mat-select case | Plan |
| PR | Open, do not merge | lessons.md: confirm every PR merge individually | Plan |

## Scope

**In scope:**
- Parameterize `renderAlertForm()` (service `impl`, `dialogData`, `ensureLoaded` overrides; expose `onSubmit` / `submitting`).
- New `it` blocks: in-flight disabled + double-submit call-count, re-enable-on-error, `loadError()` no-op, edit-mode in-flight, four `messageFor` branches.
- Scoped Stryker baseline + verification runs.
- One-sentence note in `test-plan.md` §3 Phase 3; before/after comment on #114; PR (unmerged).

**Out of scope:**
- Any production-code change (`alert-form.ts` / `.html` / `.scss`).
- Other `alert-form.ts` survivors — `valueChanges` cascades, `showRsiOption`, `onThresholdBlur`, the `isEditMode ? update : create` ternary (→ #110 backlog).
- `register` / `login` specs (#115 / #116).
- E2E, full-repo / worker Stryker profiles.

## Architecture / Approach

Test-only, one file (`alert-form.spec.ts`). Port the #113 pattern: render helper
takes a caller-controlled `Subject` for the service call; each new `it` drives
`onSubmit`, holds the observable open, and asserts on `button.disabled` /
service-call count / rendered `formError()` text. Zoneless: a
`fixture.detectChanges()` nudge after every `subject.next()/error()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baseline + submitting/guard class | Scoped Stryker baseline; in-flight / double-submit / error-re-enable / `loadError` no-op / edit-mode `it` blocks | Making the form valid in-test (only `threshold` is empty on render — must `setValue` it) |
| 2. `messageFor` error map | Four `it` blocks asserting the 409 / 404 / 400+`rsi_not_eligible` / generic messages | Asserting the exact `development-pl` translated string |
| 3. Verification & close-out | "After" Stryker run, `test-plan.md` note, #114 comment, PR | An unexpected survivor needing an equivalence argument |

**Prerequisites:** branch cut from current `main` (has PR #122 merged) — done.
Use `npm run test:ci` + `npm run test:worker`, not `npm run ci` (hangs locally).
**Estimated effort:** ~1 session across 3 phases; ~2×19 min background Stryker runs.

## Open Risks & Assumptions

- Assumes issue #114's enumerated survivors match a real scoped run — Phase 1 baseline confirms.
- The `loadError()` no-op test needs the form otherwise-blocked-only-by-loadError; if the empty cascade makes isolation awkward, the fallback is a plain "button disabled + service not called + error copy present" assertion.
- Exact Polish error strings must be read from `messages.pl.xlf` (or a first test run), not guessed.

## Success Criteria (Summary)

- Scoped Stryker: zero surviving `submitting` / guard / `messageFor` mutants in `alert-form.ts` (or documented-equivalent).
- `npm run test:ci` green; diff touches only `alert-form.spec.ts` + `test-plan.md`.
- Issue #114 has a before/after comment; PR open and unmerged.
