# Admin Panel Component Test Coverage Implementation Plan

## Overview

Add Vitest component tests (via `@testing-library/angular/zoneless`) for all 6 admin-panel
components — `admin-panel`, `add-instrument`, `remove-instrument`, `remove-instrument-confirm`,
`remove-user`, `remove-user-confirm` — closing test-plan.md Risk #8 (zero component-test
coverage on destructive/irreversible admin actions and non-trivial form logic). Test tooling
(the `test` architect target, `@testing-library/angular`, the `npm run ci` gate) already
shipped in `frontend-test-bootstrap` (§3 Phase 3) — this change is test-writing only, plus one
cookbook documentation update.

## Current State Analysis

- Zero `.spec.ts` files exist for any of the 6 admin components (`find src/app -name
  "*.spec.ts"` → only `alert-form.spec.ts`, `register.spec.ts`).
- All 6 components are signal-based (`signal`/`computed`) with a hand-rolled `canSubmit`
  guard — **none use `FormGroup`/`FormControl`**. §6.5's flagship pattern (cast to a
  `protected FormGroup`, drive it via `.setValue()`) does not transfer as-is.
- Two distinct dialog DI shapes coexist:
  - *Opener* components (`remove-instrument.ts:35`, `remove-user.ts:33`) inject `MatDialog`
    (non-optional) and call `.open(...).afterClosed()`.
  - *Dialog-content* components (`remove-instrument-confirm.ts:16`, `remove-user-confirm.ts:17`)
    never inject `MatDialogRef` in the class — confirm/cancel is delegated entirely to the
    `mat-dialog-close` template directive, which internally requires `MatDialogRef` from the
    test's `TestBed` providers regardless.
- Both delete flows share a repeated two-step pattern: `onSubmit()` first calls a GET
  impact-preview (`getInstrumentImpact`/`getUserImpact`), then opens the confirm dialog with
  that data, then calls the DELETE only if `afterClosed()` emits truthy
  (`remove-instrument.ts:76-104`, `remove-user.ts:52-80`).
- `add-instrument.ts` has no currency validation gap (currency always defaults from a fixed
  3-value list) — its real untested logic is the type→suffix mapping (`SUFFIX_DEFAULTS`,
  `:19-21`, applied only on type change via `onTypeChange`, `:67-72`) and ticker-uppercasing on
  blur (`onTickerBlur`, `:81-86`, which mutates the DOM input value directly, not just the
  signal).
- `admin-panel.ts` uses `MatDatepicker` (`dateChange` output → `onFromDateChange`/
  `onToDateChange`) rather than a native date input, and has no dialog/delete semantics — it's
  the lowest-blast-radius component of the 6.
- `remove-user.ts`'s `cannot_delete_self` error is server-enforced only; the component does not
  filter the current admin out of the rendered user list client-side — proving the error-code
  mapping renders correctly is in scope, proving self-deletion is actually prevented server-side
  is not (already an integration-test concern elsewhere).

### Key Discoveries:

- `alert-form.spec.ts` and `register.spec.ts` establish the codebase's existing convention:
  render via `@testing-library/angular/zoneless`'s `render()`, an explicit provider stub for
  every injected token (including template-only needs like `ActivatedRoute` for `RouterLink`),
  plain-object service stubs, DOM-level assertions (`screen.findByText`), and
  `fireEvent.click`/`.setValue()` mixed as appropriate — this plan extends that convention to
  signal state instead of `FormGroup` state.
- Signal writes made from test code (not from a real DOM event) are not picked up by the
  zoneless change-detection scheduler automatically — every direct call to a `protected` setter
  method from a test needs an explicit `fixture.detectChanges()` afterward, the same requirement
  `alert-form.spec.ts` already documents for its `FormGroup`-cast trick.
- `admin-panel.ts`'s constructor chain (`ensureLoaded().subscribe()` → first-type pick →
  `onTypeChange`) only resolves synchronously if the `InstrumentsService` stub's
  `instruments`/`types` are already-populated signals and `ensureLoaded()` returns `of([...])` —
  mirrors the "warm cache" ordering note in `frontend-test-bootstrap`'s plan for `AlertForm`.

## Desired End State

`npm run test -- --watch=false` (and `npm run ci`) discovers and passes 6 new `.spec.ts` files,
one per admin component, exercising: form/state behavior, the type→suffix mapping and
blur-uppercase logic, both branches of each confirm-dialog flow (including the impact-preview
GET's own failure path), and each component's error-code-to-message mapping. `test-plan.md`
§6.5 gains a documented signal-driven pattern so a future signal-based component test doesn't
need to reverse-engineer this session's approach from the test files.

### Verification

- `npm run test -- --watch=false` passes with 6 new spec files discovered (zero pre-existing
  admin `.spec.ts` files today).
- `npm run ci` passes end-to-end.
- `context/foundation/test-plan.md` §6.5 contains a new signal-driven sub-pattern (no longer
  silent about the no-`FormGroup` case).

## What We're NOT Doing

- Not adding a `FormGroup`/Reactive Forms migration to any of the 6 components — the signal-based
  architecture is the codebase's current, deliberate state; this phase tests it as-is.
- Not testing `AdminService`, `InstrumentsService` in isolation — these are plain injectable
  HTTP services, not components; service-level unit tests are a separate, undecided scope (same
  exclusion `frontend-test-bootstrap` made for `AlertsService`/`AuthService`).
- Not adding snapshot tests — test-plan.md §7 explicitly defers these as low-signal.
- Not exhaustively testing every individual error code in every component's `ERROR_MESSAGES` map
  — one representative known-code case + the unknown-code/generic-fallback case + one
  highest-consequence code per component, per the confirmed scope decision.
- Not testing real Angular Material overlay interaction (opening a `mat-select` panel, clicking
  a datepicker calendar cell) — driving these via cast + direct protected-setter calls, per the
  confirmed scope decision; only native inputs/checkboxes/buttons get real `fireEvent` DOM
  interaction.
- Not verifying `cannot_delete_self` is actually enforced server-side, or that the current admin
  is filtered from `remove-user`'s rendered list — server enforcement is a pre-existing,
  separately-covered integration concern (test-plan.md Risk Response Guidance #8), not a
  component-test gap.
- Not updating `context/foundation/test-plan.md` §3 "Phased Rollout" table's Status/Change folder
  columns — that refresh is owned by `/10x-test-plan --refresh` (§8), not individual phase
  implementations (matches the convention `frontend-test-bootstrap` and later phases already
  followed).

## Implementation Approach

Four component-test phases, ordered to match the components' original build order
(`admin-panel` → `add-instrument` → `remove-instrument[-confirm]` → `remove-user[-confirm]`) so
the simplest, dialog-free component establishes the new signal-driven pattern first, before the
two dialog-DI shapes are introduced. The two delete-flow phases each cover an opener + its
paired confirm-dialog-content component together, since they're one feature tested as one unit.
A final phase documents the pattern in test-plan.md §6.5, written from the concrete pattern used
across the prior four phases (matching how §6.5 itself was written after Phase 3's two real
component tests, not speculatively before either existed).

## Critical Implementation Details

### State sequencing

Every direct call to a `protected` setter (e.g. `onTypeChange`, `onFromDateChange`,
`onTickerChange`) from test code must be followed by `fixture.detectChanges()` — the zoneless
scheduler only picks up signal writes triggered by a real DOM event or one it's already
tracking, not a write made from outside that context (same requirement `alert-form.spec.ts`
already exercises for its `FormGroup`-cast trick, generalized here to signals).

### Mock dialog behavior

`MatDialog` stubs must return a fake `MatDialogRef`-shaped object whose `afterClosed()` is a
controllable `Observable` (e.g. backed by a `Subject`, one instance created fresh per test) so
a test can drive both the confirm branch (emit `true`) and the cancel branch (emit `undefined`/
`false`) of `remove-instrument.ts`/`remove-user.ts`'s `openConfirmDialog` — asserting only that
`dialog.open` was called is not sufficient to prove the delete-only-on-confirm behavior. The two
`*-confirm` components additionally need a `MatDialogRef` stub with a `close: vi.fn()` in their
own `TestBed` providers (for the `mat-dialog-close` directive), even though the component class
itself never injects `MatDialogRef` — asserting on that `close` mock's call args (`true` for the
"Remove" button, no value for "Cancel") is how the confirm dialogs' own template wiring gets
proven, not just data rendering.

## Phase 1: admin-panel.ts component tests

### Overview

Establish the signal-driven testing pattern (cast + direct setter calls for `mat-select`/
`MatDatepicker`, real `fireEvent` for the submit button) on the simplest of the 6 components —
no dialog, no delete semantics. Cover the type/instrument cascade, the from/to date flow, the
`canSubmit` guard, and a representative slice of the 9-entry `ERROR_MESSAGES` map.

### Changes Required:

#### 1. Admin panel spec file

**File**: `src/app/features/admin/admin-panel.spec.ts`

**Intent**: Render `AdminPanel` with stubbed `InstrumentsService`, `AdminService`,
`MatSnackBar`, exercising the type→instrument cascade, the from/to date signals, the
`canSubmit` guard, and the submit success/error paths.

**Contract**: `InstrumentsService` stub needs already-populated `instruments()`/`types()`
signals (warm-cache ordering, see Critical Implementation Details) so the constructor's
`ensureLoaded()` → `onTypeChange()` chain resolves synchronously. Cast the component instance to
call `onTypeChange`/`onTickerChange`/`onFromDateChange`/`onToDateChange` directly (mirrors the
`FormGroup`-cast trick, generalized to signals), following each with `fixture.detectChanges()`.
Cover: `instrumentOptions()` narrowing to the selected type and the ticker auto-selecting the
first match on type change; `canSubmit()` false until both dates are set; a successful submit
rendering the success snackbar message with the interpolated `daysWritten`/`ticker`/`from`/`to`
values (assert via `screen.findByText`, not the component's internal state); one known error
code (`range_too_large` — the highest-consequence code for this component, a rejected
730-day-cap backfill) rendering its exact mapped message; and an unrecognized/absent error code
falling back to the generic message.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new `admin-panel.spec.ts` assertions
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — component test coverage is fully verified by the automated suite; no separate manual
  UI check adds signal beyond what these tests already assert.

---

## Phase 2: add-instrument.ts component tests

### Overview

Cover the type→suffix mapping (`SUFFIX_DEFAULTS`), ticker-uppercase-on-blur, the `canSubmit`
guard, and a deep verification of the success path (form reset + `InstrumentsService.reload()`
invocation, not just the snackbar message).

### Changes Required:

#### 1. Add instrument spec file

**File**: `src/app/features/admin/add-instrument/add-instrument.spec.ts`

**Intent**: Render `AddInstrument` with stubbed `InstrumentsService`, `AdminService`,
`MatSnackBar`, covering the suffix auto-fill/override behavior, blur-uppercasing, and the
success path's two side effects.

**Contract**: Cast to call `onTypeChange` directly for the type→suffix cascade (`mat-select`),
asserting `suffix()` becomes `.WA` when switching to `pl_stock` and that a manual edit to
`suffix` afterward is not overwritten by a later call to `onTypeChange` with the *same* type.
Use real `fireEvent.input`/`fireEvent.blur` on the ticker `<input>` for `onTickerBlur` — assert
both the signal value and the rendered input's DOM value are uppercased (the handler mutates
`event.target.value` directly, not just the signal). On successful submit: assert the rendered
form fields reflect `resetForm()`'s defaults (type back to `CREATABLE_INSTRUMENT_TYPES[0]`,
ticker/name/suffix cleared, currency/rsiEligible back to defaults) and that the
`InstrumentsService` stub's `reload` was invoked (a `vi.fn()` stub, not just `of([...])`).
Cover one known error code (`instrument_duplicate_ticker` — the highest-consequence code here,
since it silently discards the admin's input if unmapped) and the unknown-code/generic-fallback
case.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new `add-instrument.spec.ts` assertions
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — component test coverage is fully verified by the automated suite; no separate manual
  UI check adds signal beyond what these tests already assert.

---

## Phase 3: remove-instrument + remove-instrument-confirm component tests

### Overview

Cover the full impact-preview→confirm→delete flow for instrument removal, including the
impact-GET failure path and both branches of the confirm dialog, plus the confirm-dialog
component's own template-driven close wiring.

### Changes Required:

#### 1. Remove instrument spec file

**File**: `src/app/features/admin/remove-instrument/remove-instrument.spec.ts`

**Intent**: Render `RemoveInstrument` with stubbed `InstrumentsService`, `AdminService`,
`MatSnackBar`, and a controllable `MatDialog` stub, covering the type/instrument picker, the
impact-preview GET success and failure paths, and both confirm-dialog outcomes.

**Contract**: `MatDialog` stub's `open()` returns `{ afterClosed: () => subject.asObservable() }`
backed by a per-test `Subject<boolean | undefined>` (see Critical Implementation Details).
Cover: submitting calls `getInstrumentImpact` before `dialog.open` is ever called; a rejecting
`getInstrumentImpact` shows the error snackbar, resets `submitting()`, and `dialog.open` is
never called; confirming (`subject.next(true)`) calls `removeInstrument` and, on success,
re-fetches the instrument list and shows the success snackbar with `alertsDeleted`; cancelling
(`subject.next(undefined)`) resets `submitting()` without calling `removeInstrument` at all.
Cover one known error code (`unknown_instrument`) and the unknown-code/generic-fallback case.

#### 2. Remove instrument confirm spec file

**File**: `src/app/features/admin/remove-instrument-confirm/remove-instrument-confirm.spec.ts`

**Intent**: Render `RemoveInstrumentConfirm` directly with `MAT_DIALOG_DATA` and a
`MatDialogRef` stub, covering the conditional `alertsCount > 0` warning and the Cancel/Remove
buttons' `mat-dialog-close` wiring.

**Contract**: Provide `{ provide: MatDialogRef, useValue: { close: vi.fn() } }` even though the
component class never injects it (the template directive needs it from `TestBed`). Assert the
`alertsCount > 0` warning text renders only when `data.alertsCount` is non-zero (test both
`0` and a positive value as two cases); clicking the "Remove" button calls the `close` mock with
`true`; clicking "Cancel" calls `close` with no meaningful value (falsy).

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new `remove-instrument.spec.ts` and
  `remove-instrument-confirm.spec.ts` assertions
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — component test coverage is fully verified by the automated suite; no separate manual
  UI check adds signal beyond what these tests already assert.

---

## Phase 4: remove-user + remove-user-confirm component tests

### Overview

Cover the analogous impact-preview→confirm→delete flow for user removal — including its
distinct `fetchUsers()`-in-constructor init pattern and the `cannot_delete_self` error code — and
the paired confirm dialog's two independent warning conditions.

### Changes Required:

#### 1. Remove user spec file

**File**: `src/app/features/admin/remove-user/remove-user.spec.ts`

**Intent**: Render `RemoveUser` with stubbed `AdminService`, `MatSnackBar`, and a controllable
`MatDialog` stub, covering the user list load (constructor calls `fetchUsers()` directly, not
`ensureLoaded()`), the impact-preview GET success/failure paths, and both confirm-dialog
outcomes.

**Contract**: Same controllable-`Subject` `MatDialog` stub pattern as Phase 3. Cover: a
rejecting `AdminService.listUsers()` renders the load-error message and `noUsers()`/picker
render logic; a rejecting `getUserImpact` shows the error snackbar, resets `submitting()`, and
`dialog.open` is never called; confirming re-fetches the user list (`fetchUsers()` runs again)
and shows the success snackbar with `alertsDeleted`/`triggerEventsDeleted`; cancelling resets
`submitting()` without calling `removeUser`. Cover `cannot_delete_self` (the highest-consequence
code here — see Current State Analysis for why enforcement itself is out of scope) and the
unknown-code/generic-fallback case.

#### 2. Remove user confirm spec file

**File**: `src/app/features/admin/remove-user-confirm/remove-user-confirm.spec.ts`

**Intent**: Render `RemoveUserConfirm` directly with `MAT_DIALOG_DATA` and a `MatDialogRef`
stub, covering the two independent conditional warnings and the Cancel/Remove buttons' wiring.

**Contract**: Same `MatDialogRef` stub requirement as Phase 3's confirm spec. Assert
`alertsCount > 0` and `triggerEventsCount > 0` render (or don't) independently of each other —
test at least one case where only one of the two is non-zero, not just both-zero/both-nonzero —
and the same Cancel/Remove `close` mock assertions as Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new `remove-user.spec.ts` and
  `remove-user-confirm.spec.ts` assertions
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — component test coverage is fully verified by the automated suite; no separate manual
  UI check adds signal beyond what these tests already assert.

---

## Phase 5: §6.5 cookbook documentation update

### Overview

Document the signal-driven testing pattern established in Phases 1–4 as a new sub-section of
`context/foundation/test-plan.md` §6.5, so a future signal-based component test doesn't need to
reverse-engineer the approach from the admin-panel spec files.

### Changes Required:

#### 1. Cookbook update

**File**: `context/foundation/test-plan.md`

**Intent**: Extend §6.5 (currently only covering the `FormGroup`-cast pattern from Alert
Form/Register) with the signal-driven variant this phase used, so the section stops being
silent about the no-`FormGroup` case.

**Contract**: Add a paragraph (not a new numbered subsection — §6.5 stays one cohesive section)
covering: cast to call `protected` signal setters directly for Material-overlay widgets
(`mat-select`, `MatDatepicker`), following each with `fixture.detectChanges()` since the
zoneless scheduler doesn't pick up externally-triggered signal writes on its own; real
`fireEvent` interaction for native inputs/checkboxes/buttons; the two distinct `MatDialog`
DI shapes (opener components inject `MatDialog` non-optionally, dialog-content components never
inject `MatDialogRef` directly but still need a stub in `TestBed` providers for the
`mat-dialog-close` directive); and the controllable-`Subject`-backed `MatDialogRef.afterClosed()`
stub needed to drive both confirm and cancel branches of a dialog-opening flow. Link to
`admin-panel.spec.ts` and `remove-instrument.spec.ts`/`remove-instrument-confirm.spec.ts` as
reference examples, mirroring how the existing `FormGroup` paragraph links to
`alert-form.spec.ts`/`register.spec.ts`.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes (no test-code change in this phase, confirms no
  regression from the doc-only edit)
- `npm run lint` passes (markdown is not linted, but this confirms no stray syntax issue in
  adjacent code fences breaks anything)

#### Manual Verification:

- §6.5 reads as one cohesive section covering both the `FormGroup` and signal-driven cases,
  with working links to the new spec files.

---

## Testing Strategy

### Unit Tests:

- Not applicable — this plan's entire deliverable is component tests themselves (Phases 1-4).

### Integration Tests:

- Not applicable — no Worker/API changes; all changes are Angular component tests.

### Manual Testing Steps:

- Not applicable per-phase (see each phase's Manual Verification: "None"). A final
  `npm run ci` run after Phase 5 confirms the full suite (worker + Angular + build) still passes
  together.

## Performance Considerations

None — test-only change, no production code paths touched.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Research grounding all 6 components' DI/dialog specifics:
  `context/archive/2026-08-25-test-plan-refresh-2026-08-25/research.md`
- Existing signal-free pattern to extend: `src/app/features/alerts/alert-form/alert-form.spec.ts`,
  `src/app/features/auth/register/register.spec.ts`
- Tooling already wired: `context/archive/2026-08-23-frontend-test-bootstrap/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: admin-panel.ts component tests

#### Automated

- [x] 1.1 `npm run test -- --watch=false` passes, including all new `admin-panel.spec.ts` assertions — bbab473
- [x] 1.2 `npm run typecheck` passes — bbab473
- [x] 1.3 `npm run lint` passes — bbab473

#### Manual

- [x] 1.4 None — component test coverage is fully verified by the automated suite — bbab473

### Phase 2: add-instrument.ts component tests

#### Automated

- [x] 2.1 `npm run test -- --watch=false` passes, including all new `add-instrument.spec.ts` assertions — a597e28
- [x] 2.2 `npm run typecheck` passes — a597e28
- [x] 2.3 `npm run lint` passes — a597e28

#### Manual

- [x] 2.4 None — component test coverage is fully verified by the automated suite — a597e28

### Phase 3: remove-instrument + remove-instrument-confirm component tests

#### Automated

- [x] 3.1 `npm run test -- --watch=false` passes, including all new `remove-instrument.spec.ts` and `remove-instrument-confirm.spec.ts` assertions — b749f49
- [x] 3.2 `npm run typecheck` passes — b749f49
- [x] 3.3 `npm run lint` passes — b749f49

#### Manual

- [x] 3.4 None — component test coverage is fully verified by the automated suite — b749f49

### Phase 4: remove-user + remove-user-confirm component tests

#### Automated

- [x] 4.1 `npm run test -- --watch=false` passes, including all new `remove-user.spec.ts` and `remove-user-confirm.spec.ts` assertions
- [x] 4.2 `npm run typecheck` passes
- [x] 4.3 `npm run lint` passes

#### Manual

- [x] 4.4 None — component test coverage is fully verified by the automated suite

### Phase 5: §6.5 cookbook documentation update

#### Automated

- [ ] 5.1 `npm run test -- --watch=false` passes
- [ ] 5.2 `npm run lint` passes

#### Manual

- [ ] 5.3 §6.5 reads as one cohesive section covering both the `FormGroup` and signal-driven cases, with working links to the new spec files
