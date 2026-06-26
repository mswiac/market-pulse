# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard Rules

- Never generate spec files — `skipTests: true` is set globally in `angular.json`.
- Never write to `context/archive/` — archived changes are immutable; abort with "This change is archived" if a target path starts there.
- Destructive production actions (drop DB, rotate secrets, delete a Workers project) are human-only — suggest but do not execute.
- All repository files must be written in English — no Polish in any file content, comments, or documentation. Polish is allowed only in chat responses.

## Project: MarketPulse

Stock market alert web app. Users set price or RSI-based alerts on VIX and NASDAQ-100 indices and receive email notifications when thresholds are crossed. Market data is fetched once daily from Stooq via a cron job; RSI is calculated server-side from recent daily closes.

## Architecture

Split deployment — two separate services:

- **Frontend**: Angular 22 SPA → Cloudflare Pages (`src/`)
- **Backend**: Cloudflare Workers (Hono) + D1 (SQLite) + Cron Triggers + Resend (not yet scaffolded)

Key flows:
1. **Daily cron** (Cloudflare Cron Trigger): fetches closes from Stooq → calculates RSI → evaluates all active alerts → sends email via Resend for each triggered alert → records trigger events in D1.
2. **Alert CRUD**: Angular SPA calls Worker endpoints; D1 is the source of truth.
3. **Auth**: username + password, flat role model — each user manages only their own alerts.

## Commands

```bash
npm start           # dev server at http://localhost:4200 (live reload)
npm run build       # production build → dist/
npm run watch       # incremental dev build
npm test            # Karma unit tests
ng generate component path/to/name   # scaffold a component (skipTests is on by default)
```

## Angular Conventions

From `angular.json` schematics config:
- Standalone components — no NgModule.
- Styles: SCSS. File naming: `name.ts` / `name.html` / `name.scss`.

## Formatting

See `@.prettierrc`.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
