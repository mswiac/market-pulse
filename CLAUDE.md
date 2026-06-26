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

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
