# Login component tests + scoped Stryker mutation pass — Plan Brief

> Full plan: `context/changes/login-component-coverage/plan.md`

## What & Why

`src/app/features/auth/login/login.ts` has **no spec file at all** — the last
auth/form component with zero coverage. Issue #116 is the per-component
follow-up to the frontend mutation-testing work (#110, #112, #113), matching
#114 (alert-form) and #115 (register). Create `login.spec.ts` from scratch
(behavioral coverage of the validator gates, happy path, error path, and the
`submitting`-signal double-submit guard), run a line-range-scoped Stryker pass
over `onSubmit`, and record the follow-up in `test-plan.md`. Test-only — no
production code changes.

## Starting Point

`login.ts` carries the same `submitting`-signal guard as every other form
(`if (this.form.invalid || this.submitting()) return; … submitting.set(true)`),
but its error handler is **simpler than register's**: unconditional
`submitting.set(false)` + `errorMessage.set('Invalid email or password.')` for
any error — no `instanceof` / status branch, no `setErrors` on a control. No
`login.spec.ts` exists; `register.spec.ts`'s `renderRegister` helper transfers
1:1 (same DI: `AuthService` stub, `Router` stub, `ActivatedRoute: {}`).

## Desired End State

`login.spec.ts` exists with ~8 behavioral `it` blocks. Re-running scoped Stryker
on `login.ts:26-43` reports zero surviving mutants on the signal init, the
guard, the `submitting` flag, the success-navigation, and the error message —
with `errorMessage.set(null)` (`:32`) the one documented, accepted survivor
(→ #110). The `login.html:31` `[disabled]` binding is covered by a
deliberate-break check. `npm run test:ci` green; diff touches only
`login.spec.ts` (new) + `test-plan.md`. Issue #116 has a before/after comment;
PR open, unmerged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Phasing | 3 phases (parity with #115) | Baseline+guard / happy-path+error-message / verify+docs — smaller commits, symmetry with #114/#115. | Plan |
| `errorMessage.set(null)` mutant (`:32`) | Defer to #110, document as accepted survivor | Only observable on a 2nd submit after a 1st error — a reset facet, not a `submitting`-guard facet; #115 made the identical call for `emailError.set(null)`. | Plan |
| Stryker baseline | Real scoped baseline in Phase 1 (on zero tests) | Hard before-number for the before/after comment; early confirmation the `:26-43` line range compiles. | Plan |
| Stryker scope | Line-range `login.ts:26-43` (not whole file) | Instrumenting the `fb.nonNullable.group` initializer widens `this.form`'s type and breaks `strictTemplates` on `login.html` — same blocker as #114/#115. | Plan |
| Happy-path navigation assertion | In scope — assert `navigateByUrl('/')` and `login(email, password)` args | The #116 checklist explicitly wants navigation covered; #115 left the navigation mutants to #110 but this issue does not. | Plan |
| `test-plan.md` update | §3 Phase 3 bullet + §8 ledger entry | Matches how #114/#115 recorded their follow-ups (substance in §3, not just the §8 ledger the issue's literal wording names). | Plan |

## Scope

**In scope:**
- New `src/app/features/auth/login/login.spec.ts` (hand-authored, mirrors `register.spec.ts`)
- Validator gates (email required / email format / password required)
- `form.invalid` no-op, in-flight disabled, double-submit ignored, re-enable-on-error
- Happy path: `login` called with entered credentials + `navigateByUrl('/')`
- Error path: `'Invalid email or password.'` rendered
- Scoped Stryker pass on `login.ts:26-43` + survivor triage
- `login.html:31` `[disabled]` deliberate-break check
- `test-plan.md` §3 Phase 3 + §8 updates; before/after comment on #116; PR (unmerged)

**Out of scope:**
- Any production code change (`login.ts` / `.html` / `.scss`)
- The `:32` `errorMessage.set(null)` mutant (documented survivor → #110)
- Validator coverage beyond the three basic gates
- E2E test (auth flow already covered by Phase 6 Playwright + `e2e/seed.spec.ts`)
- Full-repo or worker Stryker profile

## Architecture / Approach

`renderLogin(loginImpl?)` helper wraps the `login` impl in `vi.fn`, adds a
`vi.fn` `navigateByUrl` spy, widens the component cast to
`{ form, onSubmit, submitting }`. Each `it` block maps one-to-one to a mutant
row: the in-flight test uses a caller-controlled `Subject<AuthUser>` so a test
can observe `submitting() === true` (a synchronous stub flips it back in one
tick). Verification = scoped Stryker baseline (Phase 1) vs "after" (Phase 3) +
the template deliberate-break.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baseline + spec bootstrap + guard class | Stryker baseline recorded; `login.spec.ts` created with helper + validator gates + `form.invalid`/in-flight/double-submit/re-enable tests | Whole-file Stryker scope fails `strictTemplates` (expected — fall back to `:26-43` line range) |
| 2. Happy path + error message | `login`-args + `navigateByUrl('/')` assertion; `'Invalid email or password.'` render assertion; before/after comment | Zoneless change-detection nudge (`fixture.detectChanges()`) after `Subject` emit |
| 3. Verification & close-out | Scoped Stryker "after" confirms survivors gone; `test-plan.md` §3+§8; #116 comment; PR (unmerged) | An unexpected survivor needs an equivalence argument or an extra assertion |

**Prerequisites:** `main` at `0116f30` (after #126 archived #115); `npm run test:ci` + `npm run test:worker` locally (not `npm run ci` — it hangs).
**Estimated effort:** ~1-2 sessions across 3 phases; the two Stryker runs (~5-15 min each) dominate wall time.

## Open Risks & Assumptions

- **Assumption**: the whole-file Stryker scope fails `strictTemplates` exactly as it did for #114/#115 — Phase 1 confirms; if it unexpectedly compiles, use the wider scope and note it.
- **Assumption**: `Validators.email` accepts `'user@example.com'` and rejects `'not-an-email'` in jsdom (holds for `register.spec.ts`).
- The `:32` survivor is accepted by design; if triage surfaces other survivors they get an equivalence argument or a targeted assertion (never a production change).

## Success Criteria (Summary)

- A user submitting login with bad input / bad credentials sees the right message and can't double-submit — now proven by tests.
- Scoped Stryker on `login.ts:26-43`: zero survivors except the documented `:32`.
- `npm run test:ci` green; diff limited to `login.spec.ts` (new) + `test-plan.md`.
