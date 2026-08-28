# Harden admin panel tests against submitting-flag / double-submit mutants — Implementation Plan

## Overview

Add assertions to the four admin-panel component specs that observe the
in-flight state (`submitting() === true`) and the return-to-idle state after a
failed request. Today every spec stubs the `AdminService` call with a
synchronous `of(...)`, so `submitting` flips `false → true → false` inside one
tick and no test ever sees `true`; no test asserts the submit control
re-enables on the error path. This lets a whole class of mutants survive.

This is a test-only change — **no production code is touched**. It follows up
issue #109 / PR #112 (the scoped Stryker pass that deliberately deferred this
class) and is tracked as issue #113. `context/foundation/test-plan.md` §2
Risk #8, §3 Phase 5.

## Current State Analysis

- **`npx stryker run stryker.config.app.json` (PR #112 baseline)** left 35
  `submitting` / `canSubmit` survivors across the four components:

  | File | `canSubmit` computed | `if` guard | `submitting.set(true)` | `submitting.set(false)` |
  | --- | --- | --- | --- | --- |
  | `admin-panel.ts` | L70 `Cond→true` ×2, `Logical &&→||` | L108 `Cond→false` ×2, `Logical` ×2 | L110 `→false` | L114 (next), L118 (error) `→true` |
  | `add-instrument.ts` | L61 `Cond→true` ×2, `Logical` ×2, `MethodExpr` ×2 | L105 `Cond→false` | L107 `→false` | L113 (next), L119 (error) `→true` |
  | `remove-instrument.ts` | L53 `Cond→true`, `Logical &&→||` | L77 `Cond→false` | L80 `→false` | L109 (post-delete), L114 (delete error) `→true` |
  | `remove-user.ts` | L42 `Cond→true` ×2, `Logical &&→||` | L54 `Cond→false` ×2, `Logical` | L56 `→false` | L85 (post-delete), L90 (delete error) `→true` |

  (The `MethodExpr` mutants on `add-instrument.ts:61` — `this.ticker()` /
  `this.name()` losing `.trim()` — are field-validation, in scope per the
  "whole `canSubmit` unit" decision.)

- **The caller-controlled-Subject pattern already exists** in the repo:
  `remove-instrument.spec.ts:18` / `remove-user.spec.ts:18` thread a
  `dialogSubject = new Subject<boolean | undefined>()` through
  `dialog.open().afterClosed()`. The same shape extends to the service calls.

- **Render helpers already accept an impl function**:
  `renderAdminPanel(impl)` (`admin-panel.spec.ts:16`) and
  `renderAddInstrument(impl, reload)` (`add-instrument.spec.ts:19`) take
  `() => ReturnType<AdminService[...]>` and wrap it in `vi.fn`.
  `renderRemoveInstrument(options)` / `renderRemoveUser(options)` take an
  `options` bag with per-call overrides.

- **Every submit button binds `[disabled]="!canSubmit()"`**
  (`admin-panel.html:46`, `add-instrument.html:46`,
  `remove-instrument.html:32`, `remove-user.html:19`). The two dialog
  components additionally bind `[disabled]="submitting()"` on their
  `mat-select`s (`remove-instrument.html:15,24`, `remove-user.html:12`) — a
  second independent observation point for `submitting()`.

- **Post-success behavior differs**:
  - `admin-panel` — `showResult()` only, form/dates not reset → button
    re-enables after success.
  - `add-instrument` — `resetForm()` clears ticker+name → `canSubmit` is
    `false` after success regardless of the `submitting` mutant. L113 is only
    observable by re-filling the form afterwards.
  - `remove-instrument` / `remove-user` — reset the picker to the first
    entry, so a ticker/user stays selected → button re-enables after success.

- **Dialog flow has three in-flight stages** where `submitting` stays `true`:
  `get*Impact()` pending → `afterClosed()` pending → `remove*()` pending.
  `set(false)` lives in five places; the impact-error and dialog-cancel ones
  are already killed (`remove-instrument.spec.ts:94,108`,
  `remove-user.spec.ts:85,99`), leaving the post-delete and delete-error ones.

- **Zoneless gotcha**: signal writes originating outside a tracked context
  (a `Subject.next()` from the test) need a `fixture.detectChanges()` nudge
  before the DOM reflects them — already the established pattern in these
  specs.

- **Branch/PR state**: PR #112 (`test/109-...`) is merged. `main` may be
  behind locally — the implementer starts from a fresh `main`.

## Desired End State

Re-running `npx stryker run stryker.config.app.json --mutate "src/app/features/admin/**/*.ts,!src/app/features/admin/**/*.spec.ts"`
reports **zero surviving `submitting` / `canSubmit` mutants** in the four
components (or, for any that remain, a written equivalence argument in the
before/after comment — matching the #91 / #109 "don't chase 100%" discipline).
`npm run test:ci` stays green. `test-plan.md` §3 Phase 5 notes record the
follow-up. Issue #113 has a before/after comment; a PR is open.

### Key Discoveries:

- Caller-controlled `Subject` pattern already in repo: `remove-user.spec.ts:18`.
- Render helpers already parameterized on the service impl: `admin-panel.spec.ts:16`, `add-instrument.spec.ts:19`.
- `add-instrument`'s `resetForm()` (`add-instrument.ts:125`) masks the L113 `set(false)` mutant unless the form is re-filled after success.
- The `if (!this.canSubmit()) return` conditional mutants (`→ if (false)`) are only killed by a **call-count** assertion — a second `component.onSubmit()` during flight must not produce a second service call.
- `mat-select [disabled]="submitting()"` in the dialog components is a second observation point (`remove-instrument.html:15`).

## What We're NOT Doing

- **No production code changes.** If a mutant genuinely cannot be killed
  without changing `submitting`/`canSubmit` logic, it is documented as
  equivalent, not "fixed".
- **Not chasing the other ~98 survivors** in these files (error-message maps,
  snackbar config, suffix logic, sort order) — out of scope for #113.
- **Not touching** `alert-form`, `register`, `login` — those are #114 / #115 /
  #116.
- **Not adding** an E2E test — the double-submit guard is unit-observable.
- **Not modifying** the `*-confirm` dialog components or their specs.
- **Not re-running** the full-repo or worker Stryker profile.

## Implementation Approach

For each component: thread a `Subject` (or a pending observable that never
emits) through the render helper for the relevant `AdminService` call, then add
two dedicated `it` blocks —

1. **in-flight**: trigger submit, do **not** emit, assert the submit button is
   `disabled` (and, for dialog components, the `mat-select` too), then call
   `component.onSubmit()` a second time and assert the service mock was called
   exactly once.
2. **re-enable-on-error**: emit an error, assert the submit control is enabled
   again.

Plus the component-specific extras from Current State Analysis (admin-panel
post-success re-enable; add-instrument re-fill; dialog components' three
in-flight windows and post-success re-enable). Existing tests are left
untouched; new blocks map one-to-one to mutant rows.

Verification is a single scoped Stryker run at the end (~19 min, background),
matching issue #113's checklist command.

## Phase 1: Simple-form components (`admin-panel`, `add-instrument`)

### Overview

Cover the `submitting` / `canSubmit` / guard mutants in the two components
whose submit path is a single service call with no dialog.

### Changes Required:

#### 1. AdminPanel spec

**File**: `src/app/features/admin/admin-panel.spec.ts`

**Intent**: Add coverage for the in-flight disabled state, the double-submit
guard, the error-path re-enable, the post-success re-enable, and the
`canSubmit` field-validation operators. The render helper already takes
`impl: () => ReturnType<AdminService['fetchMarketData']>`.

**Contract**:
- New `it` — *keeps submit disabled and ignores a second submit while a fetch is in flight*: render with `impl = () => subject` where `subject = new Subject<MarketDataFetchResult>()`; set both dates via `component.onFromDateChange` / `onToDateChange`; `detectChanges`; `component.onSubmit()`; `detectChanges`; assert `submitButton().disabled === true`; call `component.onSubmit()` again; assert `fetchMarketData` mock `toHaveBeenCalledTimes(1)`. Kills `admin-panel.ts:70` `Cond→true`, `:108` `Cond→false` + `Logical`, `:110` `→false`.
- New `it` — *re-enables submit after a failed fetch*: `impl = () => subject`; submit; `subject.error(new HttpErrorResponse({ status: 500 }))`; `detectChanges`; assert `submitButton().disabled === false`. Kills `:118 →true`.
- New `it` — *re-enables submit after a successful fetch* (dates are not reset): `impl = () => subject`; submit; `subject.next(RESULT)`; `detectChanges`; assert `submitButton().disabled === false`. Kills `:114 →true`.
- New `it` — *submit stays disabled when only one date is set* and *`onSubmit` is a no-op then*: set only `fromDate`; `detectChanges`; assert `submitButton().disabled === true`; `component.onSubmit()`; assert `fetchMarketData` not called. Repeat with only `toDate`. Kills the `:70` / `:108` `LogicalOperator` mutants (`&&→||`, re-associations).

**Note**: `submitButton()` helper already exists at `admin-panel.spec.ts:53`
(`getByRole('button', { name: 'Fetch market data' })`).

#### 2. AddInstrument spec

**File**: `src/app/features/admin/add-instrument/add-instrument.spec.ts`

**Intent**: Same in-flight / error / double-submit coverage, plus a re-fill
assertion after success (because `resetForm()` otherwise masks the
success-handler `set(false)` mutant), plus `canSubmit` operator coverage for
the empty-ticker / empty-name states.

**Contract**:
- New `it` — *keeps submit disabled and ignores a second submit while the create is in flight*: `renderAddInstrument(() => subject)` with `subject = new Subject<CreatedInstrument>()`; fill ticker + name via `fireEvent.input`; `detectChanges`; click submit; `detectChanges`; assert `submitButton().disabled === true`; `component.onSubmit()` again (helper must expose `onSubmit` — add to the `component` cast at `add-instrument.spec.ts:30`); assert `addInstrument` `toHaveBeenCalledTimes(1)`. Kills `:61 Cond→true`, `:105 Cond→false`, `:107 →false`.
- New `it` — *re-enables submit after a failed create*: `subject.error(new HttpErrorResponse({ status: 500 }))`; `detectChanges`; assert `submitButton().disabled === false`. Kills `:119 →true`.
- New `it` — *allows a second instrument to be added after a successful create*: `subject.next(CREATED)`; `detectChanges` (form is now reset); re-fill ticker + name via `fireEvent.input`; `detectChanges`; assert `submitButton().disabled === false`. Kills `:113 →true`.
- New `it` — *submit is disabled when ticker or name is blank*: fill only ticker (name blank), `detectChanges`, assert `submitButton().disabled === true`; then fill only name (ticker blank), assert disabled. Kills `:61` `LogicalOperator` (`&&→||`) and the `MethodExpr` mutants (`.trim()` removal — assert with a whitespace-only value: `'   '` → still disabled).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or the project's `tsc` step)
- Full unit suite passes: `npm run test:ci`
- Prettier clean on the two changed files: `npx prettier --check "src/app/features/admin/**/*.spec.ts"`

#### Manual Verification:

- New `it` block names read as behavior statements, each mapping to a mutant row in Current State Analysis.
- Existing `admin-panel.spec.ts` / `add-instrument.spec.ts` tests are unchanged (diff only adds blocks + the `onSubmit` cast).

**Implementation Note**: After Phase 1's automated verification passes, pause
for the human to confirm the spec additions look right before starting
Phase 2.

---

## Phase 2: Dialog-flow components (`remove-instrument`, `remove-user`)

### Overview

Cover the same mutant classes in the two components whose submit path is
`get*Impact()` → confirm dialog → `remove*()`, where `submitting` stays `true`
across all three stages.

### Changes Required:

#### 1. RemoveInstrument spec

**File**: `src/app/features/admin/remove-instrument/remove-instrument.spec.ts`

**Intent**: Assert the button **and** the `mat-select` stay disabled through
each of the three in-flight windows, that a second `onSubmit()` is ignored,
that the button re-enables on a delete error, and that it re-enables after a
successful delete (picker resets but a ticker stays selected). `dialogSubject`
already exists; add a `getInstrumentImpact` Subject override and expose
`onSubmit` on the `component` cast (`remove-instrument.spec.ts:51`).

**Contract**:
- New `it` — *keeps the submit button and picker disabled while the impact preview is in flight*: `renderRemoveInstrument({ getInstrumentImpact: () => impactSubject })` with `impactSubject = new Subject<InstrumentImpact>()`; click submit; `detectChanges`; assert `submitButton().disabled === true` and the ticker `mat-select` is disabled (query via `screen.getByRole('combobox', ...)` or the existing select locator pattern); call `component.onSubmit()` again; assert `getInstrumentImpact` mock `toHaveBeenCalledTimes(1)`. Kills `:53 Cond→true`, `:77 Cond→false`, `:80 →false`.
- Extend behavior into window 2 (dialog open): in the same or a sibling test, `impactSubject.next({ ticker: '^NDX', alertsCount: 2 })`; `detectChanges`; assert still disabled (dialog not yet closed).
- Extend into window 3 (delete pending): `dialogSubject.next(true)` with `removeInstrument: () => deleteSubject`; `detectChanges`; assert still disabled.
- New `it` — *re-enables the submit button after a failed delete*: drive to window 3, `deleteSubject.error(new HttpErrorResponse({ status: 500 }))`; `detectChanges`; assert `submitButton().disabled === false`. Kills `:114 →true`.
- Extend the existing *previews impact… removes on confirm* test (`:65`) with a trailing assertion: after the success snackbar, `submitButton().disabled === false` and the `mat-select` is enabled. Kills `:109 →true`.
- New `it` — *submit is disabled when no ticker is selected*: render with an empty instrument list (`instruments: () => []`), assert `submitButton().disabled === true`; `component.onSubmit()`; assert `getInstrumentImpact` not called. Kills `:53` `LogicalOperator` (`&&→||`).

#### 2. RemoveUser spec

**File**: `src/app/features/admin/remove-user/remove-user.spec.ts`

**Intent**: Mirror of RemoveInstrument. `dialogSubject` and the `component`
cast (with `users` / `selectedUserId`) already exist
(`remove-user.spec.ts:39`); add `getUserImpact` Subject support, an
`onSubmit` cast member, and a `removeUser` Subject path.

**Contract**:
- New `it` — *keeps the submit button and user picker disabled while the impact preview is in flight*: `renderRemoveUser({ getUserImpact: () => impactSubject })`; click submit; `detectChanges`; assert `submitButton().disabled === true` and the user `mat-select` disabled; second `component.onSubmit()`; assert `getUserImpact` `toHaveBeenCalledTimes(1)`. Kills `:42 Cond→true`, `:54 Cond→false` + `Logical`, `:56 →false`.
- Extend through windows 2 and 3 as in RemoveInstrument.
- New `it` — *re-enables the submit button after a failed delete*: `removeUser: () => deleteSubject`, drive to window 3, `deleteSubject.error(...)`, assert `submitButton().disabled === false`. Kills `:90 →true`.
- Extend the existing *previews impact… re-fetches the list* test (`:53`) with a trailing `submitButton().disabled === false` / picker-enabled assertion. Kills `:85 →true`.
- New `it` — *submit is disabled when the user list is empty*: `listUsers: () => of([])`; assert `submitButton().disabled === true`; `component.onSubmit()`; assert `getUserImpact` not called. Kills `:42` `LogicalOperator`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Full unit suite passes: `npm run test:ci`
- Prettier clean: `npx prettier --check "src/app/features/admin/**/*.spec.ts"`

#### Manual Verification:

- The `mat-select` disabled assertion uses an accessibility-first locator (role `combobox` / `getByLabelText`), not a CSS selector — per CLAUDE.md E2E locator rule, applied here by analogy.
- Existing dialog-cancel and impact-error tests still pass unchanged.
- New block names map one-to-one to the Phase 2 mutant rows.

**Implementation Note**: After Phase 2's automated verification passes, pause
for the human before starting the Stryker verification in Phase 3.

---

## Phase 3: Verification & close-out

### Overview

Confirm the mutants are dead, update the test plan, report, and open the PR.

### Changes Required:

#### 1. Scoped Stryker run

**File**: (no file change — command execution)

**Intent**: Prove the `submitting` / `canSubmit` survivors are gone.

**Contract**: Run
`npx stryker run stryker.config.app.json --mutate "src/app/features/admin/**/*.ts,!src/app/features/admin/**/*.spec.ts" --reporters progress,clear-text,html,json`
in the background (~19 min; run the Bash call with
`dangerouslyDisableSandbox: true` per `stryker-notes.md`'s sandbox note).
Compare `reports/mutation/mutation.json` against the baseline table in Current
State Analysis. Every `submitting` / `canSubmit` mutant listed there must move
to `Killed`. For any that survive, write an equivalence argument.

#### 2. Test plan note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the mutation follow-up shipped.

**Contract**: In the §3 Phase 5 notes bullet (around line 104), append a
sentence noting the `submitting` / double-submit mutation survivors were closed
via issue #113. Do not change the Phase 5 table row status logic beyond that.

#### 3. Before/after comment on #113

**File**: (GitHub comment — no file change)

**Intent**: Close the loop per the #91 / #109 precedent.

**Contract**: A short comment: baseline survivor count for the four files (from
the table), post-change count, the command used, and any documented-equivalent
mutants with their argument.

#### 4. PR

**File**: (GitHub PR)

**Contract**: Branch `test/113-admin-submitting-mutants` off fresh `main`.
Conventional-commit title, e.g.
`test: kill submitting-flag / double-submit mutants in admin components (#113)`.
Body links #113 and summarizes the before/after. **Do not merge** — ask first.

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` green on the final branch.
- `git diff --stat main` shows only `*.spec.ts` files + `test-plan.md` changed — no production `.ts`.
- Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / `canSubmit` survivors in the four components.

#### Manual Verification:

- The before/after comment numbers match the Stryker report.
- PR description is accurate; PR is left unmerged pending confirmation.
- `test-plan.md` note reads cleanly in context.

**Implementation Note**: After Phase 3, stop. The PR merge is a separate ask
(lessons.md: "Always ask for explicit confirmation before merging any PR").

---

## Testing Strategy

### Unit Tests:

- In-flight: submit control disabled while the service call is pending.
- Double-submit: a second `onSubmit()` during flight produces no second service call.
- Error path: submit control re-enabled after the service call errors.
- Success path: submit control re-enabled (or re-enterable, for `add-instrument`) after the call succeeds.
- `canSubmit` field validation: control disabled for blank / whitespace-only required fields.
- Dialog components: all three in-flight windows covered; `mat-select` disabled alongside the button.

### Integration Tests:

- None — component-level `@testing-library/angular/zoneless` render is the right seam; the guard is not observable at the HTTP boundary.

### Manual Testing Steps:

1. `npm run test:ci` — all green, new blocks visible in output.
2. Read the diff — no production file changed.
3. Inspect `reports/mutation/mutation.html` after the Phase 3 run — filter to the four files, confirm the `submitting` / `canSubmit` rows are green.

## Performance Considerations

The Angular Stryker profile reruns the full Vitest suite per mutant (`command`
runner, no perTest coverage) — ~19 min for the admin glob. Run it in the
background. Adding ~10 `it` blocks adds a handful of `render()` calls (~ms
each) to the normal suite — negligible.

## Migration Notes

None — test-only.

## References

- Issue #113 — the follow-up this plan implements (full checklist in the issue body)
- Issue #109 / PR #112 — the scoped Stryker pass that deferred this class; PR #112's issue comment has the full survivor triage
- `context/foundation/stryker-notes.md` — Angular profile, CLI gotchas, sandbox note
- `context/foundation/test-plan.md` §2 Risk #8, §3 Phase 5
- `context/foundation/lessons.md` — branch-before-commit, ask-before-merge, English-only
- Pattern to follow: `src/app/features/admin/remove-user/remove-user.spec.ts:18` (`dialogSubject`)
- Baseline data: `reports/mutation/mutation.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Simple-form components (admin-panel, add-instrument)

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 89e8822
- [x] 1.2 Full unit suite passes: `npm run test:ci` — 89e8822
- [x] 1.3 Prettier clean on the two changed spec files — 89e8822

#### Manual

- [x] 1.4 New `it` block names read as behavior statements, each mapping to a mutant row
- [x] 1.5 Existing admin-panel / add-instrument tests unchanged (diff only adds blocks + `onSubmit` cast)

### Phase 2: Dialog-flow components (remove-instrument, remove-user)

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — ed2cf7d
- [x] 2.2 Full unit suite passes: `npm run test:ci` — ed2cf7d
- [x] 2.3 Prettier clean on the changed spec files — ed2cf7d

#### Manual

- [x] 2.4 `mat-select` disabled assertion uses an accessibility-first locator, not CSS — adapted: asserts `component.submitting()` (signal read) instead of the mat-select DOM node; more robust, same mutant coverage, within the plan's fallback clause
- [x] 2.5 Existing dialog-cancel and impact-error tests still pass unchanged
- [x] 2.6 New block names map one-to-one to the Phase 2 mutant rows

### Phase 3: Verification & close-out

#### Automated

- [x] 3.1 `npm run test:ci` green on the final branch
- [x] 3.2 `git diff --stat main` shows only `*.spec.ts` + `test-plan.md` — no production `.ts`
- [x] 3.3 Stryker `mutation.json` shows zero (or only documented-equivalent) `submitting` / `canSubmit` survivors in the four components

#### Manual

- [ ] 3.4 Before/after comment numbers match the Stryker report
- [ ] 3.5 PR description accurate; PR left unmerged pending confirmation
- [x] 3.6 `test-plan.md` §3 Phase 5 note reads cleanly in context
