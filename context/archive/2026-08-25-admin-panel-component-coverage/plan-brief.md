# Admin Panel Component Test Coverage — Plan Brief

> Full plan: `context/changes/admin-panel-component-coverage/plan.md`
> Research: `context/archive/2026-08-25-test-plan-refresh-2026-08-25/research.md`

## What & Why

Add Vitest component tests for all 6 admin-panel components (`admin-panel`, `add-instrument`,
`remove-instrument[-confirm]`, `remove-user[-confirm]`), which currently have zero test
coverage despite handling destructive/irreversible actions (instrument/user removal) and
non-trivial form logic (type→suffix mapping). This closes test-plan.md Risk #8.

## Starting Point

Test tooling (Vitest as the `test` architect target, `@testing-library/angular`, the
`npm run ci` gate) already shipped in `frontend-test-bootstrap` (§3 Phase 3), which covered
Alert Form and Register but explicitly scoped the admin panel out on now-outdated
"required-only" reasoning. All 6 admin components are signal-based (`signal`/`computed`, no
`FormGroup`) — a real divergence from Alert Form/Register that the existing §6.5 cookbook
pattern (drive a `protected FormGroup` via `.setValue()`) doesn't cover.

## Desired End State

`npm run test -- --watch=false` and `npm run ci` pass with 6 new `.spec.ts` files covering
every component's state logic, both branches of each confirm-dialog delete flow (including the
impact-preview GET's own failure path), and each component's error-code-to-message mapping.
`test-plan.md` §6.5 gains a documented signal-driven pattern for future component tests.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Material input driving | Cast + direct setter calls for `mat-select`/`MatDatepicker`; real `fireEvent` for native inputs/buttons | Matches existing codebase precedent (bypass finicky overlay simulation) while still proving native-input template wiring | Plan |
| Error-code coverage depth | One known code + unknown-code fallback + one highest-consequence code per component | Closes the "wrong message for an important error" gap cheaply without exhaustively re-testing a simple 1:1 map | Plan |
| Impact-preview GET failure path | Test it explicitly for both delete flows | Easy-to-overlook failure mode distinct from the delete call itself; matches §6.3's "test every external-call outcome" discipline | Plan |
| add-instrument success-path depth | Assert both form reset AND `reload()` invocation, not just the snackbar | Proves the two real side effects described in the risk statement, not just DB/UI-adjacent state | Plan |
| §6.5 cookbook update | Yes, as part of this phase's scope | test-plan.md itself flags this as open; mirrors how §6.5 was originally written from concrete phase experience | Plan |
| Phase breakdown | 4 test-writing phases (grouped by original component build order) + 1 doc phase | Simplest, dialog-free component first establishes the pattern; opener + paired confirm-dialog tested together as one feature | Plan |

## Scope

**In scope:**
- Component tests for all 6 admin components, including `admin-panel.ts`'s backfill form
- A signal-driven testing pattern (cast + direct setter calls, controllable `MatDialog` stub)
- A `test-plan.md` §6.5 documentation update

**Out of scope:**
- Migrating any component to `FormGroup`/Reactive Forms
- `AdminService`/`InstrumentsService` unit tests (plain HTTP services, not components)
- Snapshot tests (test-plan.md §7 exclusion)
- Exhaustive per-error-code coverage, or real Material overlay UI simulation
- Server-side verification of `cannot_delete_self` enforcement (separately covered elsewhere)

## Architecture / Approach

Each component gets its own `.spec.ts`, colocated per existing convention. Signal state is
driven by casting the component instance and calling `protected` setter methods directly
(the signal-based equivalent of the existing `FormGroup`-cast trick), followed by
`fixture.detectChanges()` since zoneless change detection doesn't auto-pick-up externally
triggered signal writes. `MatDialog` stubs return a fake `MatDialogRef` backed by a
per-test `Subject`, letting tests drive both the confirm and cancel branches of each delete
flow. The two `*-confirm` dialog-content components need a `MatDialogRef` stub in `TestBed`
providers even though their component class never injects it — the `mat-dialog-close`
template directive requires it internally.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. admin-panel.ts tests | Establishes the signal-driven pattern; type/date cascade + error-map coverage | Datepicker-casting approach needs to actually match `dateChange` output wiring |
| 2. add-instrument.ts tests | Type→suffix mapping, blur-uppercase, deep success-path verification | Blur handler mutates DOM input directly — test must assert both signal and DOM value |
| 3. remove-instrument[-confirm] tests | Full delete flow incl. impact-GET failure + confirm/cancel branches | Controllable-`Subject` `MatDialog` stub must correctly emit both outcomes per test |
| 4. remove-user[-confirm] tests | Analogous flow + distinct `fetchUsers()` init pattern | Two independent conditional warnings in the confirm dialog need separate cases |
| 5. §6.5 cookbook update | Documents the signal-driven pattern for future contributors | None — doc-only |

**Prerequisites:** None — test tooling already shipped in `frontend-test-bootstrap`.
**Estimated effort:** ~2 sessions across 5 phases (4 test-writing phases of similar size + 1 short doc phase).

## Open Risks & Assumptions

- Assumes `MatDatepicker`'s `dateChange` output can be exercised via a direct
  `onFromDateChange`/`onToDateChange` call without needing to actually open the calendar overlay
  — consistent with the confirmed Material-input-driving decision, but worth a first-phase
  sanity check since `admin-panel.ts` is the only component using a datepicker rather than
  `mat-select`.
- Assumes the existing `register.spec.ts`-style `fireEvent.click`/`fireEvent.blur` pattern
  works identically for signal-only components (no `FormGroup` in the mix) — no `FormGroup`
  cast is needed for those particular assertions, only for the Material-overlay ones.

## Success Criteria (Summary)

- `npm run ci` passes with 6 new component spec files, zero regressions.
- Every confirm-dialog delete flow has both its confirm and cancel branches, plus its
  impact-preview failure path, under test.
- `test-plan.md` §6.5 no longer silent about signal-based (no-`FormGroup`) components.
