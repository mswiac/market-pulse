# Backend Scaffold — Plan Brief

> Full plan: `context/changes/backend-scaffold/plan.md`

## What & Why

Wire the minimum backend needed to unblock all downstream slices: a Hono Worker entry point bound to D1, served alongside the existing Angular SPA on Cloudflare Workers. Without this, neither auth (S-01) nor the market data pipeline (F-02) can start — there is no HTTP layer and no database.

## Starting Point

The repo has an Angular SPA deploying via Cloudflare Workers Assets (`wrangler.toml` serves `./dist/market-pulse/browser`). There is no `main` Worker entry, no D1 binding, no `nodejs_compat` flag, and no `migrations/` directory. Hono and Wrangler are absent from `package.json`.

## Desired End State

`GET /health` on the live Cloudflare URL returns `{"ok":true}`. The `users` table exists in both local and remote D1. `npm run deploy` builds Angular and deploys the Worker in one command. `npm run worker:dev` starts a local Worker for fast iteration.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Worker source location | `src/worker/index.ts` | Colocation with frontend TypeScript; exclusion from Angular build handled via tsconfig.app.json |
| D1 query strategy | Raw SQL (no ORM) | F-01 has one table; ORM adds tooling overhead with no payoff at this scale |
| Health check response | `{ ok: true }` only | Zero D1 dependency — health route cannot fail due to a database issue |
| Local dev | `wrangler dev --local` | Included in F-01 scope; gives fast local iteration without requiring a deploy |
| Deploy command | `npm run deploy` → `ng build && wrangler deploy` | One command to prevent forgotten Angular rebuild before Worker push |
| `nodejs_compat` flag | Added now in wrangler.toml | Resend SDK (S-05) requires it; adding late risks a broken deploy mid-stream |
| Users table scope | Minimal: id, username, password_hash, notification_email, created_at | Exactly what S-01 needs; extensions land in forward-only migrations |

## Scope

**In scope:** `package.json` (hono, wrangler, workers-types deps + 4 scripts), `wrangler.toml` (main, D1 binding, nodejs_compat), `tsconfig.app.json` (Worker exclusion), `tsconfig.worker.json` (new), `src/worker/index.ts` (Hono + health route), `migrations/0001_create_users.sql`

**Out of scope:** ORM, auth endpoints, cron trigger, Angular route changes, unified `ng serve` + `wrangler dev` proxy

## Architecture / Approach

Wrangler Workers Assets serves static Angular files for matched paths; all unmatched requests (e.g., `/health`, future `/api/*`) pass through to the Hono Worker fetch handler. Local D1 (via `wrangler dev --local`) and remote D1 (via binding) share the same migration file. TypeScript compilation is split: Angular uses `tsconfig.app.json`, Worker uses `tsconfig.worker.json` — both extend the root config.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Configuration | Toolchain ready: deps installed, wrangler.toml wired, tsconfigs split | `tsconfig.app.json` exclusion missing → `ng build` breaks |
| 2. Worker entry point | `src/worker/index.ts` passes type check; `wrangler dev --local` serves GET /health | `module: "preserve"` from root tsconfig leaks into worker tsconfig |
| 3. D1 migration | `users` table in local and remote D1; `npm run deploy` succeeds | Placeholder `database_id` still in wrangler.toml → remote ops fail |

**Prerequisites:** Wrangler CLI installed globally or available via `npx`; Cloudflare account with Workers enabled; `wrangler login` authenticated  
**Estimated effort:** ~1 session across 3 phases; Phase 1 manual gate (D1 create) is the only human-blocking step

## Open Risks & Assumptions

- Placeholder `database_id = "REPLACE_WITH_DATABASE_ID"` in `wrangler.toml` must be filled in before Phase 2 remote verification and Phase 3 migration apply
- `wrangler dev --local` behavior for Workers Assets (serving Angular dist alongside Worker) depends on Angular dist being built first (`npm run build`) — running `wrangler dev --local` without a prior build will serve 404 for the SPA but Worker routes will still respond

## Success Criteria (Summary)

- `GET /health` on live Cloudflare URL returns `{"ok":true}` HTTP 200
- `users` table exists in remote D1 (`wrangler d1 execute marketpulse-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` returns `users`)
- `npm run deploy` exits 0 from a clean checkout after `wrangler d1 create` is done
