# Remove User Loading Flash Implementation Plan

## Overview

Three admin pages (`remove-user`, `remove-instrument`, `admin-panel`) fetch their
picker data asynchronously in the constructor but have no distinct "loading"
state — only a `loadError` signal. Until the fetch resolves, the empty/default
data makes the template render its error or empty-state branch, producing a
visible flash before real content appears (reported for `remove-user` in
GitHub issue #149). This plan adds a `loading` signal to all three components,
gated by a new `@if (loading())` branch rendering a Material spinner ahead of
the existing `loadError`/empty-state/content branches.

## Current State Analysis

- `remove-user/remove-user.ts:35,39-40,96-105` — owns `users = signal<AdminUser[]>([])`
  and `loadError = signal(false)`; `fetchUsers()` runs from the constructor and
  again after a successful delete (`remove-user.ts:86`). `noUsers` is
  `computed(() => users().length === 0)`, true until the fetch resolves.
- `remove-instrument/remove-instrument.ts:50-51,55-60,106-118` — same shape,
  but the data source is the shared `InstrumentsService`
  (`instruments.service.ts`), not a component-owned signal. Constructor calls
  `ensureLoaded()`; a successful delete calls `reload()`
  (`remove-instrument.ts:110`) with **no error handler at all** today.
- `admin-panel/admin-panel.ts:67,73-81` — same `loadError`-only pattern via
  `InstrumentsService.ensureLoaded()`, but has no empty-state branch (only
  `loadError` vs. content) and no refetch-after-submit call.
- `InstrumentsService` (`instruments.service.ts:21-44`) caches after first
  load (`loaded` flag) and dedupes concurrent callers (`inFlight`). On a
  cache hit, `ensureLoaded()` returns `of(this._instruments())`, which
  resolves synchronously — so a per-component `loading` signal only stays
  `true` across a real network round trip, never on a warm cache.
- No loading-state UI convention exists anywhere in the app today (confirmed:
  no `mat-progress-spinner`, no skeletons, no shared "loading" component). The
  three components duplicate a `.form-error` SCSS block identically rather
  than sharing a partial — the established convention here is per-component
  duplication, not shared abstractions.
- Existing spec files (`remove-user.spec.ts`, `remove-instrument.spec.ts`,
  `admin-panel.spec.ts`) mock the service calls with synchronous `of()` /
  `throwError()` — never `delay()` or a manually-driven `Subject` for the
  *load* calls (`Subject` is only used for the impact/delete flow). Adding a
  `loading` signal that flips synchronously inside the same `next`/`error`
  callback will not leave it stuck `true` when these tests run, so no spec
  changes are expected.

## Desired End State

Opening any of the three admin pages shows a centered `mat-progress-spinner`
while the initial fetch is in flight, then transitions directly to the
correct branch (content, load-error, or empty-state) once it resolves — never
briefly showing the error/empty-state text before real data arrives. Verified
by: throttling the network in devtools, hard-loading each of the three admin
routes, and confirming the spinner appears first with no error/empty-text
flash before or after it.

### Key Discoveries:

- `remove-user.ts:96-105` `fetchUsers()` is the single call site invoked both
  from the constructor and after a successful delete — putting
  `loading.set(true)` at the top of that method (not at each call site) makes
  every invocation re-gate through the spinner automatically, per the chosen
  "same gate every time" behavior.
- `remove-instrument.ts:106-118` `removeInstrument()`'s `reload()` subscribe
  has no `error` callback — adding the loading gate here requires adding one
  (see Critical Implementation Details) purely to avoid a stuck spinner.
- `admin-panel.ts` has no refetch call site at all — only the constructor's
  `ensureLoaded()` needs gating.

## What We're NOT Doing

- Not building a shared/reusable loading component — duplicating the spinner
  markup and a small `.loading` SCSS block per component, matching this
  feature's existing duplication convention (`.form-error` is already
  triplicated verbatim).
- Not adding a minimum-display-time / anti-flicker delay before showing the
  loading state — decided against; the loading state itself is allowed to
  flash briefly on a fast response, since that's a neutral state rather than
  the misleading error/empty text this plan fixes.
- Not expanding `InstrumentsService.reload()`'s error handling beyond what's
  needed to clear the new `loading` signal — no new toast/error UX for a
  failed refetch; that's a pre-existing gap out of scope here.
- Not touching `alert-list.ts` or any other component outside the three admin
  pages, even though it shares the same `loadError`-only shape.
- Not writing new spec files (`skipTests: true`, project hard rule). Existing
  specs are expected to keep passing unchanged (see Current State Analysis);
  if verification proves otherwise, fix the existing spec's assertions, don't
  add new files.

## Implementation Approach

Add one `protected readonly loading = signal(true)` per component, cleared in
both the `next` and `error` callbacks of whichever subscribe(s) populate that
component's picker data. Add `MatProgressSpinnerModule` to each component's
standalone `imports`. In each template, add a `@if (loading()) { ... }` branch
ahead of the existing `loadError`/empty-state/content chain. Apply the same
three-file change (`.ts` + `.html` + `.scss`) identically across all three
components.

## Critical Implementation Details

**State sequencing**: `loading.set(true)` must live inside the shared private
method that performs the fetch (`fetchUsers()` for `remove-user`), not only
at its call sites — this is what makes a post-delete refetch re-show the
spinner without extra call-site code, matching the "same gate every time"
decision. For `remove-instrument`, this means wrapping the `reload()` call
in `removeInstrument()` (`remove-instrument.ts:106-118`) with the same
`loading.set(true)` / clear-on-next-or-error pattern as the constructor's
`ensureLoaded()` call, even though today only the constructor call is gated
by anything.

**Missing error handler on `reload()`**: `remove-instrument.ts:110`'s
`this.instrumentsService.reload().subscribe({ next: () => this.resetPickerToFirst() })`
has no `error` callback today. Once `loading.set(true)` is added before this
call, an `error` callback that clears `loading` is required — otherwise a
failed refetch leaves the page stuck on the spinner forever, which is worse
than the flash this plan fixes. Keep this addition minimal (just clear
`loading`); don't add new error messaging beyond that.

**Accessibility**: a bare `<mat-progress-spinner>` has no accessible name.
Add an `i18n`-tagged `aria-label` (e.g. `@@removeUser.loading.ariaLabel`) on
each of the three spinner instances, with an English source string per this
codebase's existing i18n convention (all other user-facing strings use
`i18n`/`$localize` with English source text, not hardcoded Polish).

**i18n translation entries (build-blocking)**: `angular.json`'s `build`
target defaults to the `production` configuration, which sets
`localize: ["pl"]` and `i18nMissingTranslation: "error"` — so `npm run build`
(listed as Automated Verification in both phases) hard-fails on any `i18n` id
without a matching `<trans-unit>` in `src/locale/messages.pl.xlf`. For each of
the three new `aria-label` i18n ids, manually add a `<trans-unit id="...">`
entry to `src/locale/messages.pl.xlf` with a Polish `<target>`, following the
exact pattern of existing entries there (e.g. `removeUser.noUsers`). Do this
directly in `messages.pl.xlf`, not via `npm run extract-i18n` — that command
only regenerates the source-locale `src/locale/messages.xlf`, which this repo
does not keep in sync with `messages.pl.xlf` (264 vs. 374 trans-units today)
and does not gate the build.

## Phase 1: `remove-user` (the reported bug)

### Overview

Adds the `loading` signal and spinner gating to `remove-user`, the component
named in GitHub issue #149. This phase alone fixes the originally reported
flash and is independently verifiable against the issue's repro steps before
the same pattern is extended to the other two components.

### Changes Required:

#### 1. Loading signal and gating

**File**: `src/app/features/admin/remove-user/remove-user.ts`

**Intent**: Track whether the initial (or a post-delete re-) fetch of the user
list is in flight, so the template can show a spinner instead of falling
through to the error/empty-state branches while data is unknown.

**Contract**: Add `protected readonly loading = signal(true);` alongside the
existing `loadError` signal. Import `MatProgressSpinnerModule` from
`@angular/material/progress-spinner` and add it to the component's `imports`
array. In `fetchUsers()` (`remove-user.ts:96-105`), set `this.loading.set(true)`
at the top of the method, and add `this.loading.set(false)` to both the
`next` and `error` callbacks (alongside the existing logic in each).

#### 2. Template gating

**File**: `src/app/features/admin/remove-user/remove-user.html`

**Intent**: Render the spinner before the existing branches while loading is
true, leaving the `loadError` / `noUsers` / content branches unchanged
otherwise.

**Contract**: Add a `@if (loading()) { ... }` branch as the first branch of
the existing `@if (loadError()) { ... } @else if (noUsers()) { ... } @else { ... }`
chain (making it `@if (loading()) { ... } @else if (loadError()) { ... } @else if (noUsers()) { ... } @else { ... }`).
The loading branch renders a `<mat-progress-spinner>` with an i18n `aria-label`
(see Critical Implementation Details), wrapped in a `<div class="loading">`.
Add the corresponding `<trans-unit>` to `src/locale/messages.pl.xlf` (see
"i18n translation entries" in Critical Implementation Details) before relying
on `npm run build` to pass.

#### 3. Loading state styling

**File**: `src/app/features/admin/remove-user/remove-user.scss`

**Intent**: Center the spinner within the page, consistent with the visual
weight of the card it replaces.

**Contract**: Add a `.loading` rule: flex container, centered content,
vertical padding — mirroring the existing `.form-error` block's role as a
self-contained, non-shared style block in this file.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Existing spec suite still passes unchanged: `npm run test:ci`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With network throttled (devtools), hard-load the Remove user admin page:
  spinner appears first, then the user picker — no flash of "No users
  available to remove." at any point.
- Remove a user successfully: the list re-fetch also shows the spinner
  (not a flash of the empty/error state) before the picker reappears with
  the updated list.
- Simulate a load failure (e.g. block the `/api/admin/users` request):
  spinner appears, then the "Failed to load users…" message — no flash of
  "No users available to remove." in between.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: `remove-instrument` and `admin-panel`

### Overview

Applies the identical `loading`-signal + spinner-gating pattern to the other
two admin components that share the same underlying bug shape, sourcing their
picker data from the shared `InstrumentsService` instead of a component-owned
signal.

### Changes Required:

#### 1. `admin-panel` loading signal and gating

**File**: `src/app/features/admin/admin-panel.ts`

**Intent**: Same as Phase 1 item 1, applied to `admin-panel`'s single fetch
call site (the constructor's `ensureLoaded()` subscribe — there is no
refetch-after-submit call in this component).

**Contract**: Add `protected readonly loading = signal(true);`, import
`MatProgressSpinnerModule` into `imports`. In the constructor's
`ensureLoaded()` subscribe (`admin-panel.ts:74-80`), add
`this.loading.set(false)` to both the `next` and `error` callbacks.

#### 2. `admin-panel` template gating

**File**: `src/app/features/admin/admin-panel.html`

**Intent**: Same as Phase 1 item 2, adapted to this component's two-branch
structure (no empty-state branch exists here).

**Contract**: Change `@if (loadError()) { ... } @else { ... }` to
`@if (loading()) { ... } @else if (loadError()) { ... } @else { ... }`, with
the same spinner + `aria-label` markup as Phase 1. Add the corresponding
`<trans-unit>` to `src/locale/messages.pl.xlf` (see "i18n translation
entries" in Critical Implementation Details).

#### 3. `admin-panel` loading state styling

**File**: `src/app/features/admin/admin-panel.scss`

**Intent**: Same as Phase 1 item 3.

**Contract**: Add the same `.loading` rule as `remove-user.scss`.

#### 4. `remove-instrument` loading signal and gating

**File**: `src/app/features/admin/remove-instrument/remove-instrument.ts`

**Intent**: Same as Phase 1 item 1, applied to both of this component's fetch
call sites — the constructor's `ensureLoaded()` and the post-delete
`reload()` in `removeInstrument()` — per the "State sequencing" and "Missing
error handler" notes above.

**Contract**: Add `protected readonly loading = signal(true);`, import
`MatProgressSpinnerModule` into `imports`. In the constructor's
`ensureLoaded()` subscribe (`remove-instrument.ts:56-59`), add
`this.loading.set(false)` to both `next` and `error`. In `removeInstrument()`
(`remove-instrument.ts:106-118`), set `this.loading.set(true)` before calling
`this.instrumentsService.reload()`, and add `this.loading.set(false)` to both
the `next` callback and a new `error` callback on that subscribe (the `error`
callback does nothing else — see Critical Implementation Details).

#### 5. `remove-instrument` template gating

**File**: `src/app/features/admin/remove-instrument/remove-instrument.html`

**Intent**: Same as Phase 1 item 2.

**Contract**: Add `@if (loading()) { ... }` as the first branch ahead of the
existing `loadError()` / `noInstruments()` / content chain, with the same
spinner + `aria-label` markup. Add the corresponding `<trans-unit>` to
`src/locale/messages.pl.xlf` (see "i18n translation entries" in Critical
Implementation Details).

#### 6. `remove-instrument` loading state styling

**File**: `src/app/features/admin/remove-instrument/remove-instrument.scss`

**Intent**: Same as Phase 1 item 3.

**Contract**: Add the same `.loading` rule as `remove-user.scss`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Existing spec suite still passes unchanged: `npm run test:ci`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With network throttled and a hard page load (to bypass `InstrumentsService`'s
  warm cache from a prior navigation), open Fetch market data and Remove
  instrument in turn: spinner appears first on each, then the real form — no
  flash of the load-error text.
- On Remove instrument, remove an instrument successfully: the refetch also
  shows the spinner before the picker reappears with the updated list.
- Code-review (not necessarily exercisable via the UI) the new `reload()`
  error callback: confirm it clears `loading` so a failed refetch cannot
  leave the page stuck on the spinner.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None added — `skipTests: true` is a hard project rule. Existing specs for
  all three components are expected to keep passing unmodified, since their
  service mocks resolve synchronously (see Current State Analysis).

### Integration Tests:

- Not applicable — no E2E risk here per the 10x-e2e trigger criteria (this is
  a synchronous rendering-state fix, not a new user-facing flow).

### Manual Testing Steps:

1. Throttle network (Slow 3G) in devtools.
2. Hard-reload each of `/admin` (market data), remove-instrument, and
   remove-user routes; confirm spinner → correct branch, no error/empty flash.
3. On remove-user and remove-instrument, perform a successful delete and
   confirm the refetch also gates through the spinner smoothly.
4. Block the relevant API call (devtools request blocking) for each of the
   three pages and confirm spinner → load-error message, no empty-state flash.

## Performance Considerations

None — a single boolean signal and a conditionally-rendered spinner add
negligible overhead.

## Migration Notes

Not applicable — no data model or API changes.

## References

- GitHub issue: #149
- Change notes: `context/changes/remove-user-loading-flash/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `remove-user` (the reported bug)

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Existing spec suite still passes unchanged: `npm run test:ci`
- [x] 1.4 Production build succeeds: `npm run build`

#### Manual

- [x] 1.5 Throttled hard-load of Remove user shows spinner then picker, no empty-state flash
- [x] 1.6 Post-delete refetch shows spinner, not a flash of the empty/error state
- [x] 1.7 Simulated load failure shows spinner then load-error message, no empty-state flash

### Phase 2: `remove-instrument` and `admin-panel`

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Existing spec suite still passes unchanged: `npm run test:ci`
- [x] 2.4 Production build succeeds: `npm run build`

#### Manual

- [x] 2.5 Throttled hard-load of Fetch market data and Remove instrument shows spinner then form, no error-text flash
- [x] 2.6 Remove instrument post-delete refetch shows spinner before picker reappears
- [x] 2.7 Code review confirms `reload()`'s new error callback clears `loading`
