# Harden alert-form tests against submitting-flag / double-submit mutants — Implementation Plan

## Overview

Add assertions to `alert-form.spec.ts` that observe the in-flight state
(`submitting() === true`) and the return-to-idle state after a failed request,
kill the whole `onSubmit` guard as a unit (including the `loadError()` term),
and — while the test seam is open — cover the `messageFor` error-message map.

Today every `alert-form.spec.ts` test stubs `AlertsService.create` / `.update`
with a synchronous `of(null)`, so `submitting` flips `false → true → false`
inside one tick and no test ever sees `true`; no test asserts the submit button
re-enables on the error path; there is in fact **no test of the submit path at
all** (all 5 existing tests are validator tests). This lets a whole class of
mutants survive.

This is a **test-only change — no production code is touched**. It is the
per-component follow-up to the frontend mutation-testing work (#110, #112,
#113), tracked as issue #114. It is the identical treatment #113 (archived at
`context/archive/2026-08-28-admin-submitting-mutants/`) gave the admin
components. `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3.

## Current State Analysis

- **`alert-form.ts` uses the same `submitting`-signal pattern as the admin
  components:**

  | Location | Code | Mutants at risk |
  | --- | --- | --- |
  | `alert-form.ts:147` | `if (this.form.invalid \|\| this.submitting() \|\| this.loadError()) return;` | `ConditionalExpression` (`→ if(true)`, `→ if(false)`), `LogicalOperator` (`\|\|` → `&&`, ×2) |
  | `alert-form.ts:150` | `this.submitting.set(true);` | `BooleanLiteral` (`true → false`) |
  | `alert-form.ts:161` | `this.submitting.set(false);` (error handler) | `BooleanLiteral` (`false → true`) |
  | `alert-form.html:85` | `[disabled]="form.invalid \|\| submitting() \|\| loadError()"` | `LogicalOperator` (`\|\|` → `&&`, ×2) — Stryker mutates the template expression too |
  | `alert-form.ts:167-181` | `messageFor(err)` — 409 / 404 / 400+`rsi_not_eligible` / generic | `EqualityOperator`, `StringLiteral`, `ConditionalExpression` — all currently uncovered |

- **`alert-form.spec.ts` today**: render helper `renderAlertForm()`
  (`alert-form.spec.ts:15`) hard-codes
  `{ provide: AlertsService, useValue: { create: () => of(null), update: () => of(null) } }`
  and the component cast (`:37`) exposes only `form`. 5 `it` blocks, all
  validator-focused, none touching `onSubmit`.

- **The caller-controlled `Subject` pattern already exists in the repo**
  post-#113: `add-instrument.spec.ts:19-23` — `renderAddInstrument(impl, reload)`
  takes `impl: () => ReturnType<AdminService['addInstrument']>`, wraps it in
  `vi.fn`, and the in-flight tests (`add-instrument.spec.ts:163-183`) pass
  `() => new Subject<CreatedInstrument>()`. `AlertsService.create` / `.update`
  both return `Observable<Alert>` — same shape.

- **Submit button binds `[disabled]="form.invalid || submitting() || loadError()"`**
  (`alert-form.html:85`), rendered with the accessible name `Create alert`
  (`@@alertForm.submit`) in create mode, `Save changes` (`@@alertForm.submitEdit`)
  in edit mode. Plain `<button>` — DOM `.disabled` is the natural observation
  point (simpler than #113's mat-select case).

- **Making the form valid in a test**: `renderAlertForm()` provides an
  `InstrumentsService` stub whose `ensureLoaded()` returns `of(INSTRUMENTS)`
  synchronously, so on render `instrumentType` → first type (`INDEX`), the
  `instrumentType.valueChanges` cascade auto-fills `ticker` → `^NDX`, and
  `notificationEmail` is prefilled from `AuthService.currentUser().email`
  (`user@example.com`). Only `threshold` is empty. Setting
  `form.controls.threshold.setValue(100)` + `fixture.detectChanges()` makes the
  form valid. (`direction` defaults to `'up'`, `alertType` to `'PRICE'`.)

- **Edit mode**: pass `MAT_DIALOG_DATA: { alert: <Alert> }`. `isEditMode`
  becomes `true`, the form pre-fills from the alert, and `onSubmit` routes to
  `alertsService.update(this.data!.alert!.id, payload)` instead of `.create`.
  A full `Alert` object is needed (see `alerts.service.ts:5-22`:
  `id, ticker, instrumentName, instrumentType, currency, alertType, threshold,
  direction, active, notificationEmail, createdAt, updatedAt, currentPrice,
  currentRsi, currentHigh, currentLow`).

- **Zoneless gotcha**: a `subject.next()` / `subject.error()` fired from the
  test body is a signal write outside a tracked context — the DOM only
  reflects `submitting()` after a `fixture.detectChanges()` nudge. This is the
  established pattern (`add-instrument.spec.ts:199-201`).

- **No `alert-form` mutation baseline exists.** `reports/mutation/mutation.json`
  (2026-08-28 14:23) is the #113 admin-only run. Issue #114 enumerates the
  expected survivors; Phase 1 captures a real scoped baseline first so the
  before/after comment has hard numbers.

- **Stryker Angular profile** (`context/foundation/stryker-notes.md`):
  `stryker.config.app.json` is a **positional** arg (no `--configFile`), uses
  the `command` runner (`npm run test:ci` per mutant, `coverageAnalysis: off`)
  → run in the background with `dangerouslyDisableSandbox: true`.

- **ADAPTATION (approved 2026-08-28) — Stryker cannot mutate the whole
  `alert-form.ts`.** Instrumenting the file wraps the
  `form = this.fb.nonNullable.group({...})` initializer (`:61-74`) in
  mutant-switch ternaries, which widens `this.form`'s inferred type so
  `form.controls.threshold` / `.alertType` become possibly-`undefined`; Angular
  `strictTemplates` then fails to compile `alert-form.html` and the dry run
  aborts before any mutant runs. (#113's admin components are signal-based, no
  `FormGroup` — they never hit this.) **Fix: scope `--mutate` to the line range
  `src/app/features/alerts/alert-form/alert-form.ts:146-181`** (`onSubmit` +
  `messageFor`), which leaves the `form` initializer un-instrumented. Verified:
  dry run passes, 42 mutants. The `alert-form.html:85` `[disabled]` binding
  mutants are out of Stryker scope regardless (the `command` runner does not
  mutate `.html` templates) — they are covered by a deliberate-break check
  recorded in the #114 comment.

- **Branch/PR state**: this plan's change branch was cut from a `main` that
  already has PR #122 (E2E-in-CI) merged (`7b104a7`). `npm run ci` hangs
  locally (chains `ng test` watch) — use `npm run test:ci` + `npm run test:worker`
  (memory: `project_npm_ci_hangs_locally`). Phase 3 opens a PR; **do not merge**
  (lessons.md: ask per-PR).

## Desired End State

Re-running
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:146-181"`
reports **zero surviving `submitting` / guard mutants** on `alert-form.ts:147,150,161`
and **zero surviving `messageFor` mutants** (`:167-181`) — or, for any that
remain, a written equivalence argument in the issue comment (matching the
#91 / #109 / #113 "don't chase 100%" discipline). The `alert-form.html:85`
`[disabled]` binding is covered by a deliberate-break check (not Stryker — the
`command` runner does not mutate templates). `npm run test:ci` stays green. `git diff --stat main` shows
only `alert-form.spec.ts` + `test-plan.md` changed. `test-plan.md` §3 records
the follow-up. Issue #114 has a before/after comment; a PR is open, unmerged.

### Key Discoveries:

- Caller-controlled `Subject` + parameterized render helper already in repo: `add-instrument.spec.ts:19-23,163-183` (shipped by #113).
- `renderAlertForm()` currently exposes only `form` on the component cast (`alert-form.spec.ts:37`) — needs `onSubmit` and `submitting` added.
- Form is one `setValue` away from valid on render (`threshold` is the only empty required control) — see Current State Analysis.
- The `if (...) return` guard's `→ if(false)` mutant is only killed by a **call-count** assertion: a second `onSubmit()` mid-flight must not produce a second service call.
- The `alert-form.html:85` `[disabled]` binding is a *separate* mutation target from the `alert-form.ts:147` guard — the in-flight `button.disabled === true` assertion covers the template `||` operators (verified by deliberate break, since the `command` runner does not mutate `.html`); the call-count assertion covers the `.ts` guard operators (covered by Stryker).
- **Stryker on `alert-form.ts` must be line-range-scoped to `:146-181`** — see the ADAPTATION note in Current State Analysis.
- `messageFor` (`:167-181`) has zero coverage today — the existing spec never calls `onSubmit`.

## What We're NOT Doing

- **No production code changes.** If a mutant genuinely cannot be killed
  without changing `submitting` / guard / `messageFor` logic, it is documented
  as equivalent, not "fixed".
- **Not chasing the other survivors** in `alert-form.ts` — the type→ticker /
  ticker→alertType / alertType→threshold `valueChanges` cascades
  (`:86-111`), `showRsiOption()`, `selectedInstrumentCurrency()`,
  `onThresholdBlur()` (`:137-144`), the `isEditMode ? update : create`
  ternary (`:154`). Those belong to the broad `src/app/**` backlog (#110).
- **Not touching** `register` / `login` specs — those are #115 / #116.
- **Not adding** an E2E test — the double-submit guard is unit-observable
  (the browser facet of alert create/delete is already covered by Phase 6
  Playwright specs).
- **Not modifying** `alert-form.ts`, `alert-form.html`, `alert-form.scss`, or
  any other production file.
- **Not re-running** the full-repo or worker Stryker profile.

## Implementation Approach

Parameterize `renderAlertForm()` the way #113 parameterized the admin render
helpers: accept an `impl` for the `create` / `update` call (default
`() => of(ALERT)`), wrap it in `vi.fn`, accept a `dialogData` override for edit
mode, and widen the component cast to `{ form, onSubmit, submitting }`. Then add
dedicated `it` blocks that map one-to-one to the mutant rows in Current State
Analysis:

1. **in-flight**: make the form valid, trigger submit, do **not** emit, assert
   the submit button is `disabled`; call `onSubmit()` again; assert the service
   mock was called exactly once.
2. **re-enable-on-error**: emit `subject.error(new HttpErrorResponse(...))`,
   assert the submit button is enabled again.
3. **loadError no-op**: with `loadError()` forced true (via an
   `ensureLoaded: () => throwError(...)` stub), assert submit is disabled and
   `onSubmit()` does not call the service.
4. **edit mode**: same in-flight assertion on the `update()` branch
   (`dialogData: { alert }`).
5. **messageFor**: one `it` per branch (409, 404, 400+`rsi_not_eligible`,
   generic), asserting the rendered `formError()` text.

Existing tests are left untouched. Verification is a scoped Stryker run
(baseline at Phase 1 start, "after" at Phase 3).

## Phase 1: Baseline + the `submitting` / guard class

### Overview

Capture the real mutation baseline for `alert-form`, then cover the in-flight,
double-submit, error-path-re-enable, `loadError()`-no-op, and edit-mode facets.

### Changes Required:

#### 1. Scoped Stryker baseline (no file change)

**File**: (command execution)

**Intent**: Record the pre-change survivor list for the before/after comment.

**Contract**: Kick off, in the background at phase start (Bash with
`dangerouslyDisableSandbox: true`):
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:146-181" --reporters progress,clear-text,json`
(line-range scope — see the ADAPTATION note). When it finishes (~5 min, 42
mutants), extract from `reports/mutation/mutation.json` the survived/no-coverage
mutants for `alert-form.ts` and note which map to the `:147` / `:150` / `:161`
guard rows and `messageFor` (`:167-181`). Save the counts into a scratch note
for Phase 3. Separately, record the `alert-form.html:85` `[disabled]` binding
deliberate-break result (`||` → `&&` → which tests fail).

#### 2. Parameterize the render helper

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Let a test supply a caller-controlled `create`/`update`
implementation and render in edit mode, and read `onSubmit` / `submitting` off
the component. Follow `add-instrument.spec.ts:19-39` exactly.

**Contract**:
- `renderAlertForm(options?)` where `options` carries an optional
  `serviceImpl?: () => Observable<Alert>` (default `() => of(ALERT)`), an
  optional `dialogData?: AlertFormData | null` (default `null`), and an
  optional `ensureLoaded?: () => Observable<Instrument[]>` (default
  `() => of(INSTRUMENTS)`).
- The `AlertsService` provider becomes
  `{ create: vi.fn(serviceImpl), update: vi.fn(serviceImpl) }`; return both
  spies from the helper (`create`, `update`).
- A module-level `ALERT: Alert` fixture (full shape per `alerts.service.ts:5-22`).
- Widen the component cast to
  `{ form: AlertForm['form']; onSubmit: () => void; submitting: () => boolean }`.
- Existing call sites `await renderAlertForm()` keep working (all args optional).

#### 3. In-flight + double-submit `it`

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill `alert-form.ts:150` (`true → false`), the `:147` guard
`ConditionalExpression` (`→ if(false)`) and `LogicalOperator` mutants, and the
`alert-form.html:85` binding `LogicalOperator` mutants.

**Contract**: New `it` — *keeps the submit button disabled and ignores a
second submit while the create is in flight*: `renderAlertForm({ serviceImpl:
() => pending })` with `pending = new Subject<Alert>()`;
`form.controls.threshold.setValue(100)`; `fixture.detectChanges()`;
`fireEvent.click(submitButton())` (name `Create alert`); `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(true)`; `component.onSubmit()`;
`expect(create).toHaveBeenCalledTimes(1)`.

#### 4. Re-enable-on-error `it`

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill `alert-form.ts:161` (`false → true`).

**Contract**: New `it` — *re-enables the submit button after a failed create*:
same setup with `pending`; after submit, `pending.error(new HttpErrorResponse({
status: 500 }))`; `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(false)`. (Incidentally asserts the
generic `formError()` text — see Phase 2 for the dedicated map coverage.)

#### 5. `loadError()`-no-op `it`

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill the `loadError()` term of the `:147` guard and the
`alert-form.html:85` binding — the "whole guard as a unit" decision.

**Contract**: New `it` — *does not submit while instruments failed to load*:
`renderAlertForm({ ensureLoaded: () => throwError(() => new Error('boom')),
serviceImpl: () => pending })`; the form's `instrumentType`/`ticker` will be
empty (cascade never ran) so also `form.controls.*.setValue(...)` the required
controls to isolate `loadError` as the sole blocker — OR simply assert
`submitButton().disabled === true` and `component.onSubmit(); expect(create).not
.toHaveBeenCalled()`. The load-error branch renders a `<p class="form-error">`
instead of the type/instrument fields (`alert-form.html:11-14`); assert that
copy is present to confirm `loadError()` is genuinely `true`.

#### 6. Edit-mode in-flight `it`

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Exercise the `update()` branch of `onSubmit` (`alert-form.ts:155`)
for the same in-flight assertion, so the `submitting` guard is proven on both
service paths.

**Contract**: New `it` — *keeps submit disabled while an edit is in flight*:
`renderAlertForm({ dialogData: { alert: ALERT }, serviceImpl: () => pending })`;
the form pre-fills from `ALERT` (valid immediately); `fixture.detectChanges()`;
`fireEvent.click(submitButton())` (name `Save changes`); `fixture.detectChanges()`;
`expect(submitButton().disabled).toBe(true)`; `component.onSubmit()`;
`expect(update).toHaveBeenCalledTimes(1)` and `expect(create).not.toHaveBeenCalled()`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"`

#### Manual Verification:

- New `it` block names read as behavior statements, each mapping to a mutant row in Current State Analysis.
- Existing 5 `alert-form.spec.ts` tests are unchanged (diff only adds blocks + widens the helper).
- The baseline Stryker survivor counts are recorded for Phase 3.

**Implementation Note**: After Phase 1's automated verification passes, pause
for the human to confirm the spec additions look right before starting Phase 2.

---

## Phase 2: `messageFor` error-message map

### Overview

Cover the four branches of `messageFor` (`alert-form.ts:167-181`), which have
zero coverage today because nothing exercised `onSubmit`'s error path before
Phase 1.

### Changes Required:

#### 1. Error-map `it` blocks

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Kill the `EqualityOperator` (`err.status === 409/404/400`),
`ConditionalExpression`, and `StringLiteral` mutants in `messageFor`.

**Contract**: Four new `it` blocks, each rendering with
`serviceImpl: () => throwError(() => <HttpErrorResponse>)`, submitting a valid
form, and asserting the rendered `<p class="form-error">` text via
`screen.findByText(...)` (translated strings, as the existing validator tests
do):
- `status: 409` → "An alert like this already exists." (`@@alertForm.error.duplicateAlert`)
- `status: 404` → "This alert no longer exists." (`@@alertForm.error.notFound`)
- `status: 400, error: { code: 'rsi_not_eligible' }` → "RSI is not available for VIX." (`@@alertForm.error.rsiUnavailableForVix`)
- `status: 500` (or any unmapped) → "Something went wrong. Please try again." (`@@alertForm.error.generic`)

Assert the exact rendered copy from the running app (check `messages.pl.xlf`
or run the test once to confirm the Polish string) — the CI locale is
`development-pl`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"`

#### Manual Verification:

- Each `it` asserts a distinct user-visible message, not an internal branch.
- The four blocks map one-to-one to the `messageFor` branches.

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

**Intent**: Prove the `submitting` / guard / `messageFor` survivors are gone.

**Contract**: Run (background, `dangerouslyDisableSandbox: true`, ~5 min):
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:146-181" --reporters progress,clear-text,html,json`.
Compare `reports/mutation/mutation.json` against the Phase 1 baseline. Every
mutant on `:147` / `:150` / `:161` and `:167-181` must be `Killed`. For any
survivor, write an equivalence argument. Separately re-run the
`alert-form.html:85` deliberate-break check and confirm it still fails ≥1 test.

#### 2. Test plan note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the `alert-form` mutation follow-up shipped.

**Contract**: In the §3 **Phase 3** scope-notes bullet (line ~111), append a
sentence: the `submitting` / double-submit mutant class on `alert-form.ts` was
closed as a follow-up in issue #114 (mirroring the identical Phase 5 / #113
note two bullets down), plus any documented-equivalent mutant. Do not change
the Phase 3 table row status.

#### 3. Before/after comment on #114

**File**: (GitHub comment — no file change)

**Intent**: Close the loop per the #91 / #109 / #113 precedent.

**Contract**: A short comment: baseline survivor count for `alert-form.ts:146-181`
(guard + `submitting` + `messageFor`), post-change count, the exact command
used, and any documented-equivalent mutants with their argument. Plus one line
on the `alert-form.html:85` `[disabled]` binding: covered by a deliberate-break
check (not Stryker — the Angular `command` runner does not mutate templates),
`||` → `&&` fails the in-flight tests. Note the whole-file Stryker scope was
infeasible (the `form` group initializer breaks `strictTemplates` under
instrumentation) — hence the `:146-181` line range.

#### 4. PR

**File**: (GitHub PR)

**Contract**: Branch `test/114-alert-form-submitting-mutants` (already cut from
current `main`). Conventional-commit title:
`test: kill submitting-flag / double-submit mutants in alert-form (#114)`.
Body links #114 and summarizes the before/after. **Do not merge** — ask first
(lessons.md).

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` green on the final branch.
- `git diff --stat main` shows only `alert-form.spec.ts` + `test-plan.md` changed — no production `.ts` / `.html`.
- Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / guard / `messageFor` survivors in `alert-form.ts`.

#### Manual Verification:

- The before/after comment numbers match the Stryker report.
- PR description is accurate; PR is left unmerged pending confirmation.
- `test-plan.md` note reads cleanly in context.

**Implementation Note**: After Phase 3, stop. The PR merge is a separate ask.

---

## Testing Strategy

### Unit Tests:

- In-flight: submit button disabled while the `create` / `update` call is pending.
- Double-submit: a second `onSubmit()` during flight produces no second service call.
- Error path: submit button re-enabled after the service call errors.
- Guard unit: submit is a no-op (button disabled, service not called) when `loadError()` is true.
- Edit mode: the same in-flight assertion on the `update()` branch.
- `messageFor`: the correct user-visible message renders for 409 / 404 / 400+`rsi_not_eligible` / generic.

### Integration Tests:

- None — component-level `@testing-library/angular/zoneless` render is the right seam; the guard is not observable at the HTTP boundary.

### Manual Testing Steps:

1. `npm run test:ci` — all green, new blocks visible in output.
2. Read the diff — no production file changed.
3. Inspect `reports/mutation/mutation.html` after the Phase 3 run — filter to `alert-form.ts`, confirm the guard / `submitting` / `messageFor` rows are green.

## Performance Considerations

The Angular Stryker profile reruns the full Vitest suite per mutant (`command`
runner, no perTest coverage) — ~19 min for the `alert-form` glob. Run baseline
and verification in the background. Adding ~9 `it` blocks adds a handful of
`render()` calls (~ms each) to the normal suite — negligible.

## Migration Notes

None — test-only.

## References

- Issue #114 — the follow-up this plan implements (full checklist in the issue body)
- Issue #113 / PR #117 — the identical work for the admin components: `context/archive/2026-08-28-admin-submitting-mutants/plan.md`
- Pattern to follow: `src/app/features/admin/add-instrument/add-instrument.spec.ts:19-39,163-230`
- `context/foundation/stryker-notes.md` — Angular profile, CLI gotchas, sandbox note
- `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3
- `context/foundation/lessons.md` — branch-before-commit, ask-before-merge, English-only
- Memory: `project_npm_ci_hangs_locally` (use `test:ci` + `test:worker`, not `npm run ci`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline + the submitting / guard class

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — e1ae279
- [x] 1.2 Full unit suite passes: `npm run test:ci` — e1ae279
- [x] 1.3 Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"` — e1ae279

#### Manual

- [ ] 1.4 New `it` block names read as behavior statements, each mapping to a mutant row
- [ ] 1.5 Existing 5 `alert-form.spec.ts` tests unchanged (diff only adds blocks + widens the helper)
- [ ] 1.6 Baseline Stryker survivor counts recorded for Phase 3

### Phase 2: messageFor error-message map

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — bb97653
- [x] 2.2 Full unit suite passes: `npm run test:ci` — bb97653
- [x] 2.3 Prettier clean: `npx prettier --check "src/app/features/alerts/alert-form/alert-form.spec.ts"` — bb97653

#### Manual

- [ ] 2.4 Each `it` asserts a distinct user-visible message, not an internal branch
- [ ] 2.5 The four blocks map one-to-one to the `messageFor` branches

### Phase 3: Verification & close-out

#### Automated

- [x] 3.1 `npm run test:ci` green on the final branch
- [x] 3.2 `git diff --stat main` shows only `alert-form.spec.ts` + `test-plan.md` — no production `.ts` / `.html`
- [x] 3.3 Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / guard / `messageFor` survivors in `alert-form.ts`

#### Manual

- [ ] 3.4 Before/after comment numbers match the Stryker report
- [ ] 3.5 PR description accurate; PR left unmerged pending confirmation
- [ ] 3.6 `test-plan.md` §3 Phase 3 note reads cleanly in context
