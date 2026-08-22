# Project README — Plan Brief

> Full plan: `context/changes/project-readme/plan.md`

## What & Why

The repo root's `README.md` is empty (0 bytes). Local dev setup, Cloudflare deployment mechanics, and the `main`-branch CI quality gate currently live only in the maintainer's head, `wrangler.toml`, `package.json`, and the Cloudflare dashboard — the last of these isn't even discoverable from repo files, as a prior research pass on this project (`test-plan-refresh-2026-08-22`) confirmed the hard way. This closes GitHub issue #80 by writing that knowledge down once.

## Starting Point

`README.md` exists but is empty. All the facts needed to fill it in are already verified: `context/changes/test-plan-refresh-2026-08-22/research.md` confirmed the exact Cloudflare Workers Builds commands and the required branch-protection status check name, and this planning session directly verified `package.json`, `wrangler.toml`, `angular.json`, `migrations/`, and `proxy.conf.json`.

## Desired End State

A single self-contained `README.md`: what MarketPulse is, a full walkthrough for running the Angular SPA + Worker + local D1 together, how Cloudflare deployment and its required quality gate actually work, and pointers to `context/` and `test/worker/` — accurate enough that no one needs to re-derive any of this again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| `npm test` (broken Karma script) | Document only working commands (`npm run test:worker`); note frontend tests aren't set up yet | Documenting a command that fails today would make the README inaccurate | Plan |
| Local setup depth | Full walkthrough, not a bare command list | User chose the more thorough option over the recommended quick-reference | Plan |
| Project overview section | Include 2-3 sentences on what MarketPulse is, before setup instructions | Standard README shape; gives a reader context before commands | Plan |
| CLAUDE.md's stale Karma claim | Not touched here | Already scoped into `test-plan-refresh-2026-08-22`'s Phase 1; avoids a duplicate edit across two branches | Plan |
| `npm test` tooling gap itself | Not fixed here | Out of scope for a documentation issue; belongs to `test-plan-refresh-2026-08-22` Phase 3 | Plan |

## Scope

**In scope:**
- Filling in the empty root `README.md`: overview, local dev (full walkthrough), Cloudflare deployment, CI/quality gate, pointers to `context/` and `test/worker/`

**Out of scope:**
- Fixing the `npm test` / Karma-vs-Vitest tooling gap
- Editing `CLAUDE.md`
- CONTRIBUTING.md, LICENSE, or other repo-hygiene files
- General Angular/Wrangler/D1 tutorials — only this project's specific setup

## Architecture / Approach

Single-phase documentation edit. Every claim in the README traces to a file already in the repo (`package.json`, `wrangler.toml`, `angular.json`, `migrations/`, `proxy.conf.json`) or to the CI-gate finding already grounded in `test-plan-refresh-2026-08-22/research.md`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Write README.md | Complete, accurate root README (5 sections) | A command or claim goes stale by the time it's read — mitigated by verifying every command against `package.json`/config files directly during planning |

**Prerequisites:** None — all facts already verified.
**Estimated effort:** ~1 session, single phase — documentation edit, not code.

## Open Risks & Assumptions

- If `proxy.conf.json`'s target port or `wrangler dev`'s default port ever changes, the "why both dev servers are needed together" explanation will need a follow-up edit — not automatically caught by any test.

## Success Criteria (Summary)

- `README.md` is non-empty, has all 5 required sections, and every command in it is real and copy-pasteable
- No `npm test` (Karma) claim appears anywhere in the document
- A new contributor (human or agent) can go from clone to running app using only the README
