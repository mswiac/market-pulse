# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard Rules

- Never generate spec files — `skipTests: true` is set globally in `angular.json`.
- Never write to `context/archive/` — archived changes are immutable; abort with "This change is archived" if a target path starts there.
- Destructive production actions (drop DB, rotate secrets, delete a Workers project) are human-only — suggest but do not execute.
- All repository files must be written in English — no Polish in any file content, comments, or documentation. Polish is allowed only in chat responses. **Exception**: user-facing UI strings (labels, buttons, messages, validation text shown in the rendered app — e.g. `.html` template copy) may be written in Polish, since the product's end users are Polish-speaking. Everything else — variable/function/component names, code comments, commit messages, PR titles/bodies, and all other documentation — stays English.

## Project: MarketPulse

Stock market alert web app. Users set price or RSI-based alerts on VIX and NASDAQ-100 indices and receive email notifications when thresholds are crossed. Market data is fetched once daily from Stooq via a cron job; RSI is calculated server-side from recent daily closes.

## Architecture

Split deployment — two separate services:

- **Frontend**: Angular 22 SPA → Cloudflare Pages (`src/`)
- **Backend**: Cloudflare Workers (Hono) + D1 (SQLite) + Cron Triggers + Resend (not yet scaffolded)

Key flows:
1. **Daily cron** (Cloudflare Cron Trigger): fetches closes from Stooq → calculates RSI → evaluates all active alerts → sends email via Resend for each triggered alert → records trigger events in D1.
2. **Alert CRUD**: Angular SPA calls Worker endpoints; D1 is the source of truth.
3. **Auth**: email + password, D1-backed sessions (httpOnly cookie, sliding expiration), flat role model — each user manages only their own alerts.

## Commands

```bash
npm start           # dev server at http://localhost:4200 (live reload)
npm run build       # production build → dist/
npm run watch       # incremental dev build
npm test            # not yet configured — Angular component tests planned via Vitest (test-plan.md §4)
ng generate component path/to/name   # scaffold a component (skipTests is on by default)
```

## Angular Conventions

From `angular.json` schematics config:
- Standalone components — no NgModule.
- Styles: SCSS. File naming: `name.ts` / `name.html` / `name.scss`.

## Formatting

See `@.prettierrc`.

## Mutation testing

Repo uses Stryker (`stryker.config.json`) for selective mutation testing —
currently scoped to `src/worker/**` only, since `src/app/**` (Angular) has no
test coverage yet (see `test-plan.md` §3 Phase 3). Treat this as an
**additional** quality gate, not a stand-in for code coverage. Run it only
for code touched by the current change, or a risk named in
`context/foundation/test-plan.md` — prefer a narrowed `--mutate
"path/to/file.ts"` scope over a full-repo run, and do not chase a 100%
mutation score (`thresholds.break` is `null` on purpose: a low score never
fails CI by itself). Review survived mutants one by one; add an assertion
only when the mutant represents a user-visible or business-relevant bug, not
just to move the score.

**Known gotcha**: `stryker.config.json` sets `vitest.related: false`
deliberately. The runner's default (`related: true`) uses Vitest's static
import-graph analysis to narrow which tests run per mutant — but this
repo's worker tests dispatch through `exports.default.fetch()` from the
`cloudflare:workers` virtual module (see `test/worker/*.test.ts`), not a
direct ES import of the route/handler under test. With `related: true`,
every mutant in `src/worker/routes/**` and several `lib/` files
(`admin.ts`, `email.ts`, `session.ts`) silently reports "no coverage" —
looking untested even though real tests exist and pass. Keep `related:
false` (full suite per mutant, slower but correct) unless this test style
changes.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
