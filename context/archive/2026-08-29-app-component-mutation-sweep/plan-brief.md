# Scoped Stryker mutation sweep for alert-form + register + login — Plan Brief

> Full plan: `context/changes/app-component-mutation-sweep/plan.md`

## What & Why

Issue #110 asks for a **broad** (whole-component, not just `onSubmit`) Stryker
mutation pass over the three Angular form components — `alert-form.ts`,
`register.ts`, `login.ts` — and triage of every survivor that isn't in the
already-closed `submitting`/guard class. The narrow submit-guard half was split
per component into #113/#114/#115/#116 (all shipped); this change is the
remaining broad triage plus the mutants those issues explicitly deferred here.

## Starting Point

All three components have specs (post #114/#115/#116) with the submit-guard and
error-map classes at 100% mutation coverage. But **no test emits a successful
`create`/`update`/`register`/`login`**, so `dialogRef.close(true)`,
`router.navigateByUrl('/')`, and the submitted-payload shape are unverified; and
the top-of-`onSubmit` error-reset (`formError`/`emailError`/`errorMessage.set(null)`)
was deferred to #110 by every prior issue. `alert-form.ts`'s display helpers and
`valueChanges` cascades are also only partially pinned.

## Desired End State

Each file's broad multi-range `--mutate` scope reports zero surviving mutants
except documented equivalents. New tests cover the success path (navigation /
dialog-close + payload shape), the error-reset facet, and — alert-form only —
the three display helpers and the cascade operator branches. Test-only; no
production file changes; `test-plan.md` §3/§4/§8 updated; issue commented; PR
open and unmerged.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Include `login.ts`? | Yes | #116 explicitly deferred `login.ts:32` here; one test + a verify run closes the series | Plan |
| Stryker scope mechanism | Multi-range `--mutate` skipping the `fb.nonNullable.group` initializer | Established across #114/#115/#116; zero new infra; whole-file scope breaks `strictTemplates` | Plan |
| Success-path tests | One per component | The broad triage exists precisely to close these survivors | Plan |
| alert-form display helpers | Cover all three (`instrumentTypeLabel`, `selectedInstrumentCurrency`, `onThresholdBlur`) | No equivalence arguments to defend; they render user-visible text | Plan |
| Cascade mutants | Strengthen the existing cascade tests with operator assertions (modify, don't only add) | Some mutants are cheapest to kill inside an existing test's setup | Plan |
| Phases | 4 — alert-form / register / login / close-out | Parity with #114/#115/#116; small commits; login is ~1 test | Plan |
| test-plan updates | §3 Phase 3 note + §4 Angular row + §8 ledger | Issue names §4+§8; §3 note is the running #11x record | Plan |

## Scope

**In scope:** broad multi-range Stryker baseline + after per file; success-path
`it` per component; error-reset `it` per component; alert-form display-helper +
cascade-operator assertions; `login.ts:32` kill; deliberate-break re-confirm for
the three `[disabled]` bindings; test-plan §3/§4/§8; issue comment; PR.

**Out of scope:** any production `.ts`/`.html` change; re-covering the
submit-guard/`messageFor` class; mutation-covering the group-initializer lines;
admin components (#113 / Phase 5); the worker profile; E2E; row Status bumps;
full-repo / whole-directory Stryker scope; the PR merge.

## Architecture / Approach

One phase per component file, each self-verifying with its own background
Stryker baseline + after run recorded to a scratch note, then a pure close-out
phase. Tests use the caller-controlled render-helper pattern already in all
three specs (`vi.fn` service impl, `{ form, onSubmit, submitting }` cast);
success tests use the default sync impl, reset tests use
`mockImplementationOnce(throwError) → mockImplementation(of(...))`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. alert-form | Confirmed multi-range scope; success + edit + reset + 3 helper + cascade tests | The `:1-60` range may still trip `strictTemplates` — Phase 1 dry-runs and narrows |
| 2. register | Baseline; success (nav + payload) + `emailError` reset tests; `markAsTouched()` triage | `:50` equivalence needs a clean argument, not a brittle CSS assertion |
| 3. login | Baseline; the one `errorMessage.set(null)` reset test; 13/13 | Low — near-identical to #116, tiny file |
| 4. close-out | Deliberate-break re-confirm; §3/§4/§8; #110 comment; PR | Numbers in the comment must match the three scratch notes exactly |

**Prerequisites:** `main` at `8974438` (post #128). `e2e/.env` + Playwright
cache present → `git push` may need `dangerouslyDisableSandbox: true`.
**Estimated effort:** ~3-4 sessions; 6 background Stryker runs (~2h wall time
total, mostly alert-form).

## Open Risks & Assumptions

- Stryker's comma-separated multi-range `--mutate` is unverified in this repo —
  Phase 1 confirms it before the approach is locked for all three files
  (fallback: two sequential runs merged in the note).
- `alert-form.ts:168` `instanceof`→`true` stays a documented equivalent
  (carried from #114).
- `register.ts:50` `markAsTouched()` is assumed equivalent (submit-button click
  → `form.submitted` → `errorState`); confirmed against the Phase 2 baseline.

## Success Criteria (Summary)

- Every non-equivalent mutant in each file's broad swept scope is `Killed`/`Timeout`.
- `git diff --stat main` = three `*.spec.ts` + `test-plan.md` only.
- Issue #110 has a per-file before/after comment; PR open, unmerged.
