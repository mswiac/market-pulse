# Login component tests + scoped Stryker mutation pass — Implementation Plan

## Overview

`src/app/features/auth/login/login.ts` has **no spec file at all**. Create
`login.spec.ts` from scratch (hand-authored, mirroring `register.spec.ts` — not
`ng generate`, which `skipTests` blocks), covering the validator gates, the
happy path (service called with the entered credentials + navigation home), the
error path (invalid-credentials message shown, submit re-enabled), and the
`submitting`-signal double-submit guard. Then run a line-range-scoped Stryker
pass over `login.ts`'s `onSubmit` + signal initializers, triage survivors per
CLAUDE.md ("real user-visible bugs only, not score"), and record the follow-up
in `test-plan.md`.

This is a **test-only change — no production code is touched**. It is the
per-component follow-up to the frontend mutation-testing work (#110, #112,
#113), tracked as issue #116 — the same treatment #113
(`context/archive/2026-08-28-admin-submitting-mutants/`), #114
(`context/archive/2026-08-28-alert-form-submitting-mutants/`), and #115
(`context/archive/2026-08-28-register-submitting-mutants/`) gave the admin
components, the alert form, and register. `login.ts` was out of scope for #110
because #110 only runs Stryker against files that *already* have a spec.
`context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3.

## Current State Analysis

- **`login.ts` uses the same `submitting`-signal pattern as register / alert-form
  / the admin components — but the error handler is simpler:**

  | Location | Code | Mutants at risk (within `:26-43` scope) |
  | --- | --- | --- |
  | `login.ts:27` | `protected readonly submitting = signal(false);` | `BooleanLiteral` (`false → true`) |
  | `login.ts:30` | `if (this.form.invalid \|\| this.submitting()) return;` | `ConditionalExpression` (`→ if(true)`, `→ if(false)`), `LogicalOperator` (`\|\|` → `&&`) |
  | `login.ts:32` | `this.errorMessage.set(null);` | `CallExpression` (removed) — **left to #110** (see below) |
  | `login.ts:33` | `this.submitting.set(true);` | `BooleanLiteral` (`true → false`) |
  | `login.ts:34` | `const { email, password } = this.form.getRawValue();` | `CallExpression` / block mutants |
  | `login.ts:36` | `this.authService.login(email, password)` | argument mutants |
  | `login.ts:37` | `next: () => void this.router.navigateByUrl('/')` | `ArrowFunction` (`→ () => undefined`), `StringLiteral` (`'/'` → `''`) |
  | `login.ts:38` | `error: () => { … }` | `BlockStatement` (`→ {}`) |
  | `login.ts:39` | `this.submitting.set(false);` (error handler) | `BooleanLiteral` (`false → true`) |
  | `login.ts:40` | `this.errorMessage.set($localize\`…Invalid email or password.\`)` | `StringLiteral`, `CallExpression` |
  | `login.html:31` | `[disabled]="form.invalid \|\| submitting()"` | `LogicalOperator` (`\|\|` → `&&`) — Stryker mutates the template expression, but the Angular `command` runner does not; covered by a deliberate-break check |

- **No compound error branch.** Unlike `register.ts:41`
  (`err instanceof HttpErrorResponse && err.status === 409`), `login.ts`'s error
  handler is unconditional: `submitting.set(false)` +
  `errorMessage.set('Invalid email or password.')` for **any** error. Nothing to
  split — so #115's dedicated "cheap hits" phase shrinks to a single error-path
  assertion here.

- **The error handler does not touch any form control.** `register.ts:49-50`
  unconditionally calls `setErrors({ server: true })` + `markAsTouched()` on the
  email control, which forced #115's re-enable test to first *edit* the email to
  clear the server error. `login.ts` has none of that — after `subject.error(...)`
  the form stays **valid** (the entered values are untouched), so a bare
  `expect(submitButton().disabled).toBe(false)` cleanly isolates
  `submitting.set(false)`.

- **No `login.spec.ts` exists** — `ls src/app/features/auth/login/` is
  `login.html`, `login.scss`, `login.ts`. The file is created in Phase 1. New
  Angular spec files under `src/app/**/*.spec.ts` are picked up automatically by
  the `test` architect target (`@angular/build:unit-test`, `runner: vitest`,
  jsdom) via `tsconfig.spec.json`'s `src/**/*.spec.ts` include — no config
  change (§6.5). Do **not** let it match `vitest.config.mts` (`test:worker`) —
  that scope is `test/worker/**` only (§6.6).

- **`register.spec.ts`'s `renderRegister` helper transfers 1:1.** Same injected
  set: `FormBuilder` (real), `AuthService` (stub), `Router` (stub),
  `ActivatedRoute` (needed only because the `RouterLink` "Register" footer link
  injects it — `login.html:38`). `AuthService.login` returns
  `Observable<AuthUser>` — same shape as `register`.

- **The caller-controlled `Subject` pattern already exists in the repo** post
  #113/#114/#115: `add-instrument.spec.ts:19-23,163-183`,
  `register.spec.ts:10-13,88-105`. `renderLogin(loginImpl)` wraps `loginImpl` in
  `vi.fn`; the in-flight tests pass `() => new Subject<AuthUser>()`.

- **Making the form valid in a test is trivial** — no cascades, no async load:
  `form.controls.email.setValue('user@example.com')` +
  `form.controls.password.setValue('secret123')` + `fixture.detectChanges()`.
  Both controls start `''` (invalid).

- **Submit button** binds `[disabled]="form.invalid || submitting()"`
  (`login.html:31`), rendered with the accessible name `Log in`
  (`@@login.submit`). Plain `<button type="submit">` — DOM `.disabled` is the
  natural observation point. Use `screen.getByRole('button', { name: 'Log in' })`
  (CLAUDE.md locator rule; no `container.querySelector`).

- **`ng test` renders English source strings**, not `messages.pl.xlf` — assert
  `'Email is required.'`, `'Enter a valid email address.'`,
  `'Password is required.'`, `'Invalid email or password.'` (the English copy
  from `login.html` / `login.ts`) directly. Same as every other component spec.

- **Validators live at `login.ts:22-23`** (`Validators.required`,
  `Validators.email`) — **inside** the `fb.nonNullable.group({...})` initializer
  (`:21-24`), so they are **outside** the `:26-43` Stryker scope and are not
  mutated by this run. The validator `it` blocks exist for the "zero coverage"
  mandate (basic behavioral coverage of a critical-path component), not to kill
  in-scope mutants.

- **No `login` mutation baseline exists.** Phase 1 captures a real scoped
  baseline (on the zero-test state) first, so the before/after comment has hard
  numbers.

- **Stryker Angular profile** (`context/foundation/stryker-notes.md`):
  `stryker.config.app.json` is a **positional** arg (no `--configFile`), uses
  the `command` runner (`npm run test:ci` per mutant, `coverageAnalysis: off`)
  → run in the background with `dangerouslyDisableSandbox: true`. `$TMPDIR` can
  be empty in sandbox-disabled background runs — redirect logs to an absolute
  scratchpad path.

- **ADAPTATION (confirmed for register #115, alert-form #114 — expected here
  too) — Stryker likely cannot mutate the whole `login.ts`.** `login.ts` is a
  `FormBuilder` component (`form = this.fb.nonNullable.group({...})`, `:21-24`)
  exactly like `register.ts` / `alert-form.ts`. Instrumenting the file wraps
  that initializer in mutant-switch ternaries, widening `this.form`'s inferred
  type so `form.controls.email` / `.password` become possibly-`undefined`;
  Angular `strictTemplates` then fails to compile `login.html` (the `@if`
  chain at `login.html:12,14,22` reads `form.controls.email` / `.password`) and
  the dry run aborts before any mutant runs. **Fix: scope `--mutate` to the line
  range `src/app/features/auth/login/login.ts:26-43`** (both `signal()`
  initializers + `onSubmit`), which leaves the `form` group initializer
  (`:21-24`) un-instrumented. Phase 1 confirms the whole-file scope fails with
  the `strictTemplates` error, then falls back to the line range and records the
  mutant count. If the whole-file scope unexpectedly *does* compile, use it and
  note that in the comment.

- **Branch/PR state**: cut the change branch from current `main` (`0116f30`,
  after #126 archived #115). `npm run ci` hangs locally (chains `ng test` watch)
  — use `npm run test:ci` + `npm run test:worker` (memory:
  `project_npm_ci_hangs_locally`). Phase 3 opens a PR; **do not merge** —
  ask per-PR (lessons.md / memory: `feedback_confirm_before_pr_merge`).

## Desired End State

`login.spec.ts` exists with behavioral coverage of the validator gates, the
happy path, the error path, and the double-submit guard. Re-running
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/login/login.ts:26-43"`
reports **zero surviving mutants on `login.ts:27,30,33,37,39,40`** (signal init
+ guard + `submitting` flag + navigation + error message) — or, for any that
remain, a written equivalence argument in the issue comment (matching the
#91 / #109 / #113 / #114 / #115 "don't chase 100%" discipline). The
`errorMessage.set(null)` mutant (`:32`) is a **documented, accepted survivor**
→ #110 (see "What We're NOT Doing"). The `login.html:31` `[disabled]` binding is
covered by a deliberate-break check (not Stryker). `npm run test:ci` stays
green. `git diff --stat main` shows only `login.spec.ts` (new) +
`test-plan.md` changed — no production `.ts` / `.html`. `test-plan.md` §3
Phase 3 + §8 record the follow-up. Issue #116 has a before/after comment; a PR
is open, unmerged.

### Key Discoveries:

- `renderRegister` (`register.spec.ts:10-29`) is the template: wrap the service
  impl in `vi.fn`, add a `vi.fn` `navigateByUrl` spy (needed for the happy-path
  navigation assertion — #115 stubbed it passively and left the navigation
  mutants to #110; the #116 checklist explicitly wants navigation covered),
  widen the component cast to `{ form, onSubmit, submitting }`, return
  `{ ...result, form, component, login, navigateByUrl }`.
- Form is two `setValue` calls from valid — no cascade, no `ensureLoaded`, no
  dialog DI.
- The `if (...) return` guard's `→ if(false)` mutant is only killed by a
  **call-count** assertion: a second `onSubmit()` mid-flight must not produce a
  second `login` call.
- The `login.html:31` `[disabled]` binding is a *separate* mutation target from
  the `login.ts:30` guard — the in-flight `button.disabled === true` assertion
  covers the template `||` (deliberate break; the `command` runner does not
  mutate `.html`); the call-count assertion covers the `.ts` guard operator
  (covered by Stryker).
- Login's error handler is unconditional and touches no control → the re-enable
  test is a direct `expect(submitButton().disabled).toBe(false)` after
  `subject.error(...)`, no email-edit workaround (unlike #115).
- `login.ts` must be line-range-scoped to `:26-43` for Stryker — see the
  ADAPTATION note.

## What We're NOT Doing

- **No production code changes.** If a mutant genuinely cannot be killed without
  changing `submitting` / guard / error-handler logic, it is documented as
  equivalent, not "fixed".
- **Not chasing `login.ts:32` `errorMessage.set(null)`.** Per the user's
  planning decision (mirroring #115's identical call on `register.ts:33`
  `emailError.set(null)`): it is only observable on a *second* submit after a
  first error (a stale message would linger) — that is a reset/navigation facet,
  not a `submitting`-guard facet. Documented as an accepted survivor → the broad
  `src/app/**` backlog (#110). No 2nd-submit test is added.
- **Not adding validator coverage beyond the three basic gates** (email
  required, email format, password required). The validators are outside the
  Stryker scope; deeper validator mutation coverage is not in this issue.
- **Not touching** `register` / `alert-form` / admin specs — those follow-ups
  already shipped (#113/#114/#115).
- **Not adding** an E2E test — the double-submit guard is unit-observable; the
  browser facet of the auth flow is already covered by the Phase 6 Playwright
  specs (auth-gate redirect, `e2e/seed.spec.ts` login).
- **Not modifying** `login.ts`, `login.html`, `login.scss`, or any other
  production file.
- **Not re-running** the full-repo or worker Stryker profile.

## Implementation Approach

Author `login.spec.ts` modeled on `register.spec.ts`: a `renderLogin(loginImpl?)`
helper wrapping the `login` impl in `vi.fn` and returning `login` +
`navigateByUrl` spies plus a `{ form, onSubmit, submitting }` component cast.
Then add `it` blocks mapping one-to-one to the mutant rows in Current State
Analysis:

1. **validator gates**: email required → `'Email is required.'`; email format →
   `'Enter a valid email address.'`; password required → `'Password is required.'`
   (drive the controls, `markAsTouched()`, assert via `screen.findByText`).
2. **form.invalid no-op**: `component.onSubmit()` on the pristine (empty) form;
   assert `login` not called and the button is `disabled`.
3. **in-flight + double-submit**: valid form, assert the button is *enabled*,
   `fireEvent.click`, do **not** emit, assert the button is `disabled`; call
   `onSubmit()` again; assert `login` was called exactly once.
4. **re-enable-on-error**: `subject.error(new HttpErrorResponse({ status: 401 }))`;
   assert the button is enabled again (direct — no control edit).
5. **happy path**: default `of(FIXTURE_USER)` impl; valid form with specific
   values; click; assert `login` was called with those exact `(email, password)`
   and `navigateByUrl` was called with `'/'`.
6. **error message**: `throwError(() => new HttpErrorResponse({ status: 401 }))`;
   click; assert `screen.findByText('Invalid email or password.')`.

Verification is a scoped Stryker run (baseline at Phase 1 start, "after" at
Phase 3) plus the `login.html:31` deliberate-break check.

## Phase 1: Baseline + spec bootstrap + the `submitting` / guard class

### Overview

Confirm the Stryker scope, capture the real mutation baseline for `login` (on
zero tests), create `login.spec.ts` with the `renderLogin` helper and the
validator gates, then cover the `form.invalid`-no-op, in-flight, double-submit,
and error-path-re-enable facets.

### Changes Required:

#### 1. Scoped Stryker baseline (no file change)

**File**: (command execution)

**Intent**: Confirm the whole-file scope fails under `strictTemplates`, then
record the pre-change (zero-test) survivor list for the before/after comment.

**Contract**: First a quick dry run with the whole-file glob
(`--mutate "src/app/features/auth/login/login.ts" --dryRunOnly`) to confirm/deny
the `strictTemplates` compile failure. Then the real baseline, in the background
(Bash, `dangerouslyDisableSandbox: true`, log to an absolute scratchpad path):
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/login/login.ts:26-43" --reporters progress,clear-text,json`.
When it finishes (~5-15 min), extract from `reports/mutation/mutation.json` the
survived / no-coverage mutants for `login.ts` and note which map to the
`:27` / `:30` / `:33` / `:37` / `:38` / `:39` / `:40` rows. Save counts + the
whole-file-scope result into a scratch note for Phase 3. Separately record the
`login.html:31` `[disabled]` deliberate-break result (`||` → `&&` → which tests
fail) — run after the specs in step 3-7 exist.

#### 2. Create the spec file + render helper

**File**: `src/app/features/auth/login/login.spec.ts` (new)

**Intent**: Establish the test harness for `Login`, modeled on
`register.spec.ts:1-32`. Hand-authored (not `ng generate` — `skipTests` is on;
hand-authoring existing-component specs is the established practice, e.g.
`add-instrument.spec.ts`).

**Contract**:
- Imports: `HttpErrorResponse` from `@angular/common/http`;
  `ActivatedRoute, Router` from `@angular/router`;
  `fireEvent, render, screen` from `@testing-library/angular/zoneless`;
  `Subject, of, throwError` from `rxjs`; `AuthService, AuthUser` from the core
  auth service; `Login` from `./login`.
- `const FIXTURE_USER: AuthUser = { id: 1, email: 'user@example.com', isAdmin: false };`
- `async function renderLogin(loginImpl: () => ReturnType<AuthService['login']> = () => of(FIXTURE_USER))`:
  `const login = vi.fn(loginImpl);`
  `const navigateByUrl = vi.fn(() => Promise.resolve(true));`
  `render(Login, { providers: [{ provide: AuthService, useValue: { login } }, { provide: Router, useValue: { navigateByUrl } }, { provide: ActivatedRoute, useValue: {} }] })`
  — comment the `ActivatedRoute` provider as in `register.spec.ts:18-19` (the
  `RouterLink` "Register" footer link injects it).
- Component cast to `{ form: Login['form']; onSubmit: () => void; submitting: () => boolean }`.
- `return { ...result, form: component.form, component, login, navigateByUrl };`
- `describe('Login', () => { const submitButton = () => screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement; … })`.

#### 3. Validator-gate `it` blocks

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Basic behavioral coverage of the three client-side validator gates
(the "zero coverage" mandate) — email required, email format, password required.

**Contract**: Modeled on `register.spec.ts:34-55`.
- *requires an email and rejects an invalid format*: `email.setValue('')` +
  `markAsTouched()` + `detectChanges()` → `findByText('Email is required.')`;
  then `email.setValue('not-an-email')` + `detectChanges()` →
  `findByText('Enter a valid email address.')`.
- *requires a password*: `password.setValue('')` + `markAsTouched()` +
  `detectChanges()` → `findByText('Password is required.')`.

#### 4. `form.invalid`-no-op `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill the `form.invalid` term of the `:30` guard and the
`login.html:31` binding's left operand.

**Contract**: New `it` — *does not log in while the form is invalid*:
`renderLogin()` (default impl); do not touch the controls (both empty →
`form.invalid` is `true`); `expect(form.invalid).toBe(true)`;
`expect(submitButton().disabled).toBe(true)`; `component.onSubmit()`;
`expect(login).not.toHaveBeenCalled()`.

#### 5. In-flight + double-submit `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill `login.ts:27` (`signal(false) → signal(true)`), `:33`
(`true → false`), the `:30` guard `ConditionalExpression` (`→ if(false)`) and
`LogicalOperator` (`||` → `&&`) mutants, and the `login.html:31` binding
`LogicalOperator` mutant.

**Contract**: New `it` — *keeps the submit button disabled and ignores a second
submit while a login is in flight*: `renderLogin(() => pending)` with
`pending = new Subject<AuthUser>()`; set email + password to valid values;
`fixture.detectChanges()`; `expect(submitButton().disabled).toBe(false)` (kills
the `signal(false)` init mutant — a fresh valid form must have an enabled
button); `fireEvent.click(submitButton())`; `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(true)`; `component.onSubmit()`;
`expect(login).toHaveBeenCalledTimes(1)`.

#### 6. Re-enable-on-error `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill `login.ts:39` (`false → true`).

**Contract**: New `it` — *re-enables the submit button after a failed login*:
same `pending` setup; after `fireEvent.click` + `detectChanges`,
`pending.error(new HttpErrorResponse({ status: 401 }))`; `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(false)`. No control edit needed — the
error handler touches no form control, so the form stays valid and the only
thing that can keep the button disabled is a stuck `submitting` flag.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"`

#### Manual Verification:

- New `it` block names read as behavior statements, each mapping to a mutant row in Current State Analysis.
- `login.spec.ts` is picked up by `npm run test:ci` (visible in output) and NOT by `npm run test:worker`.
- The baseline Stryker survivor counts (and the whole-file-scope result) are recorded for Phase 3.

**Implementation Note**: After Phase 1's automated verification passes, pause
for the human to confirm the spec looks right before starting Phase 2.

---

## Phase 2: Happy path + error message

### Overview

Cover the success path (`login` called with the entered credentials, navigation
to `/`) and the error-message render — the facets the #116 checklist calls out
that Phase 1's guard tests don't touch.

### Changes Required:

#### 1. Happy-path `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill `login.ts:34` (`getRawValue` destructure), `:36` (`login`
argument mutants), `:37` (`ArrowFunction → () => undefined`, `StringLiteral`
`'/'` → `''`).

**Contract**: New `it` — *logs in with the entered credentials and navigates
home on success*: `renderLogin()` (default `of(FIXTURE_USER)`);
`form.controls.email.setValue('user@example.com')`;
`form.controls.password.setValue('secret123')`; `fixture.detectChanges()`;
`fireEvent.click(submitButton())`; `fixture.detectChanges()`;
`expect(login).toHaveBeenCalledWith('user@example.com', 'secret123')`;
`expect(navigateByUrl).toHaveBeenCalledWith('/')`.

#### 2. Error-message `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill `login.ts:40` (`StringLiteral`, `CallExpression`) and `:38`
(`BlockStatement → {}`).

**Contract**: New `it` — *shows an invalid-credentials message when the login
fails*: `renderLogin(() => throwError(() => new HttpErrorResponse({ status: 401 })))`;
valid form; `fireEvent.click(submitButton())`; `fixture.detectChanges()`;
`expect(await screen.findByText('Invalid email or password.')).toBeTruthy()`.

#### 3. Short before/after comment

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Per the #91 / #109 / #114 / #115 precedent — a 1-2 line comment
noting why the async seam (`Subject` + `vi.fn` spies) is needed.

**Contract**: One terse English comment (WHY not WHAT, no banner — see #114's F2
review note), e.g. above the in-flight block:
`// submitting-flag / double-submit guard (issue #116): a synchronous login() stub`
`// flips submitting false→true→false in one tick, so no test can observe the in-flight state.`

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"`

#### Manual Verification:

- The happy-path test asserts both the service-call args and the navigation target.
- The error-message test asserts the rendered DOM text, not the component's `errorMessage()` signal directly.

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

**Intent**: Prove the signal-init / guard / `submitting` / navigation /
error-message survivors are gone.

**Contract**: Run (background, `dangerouslyDisableSandbox: true`, ~5-15 min):
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/login/login.ts:26-43" --reporters progress,clear-text,html,json`.
Compare `reports/mutation/mutation.json` against the Phase 1 baseline. Every
mutant on `:27` / `:30` / `:33` / `:37` / `:38` / `:39` / `:40` must be
`Killed` or `Timeout`. `:32` (`errorMessage.set(null)`) is an accepted
survivor — document the equivalence argument. For any *other* survivor, write an
equivalence argument or add a targeted assertion. Separately re-run the
`login.html:31` deliberate-break check and confirm it still fails ≥1 test.

#### 2. Test plan note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the `login` component + mutation follow-up shipped
(Login was the last of the auth/form components with no spec).

**Contract**: Two edits:
- In the §3 **Phase 3** scope-notes bullet (~line 111), append a sentence: the
  `submitting` / double-submit guard on `login.ts` — and Login's first-ever
  component coverage (validators, happy path, error path) — was closed as a
  follow-up in issue #116, mirroring the #113 / #114 / #115 notes. Note the
  line-range Stryker scope `login.ts:26-43` and the reason (same
  `fb.nonNullable.group` / `strictTemplates` instrumentation issue) and the
  `login.html:31` `[disabled]` deliberate-break check.
- Add a dated entry to the §8 Freshness Ledger summarizing the change (issue
  #116, branch/PR, test-only, no risk-map delta — covers a browser-adjacent
  facet of existing Risk #4 / auth).
- Do not change the Phase 3 table row status. (Risk #4's row text — "only Login
  and Add Instrument are required-only as assumed" — is left as-is: it is a
  historical record of the refresh's assumption, and Add Instrument is still
  uncovered by that lens.)

#### 3. Before/after comment on #116

**File**: (GitHub comment — no file change)

**Intent**: Close the loop per the #91 / #109 / #113 / #114 / #115 precedent.

**Contract**: A short comment: baseline survivor count for `login.ts:26-43`
(zero-test state), post-change count, the exact command used, and the
documented-equivalent `:32` mutant with its argument. Plus one line on the
`login.html:31` `[disabled]` binding: covered by a deliberate-break check (not
Stryker — the Angular `command` runner does not mutate templates), `||` → `&&`
fails the in-flight / `form.invalid` tests. Note the whole-file Stryker scope
was infeasible (the `form` group initializer breaks `strictTemplates` under
instrumentation) — hence the `:26-43` line range.

#### 4. PR

**File**: (GitHub PR)

**Contract**: Branch `test/116-login-component-coverage` (cut from current
`main`, `0116f30`). Conventional-commit title:
`test: add login component tests + kill submitting/guard mutants (#116)`. Body
links #116 and summarizes the before/after. **Do not merge** — ask first
(lessons.md / memory).

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` green on the final branch.
- `git diff --stat main` shows only `login.spec.ts` (new) + `test-plan.md` changed — no production `.ts` / `.html`.
- Stryker `mutation.json` shows zero (or only the documented `:32` equivalent) `submitting` / guard / navigation / error-message survivors in `login.ts`.

#### Manual Verification:

- The before/after comment numbers match the Stryker report.
- PR description is accurate; PR is left unmerged pending confirmation.
- `test-plan.md` §3 + §8 notes read cleanly in context.

**Implementation Note**: After Phase 3, stop. The PR merge is a separate ask.

---

## Testing Strategy

### Unit Tests:

- Validator gates: email required / email format / password required each block submit with the rendered `mat-error`.
- Guard unit: submit is a no-op (button disabled, `login` not called) when `form.invalid` is true.
- In-flight: submit button disabled while the `login` call is pending; enabled on a fresh valid form.
- Double-submit: a second `onSubmit()` during flight produces no second `login` call.
- Happy path: `login` called with the exact entered `(email, password)`; `navigateByUrl('/')` called.
- Error path: submit button re-enabled after the call errors; `'Invalid email or password.'` rendered.

### Integration Tests:

- None — component-level `@testing-library/angular/zoneless` render is the right seam.

### Manual Testing Steps:

1. `npm run test:ci` — all green, new `Login` block visible in output.
2. `npm run test:worker` — still scoped to `test/worker/**`, does not pick up `login.spec.ts`.
3. Read the diff — no production file changed; `login.spec.ts` is new.
4. Inspect `reports/mutation/mutation.html` after the Phase 3 run — filter to `login.ts`, confirm the guard / `submitting` / navigation / error-message rows are green and only `:32` is (if it survives) an accepted survivor.

## Performance Considerations

The Angular Stryker profile reruns the full Vitest suite per mutant (`command`
runner, no perTest coverage). The `:26-43` line range is small (~20-30
mutants). Run baseline and verification in the background. Adding ~8 `it` blocks
adds a handful of `render()` calls (~ms each) to the normal suite — negligible.

## Migration Notes

None — test-only.

## References

- Issue #116 — the follow-up this plan implements (full checklist in the issue body)
- Issue #115 / PR #125 — the identical work for register: `context/archive/2026-08-28-register-submitting-mutants/plan.md`
- Issue #114 / PR #123 — the identical work for the alert form: `context/archive/2026-08-28-alert-form-submitting-mutants/plan.md`
- Issue #113 / PR #117 — the identical work for the admin components: `context/archive/2026-08-28-admin-submitting-mutants/plan.md`
- Pattern to follow: `src/app/features/auth/register/register.spec.ts:1-105` (render helper + Subject + guard tests)
- `context/foundation/stryker-notes.md` — Angular profile, CLI gotchas, sandbox note
- `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3, §6.5 (component-test cookbook)
- `context/foundation/lessons.md` — branch-before-commit, ask-before-merge, English-only
- Memory: `project_npm_ci_hangs_locally` (use `test:ci` + `test:worker`, not `npm run ci`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline + spec bootstrap + the submitting / guard class

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 0a8d6f9
- [x] 1.2 Full unit suite passes: `npm run test:ci` — 0a8d6f9
- [x] 1.3 Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"` — 0a8d6f9

#### Manual

- [x] 1.4 New `it` block names read as behavior statements, each mapping to a mutant row — 0a8d6f9
- [x] 1.5 `login.spec.ts` picked up by `npm run test:ci`, not by `npm run test:worker` — 0a8d6f9
- [x] 1.6 Baseline Stryker survivor counts + whole-file-scope result recorded for Phase 3 — 0a8d6f9

### Phase 2: Happy path + error message

#### Automated

- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Full unit suite passes: `npm run test:ci`
- [x] 2.3 Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"`

#### Manual

- [x] 2.4 Happy-path test asserts both the service-call args and the navigation target
- [x] 2.5 Error-message test asserts the rendered DOM text, not the `errorMessage()` signal

### Phase 3: Verification & close-out

#### Automated

- [ ] 3.1 `npm run test:ci` green on the final branch
- [ ] 3.2 `git diff --stat main` shows only `login.spec.ts` (new) + `test-plan.md` — no production `.ts` / `.html`
- [ ] 3.3 Stryker `mutation.json` shows zero (or only the documented `:32` equivalent) survivors in `login.ts`

#### Manual

- [ ] 3.4 Before/after comment numbers match the Stryker report
- [ ] 3.5 PR description accurate; PR left unmerged pending confirmation
- [ ] 3.6 `test-plan.md` §3 + §8 notes read cleanly in context
