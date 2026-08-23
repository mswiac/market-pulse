# Frontend Test Bootstrap — Plan Brief

> Full plan: `context/changes/frontend-test-bootstrap/plan.md`

## What & Why

Wire up Vitest as the Angular component test runner and write the first component tests in
the repo: Alert Form's custom + cross-field validators and Register's validators + server-error
handling. Both forms exceed the roadmap's "required-only" assumption about frontend
validation (test-plan.md §2 risk #4), and zero `.spec.ts` files exist anywhere under `src/`
today.

## Starting Point

`angular.json` has no `test` architect target and no Karma package is installed, so
`package.json`'s `"test": "ng test"` script currently fails outright. `tsconfig.spec.json`
already declares `vitest/globals`, and the installed `@angular/build@22.0.1` ships an
experimental `unit-test` builder that defaults to Vitest — the tooling decision (Vitest, not
Karma) is already supported without extra config.

## Desired End State

`npm run test` and `npm run ci` both pass locally, running new Alert Form and Register
component tests in jsdom. The new test step is part of what Cloudflare Workers Builds
enforces on every PR to `main`. A documented pattern in `test-plan.md` §6.5 lets future
contributors add Angular component tests without reverse-engineering the provider-stubbing
setup.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test query API | `@testing-library/angular` | Accessibility-first queries, stylistically consistent with the repo's Playwright e2e tests | Plan |
| Component scope | Alert Form + Register | Both exceed the "required-only" assumption per test-plan.md risk #4 evidence | Plan |
| Alert Form depth | Validators + reactive cascades | Cascades are the "richest untested surface" named in test-plan.md, not just the minimum acceptance criteria | Plan |
| CI gate | Add to `npm run ci` now | Matches how worker tests are already enforced via Cloudflare Workers Builds | Plan |
| Runtime environment | jsdom, no real browser | Fast, no Chrome dependency in the Cloudflare Workers Builds environment; sufficient for validator/cascade logic | Plan |

## Scope

**In scope:**
- `test` architect target in `angular.json` using `@angular/build:unit-test` (Vitest, jsdom)
- `@testing-library/angular` + `@testing-library/dom` dev dependencies
- `npm run ci` updated to run the new Angular tests
- Alert Form tests: custom validator, RSI range, threshold-reset cascade, instrumentType→ticker
  cascade, ticker→alertType cascade
- Register tests: required/email/minLength validators, 409 server-error path
- New `test-plan.md` §6.5 cookbook subsection

**Out of scope:**
- Any component beyond Alert Form and Register (Login, Add Instrument, admin panel forms)
- Snapshot tests (test-plan.md §7 already defers these)
- Headless-Chrome/`browsers` config
- Service-level unit tests (`AlertsService`, `AuthService`, `InstrumentsService`)
- Updating `test-plan.md` §3's rollout Status/Change-folder columns (owned by
  `/10x-test-plan --refresh`)

## Architecture / Approach

Phase 1 proves the runner works in isolation (no test files yet) before any test content is
written, isolating "does the tool work" from "is the test correct." Phases 2–3 each add one
component's tests in risk-priority order, then Phase 3 closes the loop by documenting the
now-proven pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tooling | Working `ng test` via Vitest + CI gate wired | Builder's inferred defaults (tsConfig, buildTarget) don't match repo layout |
| 2. Alert Form tests | Validators + both reactive cascades covered | `MatDialogRef`'s non-optional injection breaks rendering if a provider stub is missed |
| 3. Register tests + docs | Validators + 409 path covered; §6.5 written | 409 path isn't reachable via form validation alone — needs a stubbed service rejection |

**Prerequisites:** None — pure addition, no dependency on Phase 2 (multi-provider-admin-delete-integrity).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- `@testing-library/angular@19.4.2`'s peer dependency range (`>= 21.0.0`) covers this repo's
  Angular 22, verified against the npm registry at plan time — not yet verified by an actual
  `npm install`.
- The `unit-test` builder is explicitly labeled `[EXPERIMENTAL]` by Angular — acceptable per
  the user's own tooling decision, but future Angular upgrades could change its defaults.

## Success Criteria (Summary)

- `npm run ci` passes end-to-end, including the new Angular test step
- Alert Form's and Register's validators/cascades are protected against silent regression
- A future contributor can add a new Angular component test by following `test-plan.md` §6.5
