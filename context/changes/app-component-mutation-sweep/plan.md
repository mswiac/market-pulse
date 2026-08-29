# Scoped Stryker mutation sweep for alert-form + register + login component tests — Implementation Plan

## Overview

Run a **broad** (whole-component, not just `onSubmit`) scoped Stryker pass over
`alert-form.ts`, `register.ts`, and `login.ts`, triage the survivors that fall
outside the already-closed `submitting`/guard class (#114/#115/#116), and add
the assertions that kill the behaviourally-meaningful ones:

- the **success path** of each form — no existing test emits a successful
  `create` / `update` / `register` / `login`, so `dialogRef.close(true)`,
  `router.navigateByUrl('/')`, and the submitted-payload shape are all
  currently unverified;
- the **error-reset facet** — `formError.set(null)` / `emailError.set(null)` /
  `errorMessage.set(null)` at the top of each `onSubmit`, deliberately deferred
  to this issue by #114/#115/#116 (a fail-then-resubmit test is the only way to
  observe it);
- `alert-form.ts`'s **display helpers** (`instrumentTypeLabel`,
  `selectedInstrumentCurrency`, `onThresholdBlur`) and the **`valueChanges`
  cascades**, none of which is fully pinned today.

This is a **test-only change — no production code is touched.** It is the
broad-triage half of issue #110; the narrow `submitting`-flag half was split
out per component into #113 (admin) / #114 (alert-form) / #115 (register) /
#116 (login), all shipped and archived. `context/foundation/test-plan.md`
§2 Risk #4, §3 Phase 3, §4, §8.

## Current State Analysis

### The three components

| File | Lines | `fb.nonNullable.group` initializer | Broad Stryker `--mutate` scope |
| --- | --- | --- | --- |
| `alert-form.ts` | 182 | `:61-74` | `alert-form.ts:1-60,alert-form.ts:75-182` |
| `register.ts` | 54 | `:22-25` | `register.ts:1-21,register.ts:26-54` (≈ `:26-54`) |
| `login.ts` | 44 | `:21-24` | `login.ts:1-20,login.ts:25-44` (≈ `:25-44`) |

**Why not a whole-file `--mutate`.** Confirmed across #114/#115/#116:
instrumenting the `form = this.fb.nonNullable.group({...})` initializer wraps it
in mutant-switch ternaries, which widens `this.form`'s inferred type so
`form.controls.<x>` becomes possibly-`undefined`; Angular `strictTemplates` then
fails to compile the component's `.html` (`TS2532: Object is possibly
'undefined'`) and the Stryker dry run aborts before any mutant runs. (#116 also
found the whole-file dry run *appears* to pass while no spec imports the
component — a false positive; all three components have specs, so the failure is
real here.) The fix is a **multi-range `--mutate`** that skips only the group
initializer's line range. Stryker's CLI accepts comma-separated ranges:
`--mutate "file.ts:1-60,file.ts:75-182"`. Phase 1 dry-runs the alert-form range
to confirm it compiles and adjusts the boundaries if a signal/`computed`
initializer in `:1-60` also widens a template type (fallback: `:18-28` +
`:76-182`).

The group-initializer lines (per-field `Validators.required` / `Validators.email`
declarations) stay mutation-uncovered — they are declarative Angular config, not
branching logic, and every one is already exercised by an existing validator
test at the behavioural level.

### What existing tests already cover (post #114/#115/#116)

- **`alert-form.spec.ts`** (13 `it`): the 4 validator/cascade tests
  (`positiveNumberValidator`, RSI range + threshold-reset-on-alertType,
  ticker auto-fill, alertType→PRICE reset), the full `onSubmit` guard
  (`form.invalid`, in-flight double-submit, re-enable-on-error, `loadError()`
  no-op, edit-mode in-flight), and the full `messageFor` map (409/404/400+code/
  generic + two "needs BOTH" tests). **No test emits a successful
  `create`/`update`.**
- **`register.spec.ts`** (8 `it`): email required/format, password minLength,
  409 taken-email, `form.invalid` guard, in-flight double-submit,
  re-enable-on-error, generic non-409, non-`HttpErrorResponse` 409-shaped.
  **No test emits a successful `register`.**
- **`login.spec.ts`** (7 `it`): email required/format, password required,
  `form.invalid` no-op, in-flight double-submit, re-enable-on-error, **success
  path (`login` args + `navigateByUrl('/')` — already present)**, invalid-
  credentials message. #116 scoped Stryker `login.ts:26-43` → 12/13 killed,
  the lone survivor `login.ts:32` `errorMessage.set(null)` explicitly deferred
  here.

### Known survivor backlog handed to #110

From the committed `context/archive/2026-08-28-alert-form-submitting-mutants/stryker-after-note.md`
(scope `alert-form.ts:146-181`, 5 residual survivors):

| Line | Mutant | Disposition in this plan |
| --- | --- | --- |
| `:149` | `formError.set(null)` → removed | **kill** — fail→fix→resubmit test |
| `:152` | `payload` object → `{}` | **kill** — `toHaveBeenCalledWith(payload)` in the success test |
| `:159` | `next: () => dialogRef.close(true)` → `() => undefined` | **kill** — success test asserts `close` called |
| `:159` | `dialogRef.close(true)` → `close(false)` | **kill** — success test asserts `close(true)` |
| `:168` | `if (err instanceof HttpErrorResponse)` → `if (true)` | **document as equivalent** (carried from #114: a non-`HttpErrorResponse` falls through every inner check to the same generic return; only a `null`/`undefined` throw would differ, which no HTTP client produces) |

From #115's "What We're NOT Doing" (→ #110): `register.ts:33`
`emailError.set(null)`, `:38` `void this.router.navigateByUrl('/')` +
`StringLiteral '/'`, `:50` `markAsTouched()`.

From #116 (→ #110): `login.ts:32` `errorMessage.set(null)`.

The **broad** scope additionally exposes, in `alert-form.ts` only, the parts of
the file `:146-181` never reached: `:18-28` validator factories, `:44`
`isEditMode`, `:50` `selectedInstrumentType` init, `:52-54` `instrumentOptions`
computed, `:86-111` the three `valueChanges` subscriptions, `:113-120`
`ensureLoaded` `next`-guard, `:123-125` `instrumentTypeLabel`, `:127-129`
`showRsiOption`, `:133-135` `selectedInstrumentCurrency`, `:137-144`
`onThresholdBlur`. Phase 1's baseline enumerates exactly which of these survive
the current spec; the plan's Phase 1 test list targets the ones a survivor is
expected on.

### Tooling / process facts

- **Stryker Angular profile** (`context/foundation/stryker-notes.md`):
  `stryker.config.app.json` is a **positional** arg (no `--configFile`), uses
  the `command` runner (`npm run test:ci` = `ng test --watch=false
  --progress=false`, rerun in full per mutant, `coverageAnalysis: off`) → run
  in the **background** with `dangerouslyDisableSandbox: true`. `$TMPDIR` can be
  empty in sandbox-disabled background runs — use absolute scratchpad paths.
- The `command` runner **does not mutate `.html` templates.** Each component's
  `[disabled]="form.invalid || submitting()[ || loadError()]"` binding is
  covered by a **deliberate-break check** (`||` → `&&` in the `.html`, run the
  suite, confirm ≥1 in-flight test fails, revert immediately — never commit),
  as recorded in #114/#115/#116. Re-confirm all three in Phase 4.
- `reports/` is gitignored (`/reports`), so `reports/mutation/mutation.json`
  is never committed — copy the numbers into a scratch note per phase.
- `npm run ci` hangs locally (chains `ng test` watch) — use `npm run test:ci`
  + `npm run test:worker` (memory: `project_npm_ci_hangs_locally`).
- `ng test` renders **English source strings**, not `messages.pl.xlf` — assert
  the English copy from the component/template (`'An alert like this already
  exists.'`, `'Something went wrong. Please try again.'`, etc.), matching every
  existing spec in these files.
- Pre-push hook runs worker + Angular tests always; Playwright only if the push
  range touches `src/app/` (it does here) AND `e2e/.env` + `~/.cache/ms-playwright`
  exist — `git push` may need `dangerouslyDisableSandbox: true` (wrangler log
  write under `/home/swiacm/.config`).
- **Branch/PR**: cut `test/110-app-component-mutation-sweep` from current `main`
  (`8974438`, after #128 archived). Phase 4 opens a PR; **do not merge** —
  ask per-PR (lessons.md).

### The caller-controlled render-helper pattern (already in all three specs)

`renderAlertForm({ serviceImpl?, dialogData?, ensureLoaded? })`,
`renderRegister(registerImpl?)`, `renderLogin(loginImpl?)` — each wraps the
service impl in `vi.fn`, returns the spy, and casts the component to
`{ form, onSubmit, submitting }`. The success tests use the **default**
synchronous impl (`of(FIXTURE)`); the reset tests use `throwError(...)` then a
second render or a re-emitting `Subject`. `fixture.detectChanges()` after any
signal write from the test body (zoneless gotcha, §6.5).

## Desired End State

Re-running each file's broad multi-range `--mutate` scope reports **zero
surviving mutants except the documented equivalents** (`alert-form.ts:168`
`instanceof`→`true`; `register.ts:50` `markAsTouched()` if it survives — see
Phase 2). `login.ts:25-44` reports **13/13** (or 12/13 with `:32` re-classified
as equivalent — decided from the Phase 3 run, not pre-committed). `npm run
test:ci` stays green. `git diff --stat main` shows only the three `*.spec.ts`
files + `test-plan.md` changed — no production `.ts` / `.html`. `test-plan.md`
§3 Phase 3 note, §4 Angular row, and §8 ledger record the sweep. Issue #110 has
a per-file before/after comment; a PR is open, unmerged.

### Key Discoveries

- `alert-form.ts`'s submitted payload is `{ ticker, alertType, threshold,
  direction, notificationEmail }` — **not** `instrumentType` (`alert-form.ts:151-152`).
  The success-test assertion must match that exact shape.
- `alert-form.spec.ts`'s `MatDialogRef` stub is `{ close: () => {} }`
  (`alert-form.spec.ts:53`) — needs to become a `vi.fn()` spy returned from the
  helper for the success test.
- `register.ts:50` `markAsTouched()` is **likely equivalent**: `fireEvent.click`
  on the `type="submit"` button fires `ngSubmit` → `FormGroupDirective.submitted`
  = `true` → mat-form-field `errorState` is already `true` via the default
  `ErrorStateMatcher`'s `form.submitted` term, independent of `.touched`. The
  `@else if (emailError())` branch (`register.html:16`) has no `.touched` guard
  anyway. Confirm from the Phase 2 baseline; if it survives, document — don't
  add a brittle `mat-form-field.mat-form-field-invalid` class assertion.
- `alert-form.ts:159` has **two** mutants (arrow→`undefined`, `close(true)`→
  `close(false)`) — one success test with `expect(close).toHaveBeenCalledWith(true)`
  kills both.
- `login.spec.ts` already covers the login success path (`:36-37`), so #116's
  Stryker was 12/13 — Phase 3 only needs the one `:32` reset test.
- Stryker multi-range `--mutate` (comma-separated `file:a-b,file:c-d`) is
  unverified in this repo — Phase 1 confirms it on the alert-form dry run
  before committing to the approach for all three files. Fallback if the CLI
  rejects comma-separated ranges: two sequential runs merged in the scratch note.

## What We're NOT Doing

- **No production code changes.** Any mutant that can't be killed without
  touching component logic is documented as equivalent, not "fixed".
- **Not** re-covering the `submitting`/guard/`messageFor` class — #114/#115/#116
  own it and it's already 100% dead. Phase N only *re-confirms* those rows green.
- **Not** mutation-covering the `fb.nonNullable.group` initializer lines — see
  Current State Analysis (declarative config, behaviourally covered).
- **Not** adding E2E tests — the browser facet of these forms is already
  covered by Phase 6 Playwright specs.
- **Not** touching the admin components (#113 / Phase 5) or the worker profile.
- **Not** promoting §3 Phase 3 / Phase 5 row **Status** values — only the
  scope-note prose + §4 + §8, matching #114/#115/#116.
- **Not** running the full-repo or whole-directory Angular Stryker scope.

## Implementation Approach

One phase per component file (alert-form → register → login), each
self-verifying with its own baseline + "after" Stryker run recorded to a
scratch note, then a pure close-out phase. Within each file phase: add/extend
`it` blocks that map one-to-one to a survivor from that file's baseline, keeping
existing tests intact except where an operator assertion is cheaper to bolt onto
an existing cascade test than to duplicate its setup (alert-form only).

## Phase 1: alert-form.ts broad pass

### Overview

Confirm the multi-range `--mutate` scope compiles, capture the broad baseline,
then add the success-path test, the `formError` reset test, the three
display-helper tests, and operator assertions on the cascade tests; re-run
Stryker and record the after-numbers.

### Changes Required:

#### 1. Confirm scope + capture baseline (no file change)

**File**: (command execution)

**Intent**: Verify comma-separated line ranges work and `strictTemplates` holds,
then record the pre-change survivor list.

**Contract**: Dry run first:
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:1-60,src/app/features/alerts/alert-form/alert-form.ts:75-182" --dryRunOnly`
(background, `dangerouslyDisableSandbox: true`). If it compiles, run the full
baseline with the same `--mutate` plus `--reporters progress,clear-text,json`.
If the dry run trips `TS2532`, narrow the first range (try `:18-28` for the
validator factories only) and re-dry-run; record the working scope. When the
baseline finishes (~20-40 min), extract survived / no-coverage mutants for
`alert-form.ts` from `reports/mutation/mutation.json` into a scratch note,
tagging each as: already-dead (guard/`messageFor`), target (this phase), or
equivalent-candidate.

#### 2. `MatDialogRef.close` spy

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Make the dialog-close observable for the success test.

**Contract**: In `renderAlertForm`, replace `{ close: () => {} }` with
`const close = vi.fn()` provided as `{ provide: MatDialogRef, useValue: { close } }`;
add `close` to the helper's return object.

#### 3. Success-path `it` (create + edit)

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill `alert-form.ts:152` (`payload` → `{}`), `:154-156` (the
`isEditMode ? update : create` ternary), `:159` (both mutants — arrow and
`close(true)`).

**Contract**: Two new `it` blocks using the default synchronous `serviceImpl`:
- *closes the dialog with `true` and submits the entered values on a successful
  create*: valid form (`threshold.setValue(100)` + `detectChanges`), click
  `Create alert`, `detectChanges`; `expect(create).toHaveBeenCalledWith({ ticker:
  '^NDX', alertType: 'PRICE', threshold: 100, direction: 'up', notificationEmail:
  'user@example.com' })`; `expect(close).toHaveBeenCalledWith(true)`;
  `expect(update).not.toHaveBeenCalled()`.
- *routes a successful edit through `update(id, payload)*`: `renderAlertForm({
  dialogData: { alert: ALERT } })`, click `Save changes`, `detectChanges`;
  `expect(update).toHaveBeenCalledWith(42, { ticker: '^NDX', alertType: 'PRICE',
  threshold: 100, direction: 'up', notificationEmail: 'user@example.com' })`;
  `expect(close).toHaveBeenCalledWith(true)`; `expect(create).not.toHaveBeenCalled()`.

#### 4. `formError` reset `it`

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill `alert-form.ts:149` (`formError.set(null)` → removed).

**Contract**: New `it` — *clears a stale error message when the user resubmits*:
render with a re-emitting `Subject` (or a mutable impl that errors on call 1,
succeeds on call 2); valid form; submit; `pending.error(new HttpErrorResponse({
status: 500 }))`; `detectChanges`; assert `screen.getByText('Something went
wrong. Please try again.')` present; then resubmit (`component.onSubmit()` after
the second impl is armed, or a fresh `Subject` that emits `next`); `detectChanges`;
`expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()`.
If a re-emitting single-render setup is awkward, use two renders is **not** an
option here (the reset is within one component lifetime) — use a `vi.fn` impl
with `mockImplementationOnce(() => throwError(...))` then
`mockImplementation(() => of(ALERT))`.

#### 5. Display-helper `it` blocks

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill the `instrumentTypeLabel` (`:124` `?? type`),
`selectedInstrumentCurrency` (`:134` `?.currency ?? ''`), and `onThresholdBlur`
(`:139` `typeof value === 'number' && Number.isFinite(value)`, `:142`
`toFixed(2)`) mutants.

**Contract**: Three new `it` blocks:
- *renders the human label for each instrument type in the Type select*: open
  the `instrumentType` mat-select (or read the rendered `mat-option` text) and
  assert the mapped label (`INSTRUMENT_TYPE_LABELS['INDEX']`, not the raw
  `'INDEX'`) — read the actual map value from `instrument-types.ts`.
- *shows the instrument's currency as a suffix on a price threshold*: default
  render (`^NDX`, PRICE); `expect(screen.getByText('USD')).toBeTruthy()`; then
  switch to a PLN instrument (`instrumentType` → `STOCK`, ticker → `CDR`);
  `detectChanges`; `expect(screen.getByText('PLN')).toBeTruthy()`. (Covers
  `?.currency` lookup and the `?? ''` fallback path via the RSI branch where
  the suffix `@if` is false.)
- *reformats the threshold input to two decimals on blur*: `fireEvent.input` the
  threshold `<input>` with `'12.5'`, `fireEvent.blur` it;
  `expect((input as HTMLInputElement).value).toBe('12.50')`; and a negative
  case — blur with a non-numeric/empty value leaves it unchanged.

#### 6. Operator assertions on the cascade tests

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill the operator mutants in `:86-111` (`valueChanges`) and
`:113-120` (`ensureLoaded` `next`) that the current cascade tests leave alive —
`:96` `!instrument.rsiEligible && ... === 'RSI'`, `:88-90` `if (firstMatch)`,
`:116` `!this.isEditMode && !this.form.controls.instrumentType.value`.

**Contract**: Extend the existing cascade `it` blocks (do not duplicate setup):
- in *resets alertType to PRICE when the ticker switches to a non-RSI-eligible
  instrument*, add the **negative** case — switching to another RSI-eligible
  ticker (`CDR`) while `alertType === 'RSI'` leaves `alertType` as `'RSI'` (kills
  `&&` → `||` and the `!` on `rsiEligible`).
- in *auto-fills the ticker...*, assert that switching to a type with **no**
  matching instrument (if one exists in the fixture — else add a 4th fixture
  row of a lone type) does **not** clear the ticker (`if (firstMatch)` guard),
  OR assert the `INDEX`→first-match path explicitly names `^NDX` (kills the
  `[0]` index if mutated).
- add a new small `it` — *edit mode does not overwrite the pre-filled type when
  instruments finish loading*: `renderAlertForm({ dialogData: { alert: ALERT } })`;
  after render `expect(form.controls.instrumentType.value).toBe('INDEX')` (from
  the alert, not reset to `instrumentTypes()[0]`) — kills the `!this.isEditMode`
  term of the `:116` guard.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"`

#### Manual Verification:

- The confirmed working `--mutate` scope is recorded in the scratch note.
- Baseline + after survivor counts recorded; every non-equivalent target from
  the baseline is `Killed`/`Timeout` in the after run.
- Existing 13 `it` blocks still pass; diff to them is assertion-additive only.
- `git diff main -- src/app/features/alerts/alert-form/` shows only `.spec.ts`.

**Implementation Note**: After Phase 1's automated verification passes, pause for
the human to confirm the spec additions before starting Phase 2.

---

## Phase 2: register.ts broad pass

### Overview

Capture the broad `register.ts` baseline, add the success-path (navigation +
payload) test and the `emailError` reset test, triage `markAsTouched()`.

### Changes Required:

#### 1. Capture baseline (no file change)

**File**: (command execution)

**Contract**: Background run, `dangerouslyDisableSandbox: true`:
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/register/register.ts:1-21,src/app/features/auth/register/register.ts:26-54" --reporters progress,clear-text,json`.
(~10-20 min.) Extract `register.ts` survivors to the scratch note, tagged
already-dead / target / equivalent-candidate. Note whether `:50`
`markAsTouched()` survives.

#### 2. `navigateByUrl` spy

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Make navigation observable.

**Contract**: In `renderRegister`, replace the inline
`{ navigateByUrl: () => Promise.resolve(true) }` with
`const navigateByUrl = vi.fn(() => Promise.resolve(true))`; return it from the
helper. (Mirror `login.spec.ts:14,29`.)

#### 3. Success-path `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill `register.ts:38` (arrow → `undefined`, `'/'` → `''`) and
`:35` `getRawValue` destructure if mutated.

**Contract**: New `it` — *registers with the entered credentials and navigates
home on success*: default sync impl; `email.setValue('new@example.com')`,
`password.setValue('longenoughpassword')`, `detectChanges`; click `Register`,
`detectChanges`; `expect(register).toHaveBeenCalledWith('new@example.com',
'longenoughpassword')`; `expect(navigateByUrl).toHaveBeenCalledWith('/')`.

#### 4. `emailError` reset `it`

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Kill `register.ts:33` (`emailError.set(null)` → removed).

**Contract**: New `it` — *clears the taken-email message when the user fixes the
address and resubmits*: `vi.fn` impl with `mockImplementationOnce(() =>
throwError(() => new HttpErrorResponse({ status: 409 })))` then
`mockImplementation(() => of(FIXTURE_USER))`; submit a valid form; assert
`screen.getByText('This email is already registered.')`; change the email
control to a new value (clears the `server` error → form valid again);
`detectChanges`; resubmit; `detectChanges`;
`expect(screen.queryByText('This email is already registered.')).toBeNull()`
and `expect(navigateByUrl).toHaveBeenCalledWith('/')`.

#### 5. `markAsTouched()` disposition

**File**: scratch note + (Phase 4) issue comment

**Intent**: Record the triage decision for `register.ts:50`.

**Contract**: If the Phase 2 baseline shows `:50` `Killed`, nothing to do. If it
`Survived`: write the equivalence argument in the scratch note (submit-button
click fires `ngSubmit` → `FormGroupDirective.submitted` → mat-form-field
`errorState` true via the default `ErrorStateMatcher`, independent of `.touched`;
the `@else if (emailError())` template branch has no `.touched` guard) — do
**not** add a `mat-form-field` CSS-class assertion.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"`

#### Manual Verification:

- Baseline + after counts recorded; `:33` and `:38` are `Killed` in the after run.
- `:50` is either `Killed` or has a written equivalence argument.
- The 8 existing `it` blocks still pass unchanged.
- `git diff main -- src/app/features/auth/register/` shows only `.spec.ts`.

**Implementation Note**: After Phase 2's automated verification passes, pause for
the human before Phase 3.

---

## Phase 3: login.ts broad pass — close the deferred :32

### Overview

Re-run the (now effectively broad) `login.ts:25-44` scope and add the one
fail-then-resubmit test that kills `login.ts:32` `errorMessage.set(null)`,
the sole survivor #116 deferred here.

### Changes Required:

#### 1. Capture baseline (no file change)

**File**: (command execution)

**Contract**: Background run:
`npx stryker run stryker.config.app.json --mutate "src/app/features/auth/login/login.ts:1-20,src/app/features/auth/login/login.ts:25-44" --reporters progress,clear-text,json`.
(~10-15 min.) Confirm it matches #116's 12/13 with `:32` the survivor; record
any new survivor from the widened `:25` boundary (expected: none — `:1-20` is
imports + injects).

#### 2. `errorMessage` reset `it`

**File**: `src/app/features/auth/login/login.spec.ts`

**Intent**: Kill `login.ts:32` (`errorMessage.set(null)` → removed).

**Contract**: New `it` — *clears the invalid-credentials message when the user
retries and succeeds*: `vi.fn` impl with `mockImplementationOnce(() =>
throwError(() => new HttpErrorResponse({ status: 401 })))` then
`mockImplementation(() => of(FIXTURE_USER))`; valid form; submit; assert
`screen.getByText('Invalid email or password.')`; edit the password control;
`detectChanges`; resubmit; `detectChanges`;
`expect(screen.queryByText('Invalid email or password.')).toBeNull()` and
`expect(navigateByUrl).toHaveBeenCalledWith('/')`.
(The form stays valid after a login error — the error handler touches no control
— so no email-edit workaround is needed to re-enable submit, unlike #115.)

#### 3. After run (no file change)

**File**: (command execution)

**Contract**: Re-run the same `--mutate` scope; confirm `13/13` (or `12/13`
with `:32` re-argued as equivalent — decide from the actual result, and if so
write the argument; the expectation is a clean kill).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"`

#### Manual Verification:

- After run shows `login.ts:32` `Killed` (or a written equivalence argument).
- The 7 existing `it` blocks still pass unchanged.
- `git diff main -- src/app/features/auth/login/` shows only `.spec.ts`.

**Implementation Note**: After Phase 3's automated verification passes, pause for
the human before Phase 4.

---

## Phase 4: Verification & close-out

### Overview

Re-confirm the deliberate-break checks, update the test plan, comment on #110,
open the PR.

### Changes Required:

#### 1. Deliberate-break re-confirmation (no committed change)

**File**: (temporary edits, reverted)

**Contract**: For each of `alert-form.html:85`, `register.html:31`,
`login.html:31`: change `||` → `&&` in the `[disabled]` binding, run
`npm run test:ci`, confirm ≥1 in-flight test fails, `git checkout` the file
immediately. Record which tests fail per file in the scratch note. **Never
commit these edits.**

#### 2. Test plan — §3 Phase 3 note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that #110 closed the broad triage.

**Contract**: Append one sentence to the §3 **Phase 3** scope-notes bullet
(~line 111, after the #116 sentence): issue #110 then ran the broad
whole-component Stryker sweep across `alert-form.ts` / `register.ts` /
`login.ts` (multi-range `--mutate` skipping the `fb.nonNullable.group`
initializer, same `strictTemplates` reason), killing the deferred error-reset
and success-path (`dialogRef.close(true)` / `navigateByUrl('/')` / submitted
payload) survivors and adding display-helper + cascade-operator coverage;
`alert-form.ts:168` `instanceof`→`true` documented equivalent[, plus
`register.ts:50` `markAsTouched()` if it survived].

#### 3. Test plan — §4 Angular row

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect current mutation coverage state.

**Contract**: In the §4 Stack table **Angular component tests** row (~line 197),
update the trailing clause: three component test files (`alert-form.spec.ts`,
`register.spec.ts`, `login.spec.ts`) now each hardened by a scoped Stryker pass
(#114/#115/#116 for the submit-guard class, #110 for the broad sweep); admin
panel components covered separately (#113 / §3 Phase 5). Keep the row's
"Vitest (not Karma…)" lead unchanged.

#### 4. Test plan — §8 Freshness Ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Dated ledger entry, PR #91 style.

**Contract**: Add a `- 2026-08-29 —` entry under §8: broad Stryker mutation
sweep of the three Angular form components (#110), test-only, per-file
multi-range scope; per-file before/after counts; documented equivalents; no
risk-map delta (client-side facet of Risk #4); branch
`test/110-app-component-mutation-sweep`.

#### 5. Before/after comment on #110

**File**: (GitHub comment)

**Contract**: Per file: the exact `--mutate` command, baseline vs after
counts (killed / survived / timeout), the mutants killed by which new test,
and every documented equivalent with its argument. Plus one line per component
on the `[disabled]` deliberate-break result. Note the multi-range scope and
why the whole-file scope is infeasible.

#### 6. PR

**File**: (GitHub PR)

**Contract**: Branch `test/110-app-component-mutation-sweep`. Conventional-commit
title: `test: broad Stryker mutation sweep across alert-form / register / login component tests (#110)`.
Body links #110, summarizes per-file before/after, notes test-only + no
risk-map delta. **Do not merge** — ask first.

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` green on the final branch.
- `git diff --stat main` shows only the three `*.spec.ts` + `test-plan.md` —
  no production `.ts` / `.html`.
- Each file's after-run `mutation.json` shows zero non-equivalent survivors in
  the swept scope.

#### Manual Verification:

- The #110 comment numbers match the three scratch notes.
- All three deliberate-break checks fail ≥1 test and were reverted (not committed).
- §3 / §4 / §8 edits read cleanly in context.
- PR is open, unmerged.

**Implementation Note**: After Phase 4, stop. The PR merge is a separate ask.

---

## Testing Strategy

### Unit Tests:

- **Success path** (all three): the service is called with the exact entered
  values; on success the dialog closes with `true` (alert-form) / the router
  navigates to `/` (register, login).
- **Error reset** (all three): a stale `formError` / `emailError` /
  `errorMessage` is cleared when the user resubmits.
- **Display helpers** (alert-form): type label maps to the human string; the
  currency suffix renders for a price threshold; blur reformats to 2 decimals.
- **Cascade operators** (alert-form): the negative branches of the
  ticker→alertType and type→ticker `valueChanges` subscriptions and the
  `ensureLoaded` `next`-guard.
- **`login.ts:32`**: the invalid-credentials message clears on a successful retry.

### Integration Tests:

- None — component-level `@testing-library/angular/zoneless` render is the right
  seam; these facets are not observable at the HTTP boundary.

### Manual Testing Steps:

1. `npm run test:ci` — all green; new blocks visible in output.
2. `git diff main` — only the three `*.spec.ts` + `test-plan.md`.
3. Open each `reports/mutation/mutation.html` after its phase's after-run —
   filter to the component, confirm the swept scope is green bar the documented
   equivalents.

## Performance Considerations

The `command` runner reruns the full Angular suite per mutant. Broad
`alert-form.ts` is the big one (~60-100 mutants → 20-40 min); `register.ts` and
`login.ts` are small (~20-30 each). Six background runs total (3 baseline + 3
after) across the four phases — kick each off at phase start / before the
commit gate and work while it runs. The ~10 new `it` blocks add a handful of
`render()` calls (~ms each) to the normal suite — negligible.

## Migration Notes

None — test-only.

## References

- Issue #110 — the broad-triage issue this plan implements (checklist + two
  clarifying comments in the issue body)
- Issue #114 / archive `context/archive/2026-08-28-alert-form-submitting-mutants/`
  — the alert-form submit-guard half + `stryker-after-note.md`'s explicit
  "5 residual survivors → #110" table
- Issue #115 / archive `context/archive/2026-08-28-register-submitting-mutants/`
  — the register half + its "What We're NOT Doing" → #110 list
- Issue #116 / archive `context/archive/2026-08-29-login-component-coverage/`
  — login's first spec + the deferred `:32` mutant
- Pattern: `src/app/features/auth/login/login.spec.ts:10-30` (success-path spy
  wiring), `src/app/features/admin/add-instrument/add-instrument.spec.ts:19-39`
- `context/foundation/stryker-notes.md` — Angular profile, CLI gotchas, sandbox
- `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3, §4, §8
- `context/foundation/lessons.md` — branch-before-commit, ask-before-merge,
  English-only, no whole-secrets-file reads
- Memory: `project_npm_ci_hangs_locally`, `feedback_stryker_scoping`,
  `feedback_batch_manual_verification`, `feedback_confirm_before_pr_merge`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: alert-form.ts broad pass

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — b8a43e3
- [x] 1.2 Full unit suite passes: `npm run test:ci` — b8a43e3
- [x] 1.3 Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"` — b8a43e3

#### Manual

- [ ] 1.4 The confirmed working `--mutate` scope is recorded in the scratch note
- [ ] 1.5 Baseline + after counts recorded; every non-equivalent target is Killed/Timeout in the after run
- [ ] 1.6 Existing 13 `it` blocks still pass; diff to them is assertion-additive only
- [ ] 1.7 `git diff main -- src/app/features/alerts/alert-form/` shows only `.spec.ts`

### Phase 2: register.ts broad pass

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — 9d389ba
- [x] 2.2 Full unit suite passes: `npm run test:ci` — 9d389ba
- [x] 2.3 Prettier clean: `npx prettier --check "src/app/features/auth/register/register.spec.ts"` — 9d389ba

#### Manual

- [ ] 2.4 Baseline + after counts recorded; `:33` and `:38` are Killed in the after run
- [ ] 2.5 `:50` `markAsTouched()` is either Killed or has a written equivalence argument
- [ ] 2.6 The 8 existing `it` blocks still pass unchanged
- [ ] 2.7 `git diff main -- src/app/features/auth/register/` shows only `.spec.ts`

### Phase 3: login.ts broad pass — close the deferred :32

#### Automated

- [x] 3.1 Type checking passes: `npm run build` — b4c29b1
- [x] 3.2 Full unit suite passes: `npm run test:ci` — b4c29b1
- [x] 3.3 Prettier clean: `npx prettier --check "src/app/features/auth/login/login.spec.ts"` — b4c29b1

#### Manual

- [ ] 3.4 After run shows `login.ts:32` Killed (or a written equivalence argument)
- [ ] 3.5 The 7 existing `it` blocks still pass unchanged
- [ ] 3.6 `git diff main -- src/app/features/auth/login/` shows only `.spec.ts`

### Phase 4: Verification & close-out

#### Automated

- [x] 4.1 `npm run test:ci` green on the final branch — f032c44
- [x] 4.2 `git diff --stat main` shows only the three `*.spec.ts` + `test-plan.md` — no production `.ts` / `.html` — f032c44
- [x] 4.3 Each file's after-run `mutation.json` shows zero non-equivalent survivors in the swept scope — f032c44

#### Manual

- [ ] 4.4 The #110 comment numbers match the three scratch notes
- [ ] 4.5 All three deliberate-break checks fail ≥1 test and were reverted (not committed)
- [ ] 4.6 §3 / §4 / §8 edits read cleanly in context
- [ ] 4.7 PR is open, unmerged
