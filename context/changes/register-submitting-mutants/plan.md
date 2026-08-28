# Harden register tests against submitting-flag / double-submit mutants — Implementation Plan

## Overview

Add assertions to `register.spec.ts` that observe the in-flight state
(`submitting() === true`) and the return-to-idle state after a failed request,
kill the whole `onSubmit` guard as a unit (`form.invalid || submitting()`), and
— while the test seam is open — cover the inline error handler
(`err instanceof HttpErrorResponse && err.status === 409` vs the generic branch).

Today every submit-path assertion in `register.spec.ts` stubs
`AuthService.register` with a synchronous observable, so `submitting` flips
`false → true → false` inside one tick and no test ever sees `true`; no test
asserts the submit button re-enables on the error path; nothing calls `onSubmit`
with an invalid form to prove the `form.invalid` guard term.

This is a **test-only change — no production code is touched**. It is the
per-component follow-up to the frontend mutation-testing work (#110, #112,
#113), tracked as issue #115. It is the identical treatment #113
(`context/archive/2026-08-28-admin-submitting-mutants/`) gave the admin
components and #114
(`context/archive/2026-08-28-alert-form-submitting-mutants/`) gave the alert
form. `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3.

## Current State Analysis

- **`register.ts` uses the same `submitting`-signal pattern as the admin
  components and the alert form:**

  | Location | Code | Mutants at risk |
  | --- | --- | --- |
  | `register.ts:31` | `if (this.form.invalid \|\| this.submitting()) return;` | `ConditionalExpression` (`→ if(true)`, `→ if(false)`), `LogicalOperator` (`\|\|` → `&&`) |
  | `register.ts:34` | `this.submitting.set(true);` | `BooleanLiteral` (`true → false`) |
  | `register.ts:40` | `this.submitting.set(false);` (error handler) | `BooleanLiteral` (`false → true`) |
  | `register.ts:41` | `err instanceof HttpErrorResponse && err.status === 409` | `LogicalOperator` (`&&` → `\|\|`), `EqualityOperator` (`===` → `!==`), `ConditionalExpression` (`→ true`, `→ false`) |
  | `register.ts:42,44` | `$localize` taken-email / generic strings | `StringLiteral` |
  | `register.html:31` | `[disabled]="form.invalid \|\| submitting()"` | `LogicalOperator` (`\|\|` → `&&`) — Stryker mutates the template expression too, but the Angular `command` runner does not; covered by a deliberate-break check |

- **`register.spec.ts` today**: helper `renderRegister(registerImpl)`
  (`register.spec.ts:10`) already accepts a caller-supplied `register` impl
  (default `() => of(FIXTURE_USER)`) but does **not** wrap it in `vi.fn` and the
  component cast (`:20`) exposes only `form`. 3 `it` blocks: two validator
  tests, one 409-conflict test that clicks submit via
  `container.querySelector('button[type="submit"]')`.

- **The caller-controlled `Subject` pattern already exists in the repo**
  post-#113/#114: `add-instrument.spec.ts:19-23,163-183` — `renderAddInstrument(impl)`
  wraps `impl` in `vi.fn`, and the in-flight tests pass
  `() => new Subject<CreatedInstrument>()`. `AuthService.register` returns
  `Observable<AuthUser>` — same shape.

- **Making the form valid in a test is trivial** — no cascades, no async load:
  `form.controls.email.setValue('a@b.com')` +
  `form.controls.password.setValue('longenoughpassword')` +
  `fixture.detectChanges()`. Both controls start `''` (invalid).

- **Submit button** binds `[disabled]="form.invalid || submitting()"`
  (`register.html:31`), rendered with the accessible name `Register`
  (`@@register.submit`). Plain `<button type="submit">` — DOM `.disabled` is the
  natural observation point.

- **`ng test` renders English source strings**, not `messages.pl.xlf` — the
  existing validator tests assert `'Email is required.'` and the 409 test
  asserts `'This email is already registered.'`. Same for the alert-form and
  add-instrument specs. So assert the English copy from `register.ts` /
  `register.html` directly.

- **The error handler's `markAsTouched()` (`:50`) and `setErrors({ server: true })`
  (`:49`) are only there to flip `mat-form-field`'s `errorState`** so the
  `<mat-error>` shows. But `register.html:16` renders the `emailError()` branch
  of the `@if` chain **without** a `.touched` check, so an assertion on the
  rendered message text does not depend on those two lines. The existing 409
  test's `form.controls.email.hasError('server')` assertion already covers the
  `setErrors` object. `markAsTouched()` and `emailError.set(null)` (`:33`) are
  left to #110.

- **No `register` mutation baseline exists.** `reports/mutation/mutation.json`
  is a prior admin / alert-form run. Issue #115 enumerates the expected
  survivors; Phase 1 captures a real scoped baseline first so the before/after
  comment has hard numbers.

- **Stryker Angular profile** (`context/foundation/stryker-notes.md`):
  `stryker.config.app.json` is a **positional** arg (no `--configFile`), uses
  the `command` runner (`npm run test:ci` per mutant, `coverageAnalysis: off`)
  → run in the background with `dangerouslyDisableSandbox: true`.

- **ADAPTATION (carried from #114) — Stryker likely cannot mutate the whole
  `register.ts`.** `register.ts` is a `FormBuilder` component
  (`form = this.fb.nonNullable.group({...})`, `:22-25`) exactly like
  `alert-form.ts`. Instrumenting the file wraps that initializer in
  mutant-switch ternaries, which widens `this.form`'s inferred type so
  `form.controls.email` / `.password` become possibly-`undefined`; Angular
  `strictTemplates` then fails to compile `register.html` and the dry run
  aborts before any mutant runs. **Fix: scope `--mutate` to the line range
  `src/app/features/auth/register/register.ts:27-53`** (both `signal()`
  initializers + `onSubmit`), which leaves the `form` group initializer
  (`:22-25`) un-instrumented. Phase 1 confirms the whole-file scope fails with
  the `strictTemplates` error, then falls back to the line range and records
  the mutant count. If the whole-file scope unexpectedly *does* compile, use it
  and note that in the comment.

- **Branch/PR state**: cut the change branch from current `main` (`f7d1f7e`,
  after #124 archived). `npm run ci` hangs locally (chains `ng test` watch) —
  use `npm run test:ci` + `npm run test:worker` (memory:
  `project_npm_ci_hangs_locally`). Phase 3 opens a PR; **do not merge**
  (lessons.md / memory: ask per-PR).

## Desired End State

Re-running
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/register/register.ts:27-53"`
reports **zero surviving mutants on `register.ts:31,34,40`** (guard +
`submitting` flag) and **zero surviving `err instanceof … && … === 409`
mutants (`:41`) plus the two string literals (`:42,44`)** — or, for any that
remain, a written equivalence argument in the issue comment (matching the
#91 / #109 / #113 / #114 "don't chase 100%" discipline). The
`register.html:31` `[disabled]` binding is covered by a deliberate-break check
(not Stryker). `npm run test:ci` stays green. `git diff --stat main` shows only
`register.spec.ts` + `test-plan.md` changed. `test-plan.md` §3 records the
follow-up. Issue #115 has a before/after comment; a PR is open, unmerged.

### Key Discoveries:

- `renderRegister` already takes a `registerImpl` arg — it just needs `vi.fn`
  wrapping, the spy returned, and the cast widened to `{ form, onSubmit, submitting }`.
- Form is two `setValue` calls from valid — no cascade, no `ensureLoaded`, no
  dialog DI. Simpler seam than #114.
- The `if (...) return` guard's `→ if(false)` mutant is only killed by a
  **call-count** assertion: a second `onSubmit()` mid-flight must not produce a
  second `register` call.
- The `register.html:31` `[disabled]` binding is a *separate* mutation target
  from the `register.ts:31` guard — the in-flight `button.disabled === true`
  assertion covers the template `||` (deliberate break; the `command` runner
  does not mutate `.html`); the call-count assertion covers the `.ts` guard
  operator (covered by Stryker).
- `register.ts:41`'s compound condition needs three error shapes to pin down:
  `HttpErrorResponse(409)` (real taken path), `HttpErrorResponse(500)` (generic
  — kills `===`→`!==` and `&&`→`||`), and a **plain** `{ status: 409 }`
  (kills `instanceof`→`true`, since real code must still show generic).
- `register.ts` must be line-range-scoped to `:27-53` for Stryker — see the
  ADAPTATION note.

## What We're NOT Doing

- **No production code changes.** If a mutant genuinely cannot be killed
  without changing `submitting` / guard / error-handler logic, it is documented
  as equivalent, not "fixed".
- **Not chasing the other survivors** in `register.ts` — `emailError.set(null)`
  (`:33`), `markAsTouched()` (`:50`), `void this.router.navigateByUrl('/')`
  (`:38`) `StringLiteral` `'/'`. Those belong to the broad `src/app/**` backlog
  (#110).
- **Not touching** `login` specs — that is #116.
- **Not adding** an E2E test — the double-submit guard is unit-observable (the
  browser facet of register is already covered by the Phase 6 Playwright specs
  and the E2E seed flow).
- **Not modifying** `register.ts`, `register.html`, `register.scss`, or any
  other production file.
- **Not re-running** the full-repo or worker Stryker profile.

## Implementation Approach

Finish parameterizing `renderRegister()` the way #113/#114 parameterized the
other render helpers: wrap the `register` impl in `vi.fn`, return the spy,
widen the component cast to `{ form, onSubmit, submitting }`. Then add dedicated
`it` blocks that map one-to-one to the mutant rows in Current State Analysis:

1. **in-flight + double-submit**: make the form valid, click submit, do **not**
   emit, assert the submit button is `disabled`; call `onSubmit()` again; assert
   `register` was called exactly once.
2. **re-enable-on-error**: `subject.error(new HttpErrorResponse({ status: 500 }))`,
   assert the submit button is enabled again.
3. **form.invalid no-op**: `component.onSubmit()` on the pristine (empty) form,
   assert `register` was not called.
4. **generic error branch**: `throwError(() => new HttpErrorResponse({ status: 500 }))`,
   assert the rendered `<mat-error>` shows the generic copy.
5. **instanceof gate**: `throwError(() => ({ status: 409 }))` (plain object),
   assert the rendered `<mat-error>` shows the **generic** copy (real code
   requires a real `HttpErrorResponse` for the taken-email message).
6. Migrate the existing 409 test's button lookup to
   `screen.getByRole('button', { name: 'Register' })`.

Existing validator tests are left untouched. Verification is a scoped Stryker
run (baseline at Phase 1 start, "after" at Phase 3).

## Phase 1: Baseline + the `submitting` / guard class

### Overview

Confirm the Stryker scope, capture the real mutation baseline for `register`,
then cover the in-flight, double-submit, error-path-re-enable, and
`form.invalid`-no-op facets; migrate the existing 409 test's button lookup.

### Changes Required:

#### 1. Scoped Stryker baseline (no file change)

**File**: (command execution)

**Intent**: Confirm the whole-file scope fails under `strictTemplates`, then
record the pre-change survivor list for the before/after comment.

**Contract**: First a quick dry run with the whole-file glob
(`--mutate "src/app/features/auth/register/register.ts" --dryRunOnly` or an
interrupted run) to confirm/deny the `strictTemplates` compile failure. Then
the real baseline, in the background (Bash, `dangerouslyDisableSandbox: true`):
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/register/register.ts:27-53" --reporters progress,clear-text,json`.
When it finishes (~5-15 min), extract from `reports/mutation/mutation.json` the
survived / no-coverage mutants for `register.ts` and note which map to the
`:31` / `:34` / `:40` guard rows and the `:41` / `:42` / `:44` error-handler
rows. Save counts + the whole-file-scope result into a scratch note for
Phase 3. Separately record the `register.html:31` `[disabled]` deliberate-break
result (`||` → `&&` → which tests fail).

#### 2. Finish parameterizing the render helper

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Let a test read `onSubmit` / `submitting` off the component and
assert on the `register` call. Follow `add-instrument.spec.ts:19-39` exactly.

**Contract**:
- `renderRegister(registerImpl?)` keeps its current signature (default
  `() => of(FIXTURE_USER)`); wrap it: `const register = vi.fn(registerImpl)`,
  provide `{ provide: AuthService, useValue: { register } }`.
- Widen the component cast to
  `{ form: Register['form']; onSubmit: () => void; submitting: () => boolean }`.
- Return `{ ...result, form, component, register }`.
- Existing call sites (`renderRegister()`, `renderRegister(registerImpl)`) keep
  working.
- Add a module-level `submitButton` helper or inline
  `screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement` in the
  new tests.

#### 3. In-flight + double-submit `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill `register.ts:34` (`true → false`), the `:31` guard
`ConditionalExpression` (`→ if(false)`) and `LogicalOperator` (`||` → `&&`)
mutants, and the `register.html:31` binding `LogicalOperator` mutant.

**Contract**: New `it` — *keeps the submit button disabled and ignores a second
submit while registration is in flight*: `renderRegister(() => pending)` with
`pending = new Subject<AuthUser>()`; set email + password to valid values;
`fixture.detectChanges()`; `fireEvent.click(submitButton())`;
`fixture.detectChanges()`; `expect(submitButton().disabled).toBe(true)`;
`component.onSubmit()`; `expect(register).toHaveBeenCalledTimes(1)`.

#### 4. Re-enable-on-error `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill `register.ts:40` (`false → true`).

**Contract**: New `it` — *re-enables the submit button after a failed
registration*: same `pending` setup; after submit,
`pending.error(new HttpErrorResponse({ status: 500 }))`; `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(false)`.

#### 5. `form.invalid`-no-op `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill the `form.invalid` term of the `:31` guard (the mutant that
negates or drops it) and the `register.html:31` binding's left operand.

**Contract**: New `it` — *does not register while the form is invalid*:
`renderRegister()` (default impl); do not touch the controls (both empty →
`form.invalid` is `true`); `expect(form.invalid).toBe(true)`;
`expect(submitButton().disabled).toBe(true)`; `component.onSubmit()`;
`expect(register).not.toHaveBeenCalled()`.

#### 6. Migrate the existing 409 test's button lookup

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: CLAUDE.md prefers `getByRole` over DOM-structure selectors; align
the one `container.querySelector('button[type="submit"]')` in the file.

**Contract**: In *shows the taken-email message and marks the email control on
a 409 conflict*, replace the `container.querySelector(...)` line with
`screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement`. Drop
the now-unused `container` from the destructure if nothing else uses it. No
change to the assertions.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"`

#### Manual Verification:

- New `it` block names read as behavior statements, each mapping to a mutant row in Current State Analysis.
- The two existing validator tests are unchanged; the 409 test changed only its button lookup.
- The baseline Stryker survivor counts (and the whole-file-scope result) are recorded for Phase 3.

**Implementation Note**: After Phase 1's automated verification passes, pause
for the human to confirm the spec additions look right before starting Phase 2.

---

## Phase 2: Inline error-handler — cheap hits

### Overview

Cover the `err instanceof HttpErrorResponse && err.status === 409` compound
condition (`register.ts:41`) and the generic-branch string (`:44`), which are
uncovered today — the existing 409 test only exercises the true path.

### Changes Required:

#### 1. Generic-branch `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill the `:44` `StringLiteral`, the `:41` `EqualityOperator`
(`===` → `!==`), and the `:41` `LogicalOperator` (`&&` → `||`) mutants.

**Contract**: New `it` — *shows the generic message for a non-409 error*:
`renderRegister(() => throwError(() => new HttpErrorResponse({ status: 500 })))`;
valid form; click submit; `fixture.detectChanges()`;
`expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy()`.

#### 2. `instanceof`-gate `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill the `:41` `err instanceof HttpErrorResponse`
`ConditionalExpression` (`→ true`) mutant — real code must fall through to the
generic message when the error is not an `HttpErrorResponse`, even if its
`status` looks like 409.

**Contract**: New `it` — *treats a non-HttpErrorResponse 409-shaped error as
generic*: `renderRegister(() => throwError(() => ({ status: 409 })))` (plain
object, cast as needed for the type); valid form; click submit;
`fixture.detectChanges()`;
`expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy()`.

#### 3. Short before/after comment

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Per the #91 / #109 / #114 precedent — a 1-2 line comment above the
new blocks noting why the synchronous stub was insufficient.

**Contract**: One comment (English, matching repo style — terse, WHY not WHAT),
e.g. above the in-flight block: `// submitting-flag / double-submit / error-handler
mutants (issue #115): the old synchronous register() stub never let a test
observe the in-flight state.` Trim to repo comment density (see #114's F2
review note — no banner comments).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"`

#### Manual Verification:

- Each new `it` asserts a distinct user-visible message, not an internal branch.
- The three error-shape tests (existing 409, new 500, new plain-409) map one-to-one to the `:41` compound-condition mutants.

**Implementation Note**: After Phase 2's automated verification passes, pause
for the human before the Phase 3 Stryker verification run.

---

## Phase 3: Verification & close-out

### Overview

Confirm the mutants are dead, update the test plan, comment on the issue, open
the PR.

### Changes Required:

#### 1. Scoped Stryker "after" run (no file change)

**File**: (command execution)

**Intent**: Prove the `submitting` / guard / error-handler survivors are gone.

**Contract**: Run (background, `dangerouslyDisableSandbox: true`, ~5-15 min):
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/register/register.ts:27-53" --reporters progress,clear-text,html,json`.
Compare `reports/mutation/mutation.json` against the Phase 1 baseline. Every
mutant on `:31` / `:34` / `:40` and the targeted `:41` / `:42` / `:44` mutants
must be `Killed` or `Timeout`. For any survivor, write an equivalence argument.
Separately re-run the `register.html:31` deliberate-break check and confirm it
still fails ≥1 test.

#### 2. Test plan note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the `register` mutation follow-up shipped.

**Contract**: In the §3 **Phase 3** scope-notes bullet (~line 111), append a
sentence: the `submitting` / double-submit mutant class on `register.ts` was
closed as a follow-up in issue #115 (mirroring the #113 / #114 notes), together
with the previously-uncovered inline error-handler branches. Note the line-range
Stryker scope `register.ts:27-53` and the reason (same `fb.nonNullable.group`
/ `strictTemplates` instrumentation issue as `alert-form`). Do not change the
Phase 3 table row status.

#### 3. Before/after comment on #115

**File**: (GitHub comment — no file change)

**Intent**: Close the loop per the #91 / #109 / #113 / #114 precedent.

**Contract**: A short comment: baseline survivor count for `register.ts:27-53`
(guard + `submitting` + error handler), post-change count, the exact command
used, and any documented-equivalent mutants with their argument. Plus one line
on the `register.html:31` `[disabled]` binding: covered by a deliberate-break
check (not Stryker — the Angular `command` runner does not mutate templates),
`||` → `&&` fails the in-flight / `form.invalid` tests. Note the whole-file
Stryker scope was infeasible (the `form` group initializer breaks
`strictTemplates` under instrumentation) — hence the `:27-53` line range.

#### 4. PR

**File**: (GitHub PR)

**Contract**: Branch `test/115-register-submitting-mutants` (cut from current
`main`). Conventional-commit title:
`test: kill submitting-flag / double-submit mutants in register (#115)`. Body
links #115 and summarizes the before/after. **Do not merge** — ask first
(lessons.md / memory).

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` green on the final branch.
- `git diff --stat main` shows only `register.spec.ts` + `test-plan.md` changed — no production `.ts` / `.html`.
- Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / guard / error-handler survivors in `register.ts`.

#### Manual Verification:

- The before/after comment numbers match the Stryker report.
- PR description is accurate; PR is left unmerged pending confirmation.
- `test-plan.md` note reads cleanly in context.

**Implementation Note**: After Phase 3, stop. The PR merge is a separate ask.

---

## Testing Strategy

### Unit Tests:

- In-flight: submit button disabled while the `register` call is pending.
- Double-submit: a second `onSubmit()` during flight produces no second `register` call.
- Error path: submit button re-enabled after the service call errors.
- Guard unit: submit is a no-op (button disabled, `register` not called) when `form.invalid` is true.
- Error map: generic message for a non-409 `HttpErrorResponse`; generic message for a non-`HttpErrorResponse` 409-shaped error; taken-email message for a real `HttpErrorResponse(409)` (existing test).

### Integration Tests:

- None — component-level `@testing-library/angular/zoneless` render is the right seam; the guard is not observable at the HTTP boundary.

### Manual Testing Steps:

1. `npm run test:ci` — all green, new blocks visible in output.
2. Read the diff — no production file changed; the 409 test changed only its button lookup.
3. Inspect `reports/mutation/mutation.html` after the Phase 3 run — filter to `register.ts`, confirm the guard / `submitting` / `:41` rows are green.

## Performance Considerations

The Angular Stryker profile reruns the full Vitest suite per mutant (`command`
runner, no perTest coverage). The `:27-53` line range is small (~20-30
mutants). Run baseline and verification in the background. Adding ~5 `it`
blocks adds a handful of `render()` calls (~ms each) to the normal suite —
negligible.

## Migration Notes

None — test-only.

## References

- Issue #115 — the follow-up this plan implements (full checklist in the issue body)
- Issue #114 / PR #123 — the identical work for the alert form: `context/archive/2026-08-28-alert-form-submitting-mutants/plan.md`
- Issue #113 / PR #117 — the identical work for the admin components: `context/archive/2026-08-28-admin-submitting-mutants/plan.md`
- Pattern to follow: `src/app/features/admin/add-instrument/add-instrument.spec.ts:19-39,163-203`
- `context/foundation/stryker-notes.md` — Angular profile, CLI gotchas, sandbox note
- `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3
- `context/foundation/lessons.md` — branch-before-commit, ask-before-merge, English-only
- Memory: `project_npm_ci_hangs_locally` (use `test:ci` + `test:worker`, not `npm run ci`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline + the submitting / guard class

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 4d006cc
- [x] 1.2 Full unit suite passes: `npm run test:ci` — 4d006cc
- [x] 1.3 Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"` — 4d006cc

#### Manual

- [x] 1.4 New `it` block names read as behavior statements, each mapping to a mutant row — 4d006cc
- [x] 1.5 The two existing validator tests unchanged; the 409 test changed only its button lookup — 4d006cc
- [x] 1.6 Baseline Stryker survivor counts + whole-file-scope result recorded for Phase 3 — 4d006cc

### Phase 2: Inline error-handler — cheap hits

#### Automated

- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Full unit suite passes: `npm run test:ci`
- [x] 2.3 Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"`

#### Manual

- [x] 2.4 Each new `it` asserts a distinct user-visible message, not an internal branch
- [x] 2.5 The three error-shape tests map one-to-one to the `:41` compound-condition mutants

### Phase 3: Verification & close-out

#### Automated

- [ ] 3.1 `npm run test:ci` green on the final branch
- [ ] 3.2 `git diff --stat main` shows only `register.spec.ts` + `test-plan.md` — no production `.ts` / `.html`
- [ ] 3.3 Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / guard / error-handler survivors in `register.ts`

#### Manual

- [ ] 3.4 Before/after comment numbers match the Stryker report
- [ ] 3.5 PR description accurate; PR left unmerged pending confirmation
- [ ] 3.6 `test-plan.md` §3 Phase 3 note reads cleanly in context
