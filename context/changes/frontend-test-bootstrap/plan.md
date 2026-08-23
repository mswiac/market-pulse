# Frontend Test Bootstrap Implementation Plan

## Overview

Wire up Vitest as the Angular component test runner (via the `@angular/build:unit-test`
experimental builder, `runner: "vitest"`) and write the first component tests in this
repo: Alert Form's custom + cross-field validators and Register's validators + server-error
handling. Both forms exceed the roadmap's "required-only" assumption (test-plan.md §2 risk
#4), and Alert Form in particular has the richest untested surface in the codebase — custom
validators, a dynamic threshold-validator swap, and two reactive cascades wired via
`valueChanges` subscriptions.

## Current State Analysis

- `angular.json` has no `test` architect target. `package.json`'s `"test": "ng test"` script
  currently fails outright — there is no Karma package installed and no test builder
  configured.
- `tsconfig.spec.json` already declares `"types": ["vitest/globals"]` and includes
  `src/**/*.spec.ts"`, but zero `.spec.ts` files exist anywhere under `src/`.
- `@angular/build@22.0.1` ships an `unit-test` builder (`node_modules/@angular/build/src/builders/unit-test/schema.json`)
  whose `runner` option defaults to `"vitest"` (not `"karma"`), confirming the project's
  existing tooling decision (test-plan.md §3 Phase 3 scope notes) is directly supported
  without a config file of our own — `runnerConfig` can stay at its default (`false`).
- No `browsers` option is needed: omitting it runs tests in Node + jsdom, which the builder
  schema documents as the default when `browsers` is absent.
- `zone.js` is not a dependency and nothing in `src/app/app.config.ts` references it — the
  app already runs zoneless, consistent with Angular 22 defaults when zone.js isn't present.
  The `unit-test` builder initializes Angular's TestBed automatically; no zone.js polyfill
  needs adding for tests either.
- `package.json`'s `"ci"` script (`typecheck && test:worker && build`) is what Cloudflare
  Workers Builds runs as a required status check on every PR to `main` (test-plan.md §5) — a
  new step must be added here for the new tests to actually be enforced.
- Alert Form (`src/app/features/alerts/alert-form/alert-form.ts`) injects `FormBuilder`,
  `MatDialogRef<AlertForm>`, `AlertsService`, `AuthService`, `InstrumentsService`, and
  optionally `MAT_DIALOG_DATA`. `MatDialogRef` is injected without `{ optional: true }` — a
  test that omits providing it throws `NullInjectorError` before the component even renders.
- Alert Form's constructor wires three `valueChanges` subscriptions before calling
  `instrumentsService.ensureLoaded()` (`alert-form.ts:86-120`) — the code's own comment notes
  this ordering matters because a warm instruments cache emits synchronously. Tests must
  stub `InstrumentsService` with an already-populated `instruments` signal and an
  `ensureLoaded()` that returns `of([...])` synchronously to exercise this path realistically.
- Register (`src/app/features/auth/register/register.ts`) injects `FormBuilder`,
  `AuthService`, and `Router`. Its 409-conflict path manually calls
  `form.controls.email.setErrors({ server: true })` and `markAsTouched()` — this doesn't
  correspond to a built-in `Validators` error and must be triggered by stubbing
  `AuthService.register()` to return an `HttpErrorResponse`-throwing observable, not by
  filling in the form.
- No `@testing-library/angular` or `@testing-library/dom` package is installed.
  `@testing-library/angular@19.4.2` (latest, verified against the npm registry) declares
  `peerDependencies` of `@angular/core|common|router|platform-browser >= 21.0.0` and
  `@testing-library/dom ^10.0.0` — compatible with this repo's Angular 22.

## Desired End State

`npm run test` (Angular unit tests) and `npm run ci` both succeed locally, running the new
Alert Form and Register component tests in jsdom via Vitest. `npm run ci`'s new test step is
part of what Cloudflare Workers Builds enforces on every PR going forward. Anyone adding a
new Angular component test afterward can follow a documented pattern in
`context/foundation/test-plan.md` §6 instead of reverse-engineering the provider-stubbing
setup from scratch.

### Key Discoveries:

- `@angular/build:unit-test`'s `runner: "vitest"` default removes any need to introduce Karma
  or hand-roll a Vitest config for Angular — confirmed via the installed package's own
  schema, not assumed from documentation.
- `MatDialogRef` injection in `AlertForm` is non-optional (`alert-form.ts:38`) — every Alert
  Form test must supply a stub via `TestBed`/`render()` providers or the component throws
  before rendering.
- The instrumentType→ticker and ticker→alertType cascades (`alert-form.ts:86-99`) only fire
  correctly if `InstrumentsService` stub's `ensureLoaded()` emits *after* those subscriptions
  are wired — which happens naturally since the constructor wires them first — but the stub's
  `instruments`/`types` signals must already reflect the fixture data before render, mirroring
  a "warm cache" real-world case per the code's own ordering comment.
- Register's server-error path is not reachable by any client-side validator combination — it
  requires stubbing `AuthService.register()` to throw an `HttpErrorResponse` with
  `status: 409`.

## What We're NOT Doing

- Not testing any component beyond Alert Form and Register (e.g. Login, Add Instrument, admin
  panel forms) — those are "required-only" per test-plan.md risk #4 evidence and out of scope
  for this phase.
- Not adding snapshot tests — test-plan.md §7 explicitly defers these as low-signal.
- Not configuring `browsers`/headless Chrome — jsdom is sufficient for validator/cascade
  logic and avoids a Chrome dependency in the Cloudflare Workers Builds environment.
- Not updating the `context/foundation/test-plan.md` §3 "Phased Rollout" table's Status/Change
  folder columns — that refresh is owned by `/10x-test-plan --refresh` (§8), not individual
  phase implementations (Phase 2's plan followed the same convention).
- Not adding coverage thresholds or coverage reporting — no existing convention in this repo
  requires it, and it's not part of issue #93's acceptance criteria.
- Not testing `AlertsService`, `AuthService`, or `InstrumentsService` themselves — these are
  plain injectable services with HTTP calls, not components; service-level unit tests are a
  separate, undecided scope.

## Implementation Approach

Phase 1 wires the tooling (builder target, dependencies, CI gate) with no test files yet, so
the "does the runner even work" question is isolated from "are the tests correct." Phases 2
and 3 each add one component's tests using the now-working runner, in order of risk priority
(Alert Form first — it's the named "richest untested surface"). Phase 3 also closes out the
acceptance criterion for a documented cookbook pattern, written from the concrete experience
of two real component tests rather than speculatively before either exists.

## Phase 1: Vitest test runner wiring

### Overview

Add the `test` architect target to `angular.json` using `@angular/build:unit-test`, install
`@testing-library/angular` + `@testing-library/dom` as dev dependencies, and add the new test
step to `npm run ci` so it's enforced by Cloudflare Workers Builds on every PR.

### Changes Required:

#### 1. Angular test target

**File**: `angular.json`

**Intent**: Register a `test` architect target under the `market-pulse` project so
`ng test` (already the `package.json` `test` script) resolves to a working builder instead of
failing with "no test target defined."

**Contract**: Add `"test": { "builder": "@angular/build:unit-test" }` alongside the existing
`build`/`serve` targets under `architect`. No `options` object is needed — the builder infers
`tsConfig` from `tsconfig.spec.json` (present) and `buildTarget` from the project's own
`build` target with the `development` configuration by default, and defaults `runner` to
`"vitest"` with jsdom when `browsers` is unset — all matching this plan's decisions with zero
explicit config.

#### 2. Test dependencies

**File**: `package.json`

**Intent**: Add `@testing-library/angular` and `@testing-library/dom` as dev dependencies so
component tests can use `render()`/accessibility-first queries as decided.

**Contract**: `npm install --save-dev @testing-library/angular @testing-library/dom` (exact
versions resolved by npm at install time; no manual pinning beyond what npm resolves against
the stated peer-dependency compatibility).

#### 3. CI gate

**File**: `package.json`

**Intent**: Make the new Angular tests part of the required Cloudflare Workers Builds status
check, matching how `test:worker` is already enforced.

**Contract**: Change the `"ci"` script from `"typecheck && npm run test:worker && npm run build"`
to insert `npm run test` (Angular tests) between `typecheck` and `test:worker` — i.e.
`"typecheck && npm run test && npm run test:worker && npm run build"`. `ng test` needs no
`--watch=false` flag: the builder's `watch` option already defaults to `false` in non-TTY
environments (CI, and this agent's own non-interactive shell).

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` runs and exits 0 with zero test files discovered (no
  `.spec.ts` files exist yet — this phase only proves the runner itself works)
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — this phase is tooling-only with no user-facing behavior.

---

## Phase 2: Alert Form component tests

### Overview

Cover Alert Form's custom validator, RSI range validator, the threshold-reset-on-alertType-change
cascade, and the two reactive cascades (instrumentType→ticker, ticker→alertType) named as the
"richest untested surface" in test-plan.md risk #4.

### Changes Required:

#### 1. Alert Form spec file

**File**: `src/app/features/alerts/alert-form/alert-form.spec.ts`

**Intent**: Render `AlertForm` via `@testing-library/angular`'s `render()` with stubbed
`AuthService`, `InstrumentsService`, `AlertsService`, `MatDialogRef`, and `MAT_DIALOG_DATA`
providers, then exercise the component's form controls directly (`fixture` component
instance's `form` getter is `protected`, so assertions go through the rendered DOM — e.g.
`mat-error` visibility and `matInput` values — matching how a real user would observe
validation feedback, consistent with `@testing-library/angular`'s DOM-first philosophy).

**Contract**: Provider list must include `{ provide: MatDialogRef, useValue: { close: vi.fn() } }`
(non-optional injection — omitting it throws `NullInjectorError`) and an `InstrumentsService`
stub whose `instruments`/`types` are already-populated signals (not empty), since the
constructor's cascades depend on `instrumentOptions()` returning at least one match. Cover:
`positiveNumberValidator` rejecting `0`/negative price thresholds, `Validators.min(0)`/`max(100)`
rejecting an out-of-range RSI threshold, the threshold control resetting to empty when
`alertType` switches from `PRICE` to `RSI` (and vice versa), the ticker control auto-filling
to the first matching instrument when `instrumentType` changes, and `alertType` resetting to
`PRICE` when a ticker switches to a non-RSI-eligible instrument while `RSI` was selected.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new Alert Form assertions
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- None — component test coverage is fully verified by the automated suite; no separate
  manual UI check adds signal beyond what these tests already assert.

---

## Phase 3: Register component tests + cookbook documentation

### Overview

Cover Register's `required`/`email`/`minLength(8)` validators and its server-side 409
conflict handling, then document the Angular component test pattern in
`context/foundation/test-plan.md` §6 from the concrete pattern used in Phases 2–3.

### Changes Required:

#### 1. Register spec file

**File**: `src/app/features/auth/register/register.spec.ts`

**Intent**: Render `Register` with stubbed `AuthService` and `Router`, covering both
client-side validation (empty/invalid email, short password) and the server-error path where
`AuthService.register()` throws an `HttpErrorResponse` with `status: 409`.

**Contract**: The 409 case must assert the resulting `mat-error` text reflects the
"already registered" message and that the email control carries a manually-set `server`
error — this path is not reachable via the form's own validators, only via a rejecting
`AuthService.register()` stub (see Current State Analysis).

#### 2. Cookbook documentation

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in the "TBD" placeholder for Angular component tests, closing the acceptance
criterion that future component tests have a documented pattern to follow instead of
"see Phase 3."

**Contract**: Add a new `### 6.5 Adding an Angular component test` subsection (after existing
§6.4) describing: colocate `<name>.spec.ts` next to the component (matches
`tsconfig.spec.json`'s `src/**/*.spec.ts` include), render via `@testing-library/angular`'s
`render()` with explicit provider stubs for every injected service/token (including
non-optional tokens like `MatDialogRef`, which throw `NullInjectorError` if omitted), and
assert through the rendered DOM rather than the component instance's protected members. Link
to `alert-form.spec.ts` and `register.spec.ts` as reference examples, mirroring how §6.1
links to `resend.test.ts`/`rsi.test.ts` for Worker tests.

### Success Criteria:

#### Automated Verification:

- `npm run test -- --watch=false` passes, including all new Register assertions
- `npm run ci` passes end-to-end (typecheck, Angular tests, worker tests, build)
- `npm run lint` passes

#### Manual Verification:

- `context/foundation/test-plan.md` §6.5 reads as a usable pattern for a future contributor
  (self-review, not a UI check).

---

## Testing Strategy

### Unit Tests:

- Alert Form: custom validator, RSI range validator, cross-field threshold reset,
  instrumentType→ticker cascade, ticker→alertType cascade.
- Register: required/email/minLength validators, 409 server-error path.

### Integration Tests:

- None — component tests render the real component tree (Angular Material included) via
  TestBed, which is the appropriate layer here; no broader integration harness is needed.

### Manual Testing Steps:

1. None beyond the self-review noted in Phase 3's Manual Verification — this phase's scope is
   fully covered by automated component tests per the Testing Approach decision.

## Performance Considerations

None — jsdom-based component tests run fast and add negligible time to `npm run ci`; no
`browsers`/headless Chrome dependency was introduced (see What We're NOT Doing).

## Migration Notes

Not applicable — no data or schema changes.

## References

- Test plan: `context/foundation/test-plan.md` §2 risk #4, §3 Phase 3 scope notes, §7
- Prior research: `context/archive/2026-08-22-test-plan-refresh-2026-08-22/research.md`
- Worker test cookbook precedent: `context/foundation/test-plan.md` §6.1–§6.4
- GitHub issue: #93

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest test runner wiring

#### Automated

- [x] 1.1 `npm run test -- --watch=false` runner wired correctly — errors only with "No tests found" (expected with zero spec files; the builder has no zero-tests-is-ok mode, unlike the plan's original assumption — full pass verified end-to-end by 2.1 once Phase 2 adds real spec files) — 80fb755
- [x] 1.2 `npm run typecheck` passes — 80fb755
- [x] 1.3 `npm run lint` passes — 80fb755

### Phase 2: Alert Form component tests

#### Automated

- [x] 2.1 `npm run test -- --watch=false` passes, including new Alert Form assertions
- [x] 2.2 `npm run typecheck` passes
- [x] 2.3 `npm run lint` passes

### Phase 3: Register component tests + cookbook documentation

#### Automated

- [ ] 3.1 `npm run test -- --watch=false` passes, including new Register assertions
- [ ] 3.2 `npm run ci` passes end-to-end
- [ ] 3.3 `npm run lint` passes

#### Manual

- [ ] 3.4 `context/foundation/test-plan.md` §6.5 reads as a usable pattern (self-review)
