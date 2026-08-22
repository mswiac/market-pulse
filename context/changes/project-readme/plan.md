# Project README Implementation Plan

## Overview

The repo root has an empty `README.md` (0 bytes). This plan fills it in with the operational knowledge that today only lives in the maintainer's head, `wrangler.toml`, `package.json`, and the Cloudflare dashboard — closing GitHub issue #80: running the app locally, deploying via Cloudflare, and the CI quality gate that guards `main`.

## Current State Analysis

- `README.md` exists at the repo root but is empty — this is a fill-in, not a new-file creation.
- `context/changes/test-plan-refresh-2026-08-22/research.md` already independently verified the facts this README needs to state: the exact build/deploy/version commands Cloudflare Workers Builds runs, the required branch-protection status check name, and that D1 migrations are not auto-applied on deploy. No fresh codebase research was needed for this change.
- `package.json`'s `test` script (`ng test`) is stale and currently non-functional: no Karma/Jasmine package exists in `package.json`, `angular.json`'s `architect` block has no `test` target, and `tsconfig.spec.json` already declares `vitest/globals`. Running it today fails outright.
- `angular.json` defines a `development-pl` build configuration (`localize: ["pl"]`) that `npm start` uses by default — relevant context for "running locally" that isn't mentioned in issue #80.
- Local secrets are read from a gitignored local env file at the repo root (Wrangler's standard local-vars mechanism); `.gitignore` already references it by name.

### Key Discoveries:

- `package.json:9` — `"test": "ng test"` is currently broken; do not document it as a working command (per user decision below).
- `package.json:4-18` — `ci` composite script (`typecheck && test:worker && build`) is the exact command Cloudflare Workers Builds runs on every PR to `main`.
- `wrangler.toml:1-19` — `name = "marketpulse"`, D1 binding `DB` → `marketpulse-db`, single daily cron trigger, assets served from `dist/market-pulse/browser/pl`.
- `angular.json` — `development-pl` config is what `npm start` invokes (`ng serve --configuration development-pl`); output is Polish-localized.
- `migrations/` — 15 sequential numbered SQL files; `npm run migrate:local` / `npm run migrate:remote` apply them (remote is a separate, manual step — never automatic on deploy, per project memory).
- `context/changes/test-plan-refresh-2026-08-22/research.md:112-129` — verified branch protection JSON showing the required status check `"Workers Builds: marketpulse"` (app_id 85455), and the confirmed build/deploy/version commands.

## Desired End State

`README.md` at the repo root reads as a single, self-contained onboarding document: what MarketPulse is, how to run it locally end-to-end (Angular dev server + Worker + local D1), how Cloudflare deployment and the `main`-branch quality gate actually work, and where to find the `context/` change-tracking structure and the `test/worker/` test suite — without needing to re-derive any of this from `wrangler.toml`, `package.json`, or the Cloudflare dashboard.

Verification: read `README.md` top to bottom as a new contributor would; every command in it should be copy-pasteable and correct as of this repo's current state.

## What We're NOT Doing

- Not fixing the broken `npm test` / Karma-vs-Vitest tooling gap — that's Phase 3 scope in `context/changes/test-plan-refresh-2026-08-22/plan.md`. This README documents around it (only working commands), it doesn't resolve it.
- Not editing `CLAUDE.md`'s Commands section (which still claims Karma) — that correction is already scoped into `test-plan-refresh-2026-08-22`'s Phase 1; touching it here risks a duplicate/conflicting edit across two branches.
- Not adding a CONTRIBUTING.md, LICENSE, or other repo-hygiene files — out of scope for issue #80.
- Not documenting Angular/Wrangler/D1 concepts in general — the README assumes basic familiarity with those tools and documents only this project's specific setup and conventions.

## Implementation Approach

Single-phase documentation edit. Write `README.md` directly against the verified facts above; every claim traces either to a file in this repo (`package.json`, `wrangler.toml`, `angular.json`, `migrations/`) or to `test-plan-refresh-2026-08-22/research.md`'s CI-gate finding.

## Phase 1: Write README.md

### Overview

Replace the empty `README.md` with a complete document covering project overview, local development, Cloudflare deployment, the CI quality gate, and pointers to `context/` and `test/worker/`.

### Changes Required:

#### 1. Project overview

**File**: `README.md`

**Intent**: Open with 2-3 sentences orienting a new reader: what MarketPulse is (stock market alert web app; price/RSI alerts on VIX and NASDAQ-100; email notifications via a daily cron job), sourced from the project description already in `CLAUDE.md`.

**Contract**: A `# MarketPulse` top-level heading followed by a short paragraph. No code blocks needed.

#### 2. Running locally

**File**: `README.md`

**Intent**: Full walkthrough (per user decision) covering the split-deployment nature of the app (Angular SPA + separate Worker are two independent local dev servers), required local setup, and every command needed to get both halves running against local D1.

**Contract**: A `## Running locally` section, ordered as prerequisites → setup → run. Must include, each with 1-2 sentences of context plus the exact command:
- Prerequisite: Node version (from `.nvmrc`), `npm install`.
- Local secrets: create the gitignored local env file the project reads Wrangler bindings/secrets from at the repo root (name it explicitly — Wrangler's standard `.dev.vars` convention — since a new contributor needs the exact filename to create; do not include any actual secret values).
- Local D1: `npm run migrate:local` to apply all `migrations/*.sql` against local D1, with a one-line note that this must be re-run whenever a new migration file is added.
- Two dev servers explained as independent: `npm start` (Angular dev server at `http://localhost:4200`, Polish-localized build via the `development-pl` configuration) and `npm run worker:dev` (`wrangler dev --local`, the Hono API + D1), with a one-line note on why both are needed together (`proxy.conf.json` routes `/api` calls from the Angular dev server to the local Worker — verify this file's actual routing target before stating it, don't assume).
- `npm run typecheck` and `npm run test:worker` as the two verifiable local checks a contributor can run before pushing (explicitly note `npm test` is not currently functional — no caveat-free mention of it).

#### 3. Cloudflare deployment

**File**: `README.md`

**Intent**: Document that deployment happens via Cloudflare Workers Builds (a GitHub-App-based, dashboard-configured mechanism — not GitHub Actions), state the exact build/deploy/version commands, and flag that D1 migrations are a separate manual step.

**Contract**: A `## Deployment` section stating: build command `npm run ci`, deploy command `npx wrangler deploy`, version command `npx wrangler version upload`; a callout that `wrangler.toml`'s `[assets]`/`[[d1_databases]]`/`[triggers]` config is what ships; and an explicit warning that `npm run migrate:remote` must be run by hand after a migration-adding deploy — it is never automatic.

#### 4. CI / quality gate

**File**: `README.md`

**Intent**: Make the Cloudflare-Workers-Builds branch-protection gate discoverable from the repo itself, per issue #80's stated goal, so it doesn't need re-deriving via `gh api .../branches/main/protection` again.

**Contract**: A `## CI / quality gate` section stating: `main` has a required GitHub branch-protection status check named `Workers Builds: marketpulse`, which runs the `npm run ci` build command (`typecheck && test:worker && build`) on every PR before merge is allowed; this is configured in the Cloudflare dashboard, not as a `.github/workflows/*.yml` file, which is why it doesn't show up in a repo-only search.

#### 5. Project structure pointers

**File**: `README.md`

**Intent**: Give a contributor (human or agent) a fast orientation to the two directories that aren't self-evident from a standard Angular+Workers layout.

**Contract**: A short `## Project structure notes` (or similar) section pointing to: `context/` (the 10x-* change-tracking structure — changes, foundation docs, archive) and `test/worker/` (Vitest + `@cloudflare/vitest-pool-workers` backend test suite, run via `npm run test:worker`).

### Success Criteria:

#### Automated Verification:

- `README.md` is non-empty and contains all required section headings: `wc -l README.md` and `grep -c '^##' README.md` (expect 5 `##` sections plus the top-level title)
- No literal secret values appear in the file: `grep -iE '(api_key|password|secret)\s*=' README.md` returns nothing
- Every command mentioned in the README exists as a script in `package.json` or is a real `wrangler`/`npm` invocation: cross-check each fenced command against `package.json`'s `scripts` block

#### Manual Verification:

- Read `README.md` top to bottom as a new contributor would; confirm every command is copy-pasteable and matches current repo state
- Confirm the `proxy.conf.json` routing claim (Angular dev server → local Worker) is accurate before it ships, by reading `proxy.conf.json`
- Confirm no `npm test` (Karma) claim slipped in anywhere in the document

**Implementation Note**: After completing this phase and automated verification passes, pause here for manual confirmation from the human that the manual read-through was successful.

## Testing Strategy

N/A — documentation-only change, no automated tests apply. Verification is the Success Criteria above (grep-based content checks + manual read-through).

## References

- Source issue: GitHub #80 ("Add README: local dev, Cloudflare deployment, and CI quality gate")
- CI-gate grounding: `context/changes/test-plan-refresh-2026-08-22/research.md` (`### CI / Quality gate wiring` section)
- `package.json`, `wrangler.toml`, `angular.json`, `migrations/` — verified directly during planning

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Write README.md

#### Automated

- [x] 1.1 README.md is non-empty and contains all required section headings
- [x] 1.2 No literal secret values appear in the file
- [x] 1.3 Every command mentioned exists as a real script/invocation

#### Manual

- [ ] 1.4 Full read-through as a new contributor would, confirming commands are accurate
- [ ] 1.5 Confirm the proxy.conf.json routing claim before it ships
- [ ] 1.6 Confirm no stale npm test (Karma) claim slipped in
