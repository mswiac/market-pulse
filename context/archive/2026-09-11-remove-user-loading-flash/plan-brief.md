# Remove User Loading Flash — Plan Brief

> Full plan: `context/changes/remove-user-loading-flash/plan.md`

## What & Why

Fix a UI flash on three admin pages: opening `remove-user`, `remove-instrument`,
or `admin-panel` briefly shows the error/empty-state message (e.g. "No users
available to remove.") before the real content, because none of these
components distinguish "still loading" from "confirmed empty/errored." Add a
`loading` signal to each, gating a new spinner branch ahead of the existing
`loadError`/empty-state/content branches.

## Starting Point

All three components fetch their picker data asynchronously in the
constructor and rely only on a `loadError` boolean signal. `remove-user` owns
its `users` signal directly; `remove-instrument` and `admin-panel` both read
from the shared, caching `InstrumentsService`. No loading-state UI (spinner,
skeleton, or otherwise) exists anywhere in the app today.

## Desired End State

Opening any of the three pages shows a centered spinner while data loads,
then transitions straight to the correct branch — content, load-error, or
empty-state — with no intermediate flash of the wrong branch, verified via
network throttling.

## Key Decisions Made

| Decision                          | Choice                                   | Why (1 sentence)                                                                 | Source |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Scope                               | Fix all 3 components with the identical bug, not just `remove-user` | Research found `admin-panel` and `remove-instrument` share the exact same gap; fixing once now avoids two more follow-up issues. | Plan |
| Loading indicator                   | `mat-progress-spinner`                    | First real UI feedback for async state in this app; standard Material component, no new dependency. | Plan |
| Refetch behavior (post-delete)      | Re-gate through the same `loading` signal every time | Simpler single code path — the fetch method itself owns `loading.set(true)`, no special-casing initial vs. refetch. | Plan |
| Anti-flicker delay                  | None — show/hide immediately              | A brief flash of a neutral loading state is acceptable and much better than the current misleading error/empty flash; a timer adds unwarranted complexity for a LOW-complexity fix. | Plan |

## Scope

**In scope:**
- `remove-user`, `remove-instrument`, `admin-panel` — add `loading` signal + spinner gating
- Adding a missing `error` handler to `remove-instrument`'s post-delete `reload()` call, solely to clear `loading` and avoid a stuck spinner

**Out of scope:**
- A shared/reusable loading component (duplicating spinner markup per component, matching existing `.form-error` duplication convention)
- Minimum-display-time / anti-flicker delay
- Broader error UX for a failed post-delete refetch (toast/message) beyond clearing `loading`
- `alert-list` or any other component outside these three admin pages
- New spec files (project hard rule: `skipTests: true`)

## Architecture / Approach

Each component gets one `protected readonly loading = signal(true)`, cleared
in the `next`/`error` callbacks of whichever subscribe(s) populate its picker
data. `MatProgressSpinnerModule` is added to each component's standalone
`imports`. Templates gain a `@if (loading()) { <spinner> } @else if (...)`
branch ahead of the existing chain — same shape, three times.

## Phases at a Glance

| Phase                                  | What it delivers                                                | Key risk                                                                 |
| --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. `remove-user` (the reported bug)     | Fixes GitHub issue #149 exactly as reported; independently verifiable | Low — mirrors the existing `loadError` idiom closely                        |
| 2. `remove-instrument` + `admin-panel`  | Extends the identical fix to the two other components with the same gap | `remove-instrument`'s `reload()` has no error handler today — must add one to avoid a stuck spinner |

**Prerequisites:** None — no new dependencies, no data/API changes.
**Estimated effort:** ~1 session, 2 phases (6 files total: 2 `.ts`/`.html`/`.scss` triples × ~1.5 components' worth of logic each).

## Open Risks & Assumptions

- Assumes existing spec mocks (`of()`/`throwError()`, synchronous) mean no
  spec files need editing — confirmed by reading all three `.spec.ts` files;
  flagged in the plan as a verification step rather than a blind assumption.
- Manual verification of `remove-instrument`/`admin-panel`'s cold-load flash
  requires bypassing `InstrumentsService`'s warm cache (hard reload on that
  route specifically, not just a throttled in-app navigation).

## Success Criteria (Summary)

- No visible flash of error/empty-state text on any of the three admin pages,
  under throttled network, on first load or after a successful delete.
- `npm run typecheck`, `npm run lint`, `npm run test:ci`, and `npm run build`
  all pass unchanged.
