# Backend Scaffold Implementation Plan

## Overview

Wire the Hono Worker entry point, D1 database binding, and `users` table migration. This is F-01 — the foundation that unlocks S-01 (auth) and F-02 (market data pipeline). Scope is deliberately minimal: one health-check route, one table, zero business logic.

## Current State Analysis

- `wrangler.toml`: serves Angular SPA static assets only — no `main` field, no `[[d1_databases]]`, no `nodejs_compat` flag
- `package.json`: Angular-only — no Hono, no Wrangler, no Workers types
- No `src/worker/` directory or any Worker source file
- No `migrations/` directory
- `tsconfig.app.json:9` includes `src/**/*.ts` — Worker source needs explicit exclusion or Angular compiler will break

## Desired End State

After this plan completes:
- `GET /health` on the live Cloudflare URL returns `{ "ok": true }` with HTTP 200
- The `users` table exists in both local (wrangler dev) and remote D1
- `npm run worker:dev` starts a local Worker that responds to `GET /health`
- `npm run deploy` builds the Angular SPA and deploys the Worker in one command
- All downstream slices (S-01, F-02) can start — HTTP layer and `users` schema are in place

### Key Discoveries

- `tsconfig.app.json:9` — `include: ["src/**/*.ts"]` captures `src/worker/`; must add exclusion or `ng build` will fail on Workers-only globals (`D1Database`, etc.)
- `wrangler.toml` — three additions required: `main`, `compatibility_flags = ["nodejs_compat"]`, `[[d1_databases]]`
- `tsconfig.json:15` — root uses `module: "preserve"` (Angular-specific); `tsconfig.worker.json` must override to `module: "ESNext"` with `moduleResolution: "Bundler"`
- D1 database does not exist yet — `wrangler d1 create` is a manual prerequisite before any remote operation

## What We're NOT Doing

- No ORM — raw D1 SQL only; Drizzle can be introduced in S-01 planning
- No auth endpoints, JWT, or login/register — that is S-01
- No cron trigger setup — that is F-02
- No Angular route changes — frontend untouched
- No unified `ng serve` + `wrangler dev` proxy — the two dev servers run independently

## Implementation Approach

Three sequential phases: configuration first (tooling must work before Worker code is written), then Worker source, then migration. Manual gates between phases enforce that the real `database_id` is in `wrangler.toml` before any remote operation.

## Critical Implementation Details

**TypeScript compilation separation**: `tsconfig.app.json` includes `src/**/*.ts`. Adding `src/worker/**` to its `exclude` array is required — omitting it causes `ng build` to fail with "Cannot find module '@cloudflare/workers-types'" or similar errors on the Hono and D1 type imports.

**D1 creation gates remote operations**: `wrangler dev --local` works with a placeholder `database_id`. Remote operations (`wrangler d1 migrations apply --remote`, `wrangler deploy`) require the real `database_id` from `wrangler d1 create`. Fill in the real ID at the Phase 1 manual gate before proceeding to Phase 2.

---

## Phase 1: Configuration

### Overview

Wire the Worker entry point reference, D1 binding, compatibility flags, separate TypeScript config for the Worker, and npm scripts. No new Worker code — this phase makes the toolchain ready.

### Changes Required

#### 1. `package.json` — dependencies and scripts

**File**: `package.json`

**Intent**: Add Hono (runtime), Wrangler (dev toolchain), and Workers types (TypeScript support). Add four scripts: `deploy` (one-command build + deploy), `worker:dev` (local Worker), `migrate:local`, `migrate:remote`.

**Contract**:
- Add to `dependencies`: `"hono": "^4"`
- Add to `devDependencies`: `"wrangler": "^4"`, `"@cloudflare/workers-types": "^4"`
- Add scripts:
  - `"deploy": "ng build && wrangler deploy"`
  - `"worker:dev": "wrangler dev --local"`
  - `"migrate:local": "wrangler d1 migrations apply marketpulse-db --local"`
  - `"migrate:remote": "wrangler d1 migrations apply marketpulse-db --remote"`

#### 2. `wrangler.toml` — main, D1 binding, compatibility flags

**File**: `wrangler.toml`

**Intent**: Declare the Worker entry point, add `nodejs_compat` (required now — Resend SDK in S-05 depends on it), and bind D1 with a placeholder ID the human fills after `wrangler d1 create`.

**Contract**: The final file must look exactly like this (key ordering matters — TOML parses any key written after a `[section]` header as a sub-key of that section, so `main` and `compatibility_flags` must appear before `[assets]`):

```toml
name = "marketpulse"
compatibility_date = "2025-01-01"
main = "src/worker/index.ts"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist/market-pulse/browser"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "marketpulse-db"
database_id = "REPLACE_WITH_DATABASE_ID"
```

#### 3. `tsconfig.app.json` — exclude Worker source

**File**: `tsconfig.app.json`

**Intent**: Prevent Angular's compiler from processing `src/worker/` files, which depend on Workers-only globals absent from the Angular build context.

**Contract**: Add `"src/worker/**"` to the `exclude` array (alongside the existing `"src/**/*.spec.ts"`).

#### 4. `tsconfig.worker.json` — Worker TypeScript config

**File**: `tsconfig.worker.json` (new, project root)

**Intent**: Separate `noEmit` TypeScript config for type-checking Worker source in the IDE and in CI. Wrangler uses its own esbuild bundler so this config never emits output.

**Contract**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src/worker/**/*.ts"]
}
```

### Success Criteria

#### Automated Verification

- `npm install` completes and `package-lock.json` reflects the three new packages
- `npm run build` completes without errors — confirms Angular compiler ignores `src/worker/`
- `tsc --noEmit -p tsconfig.worker.json` completes with zero errors — confirms Worker types resolve

#### Manual Verification

- Run `wrangler d1 create marketpulse-db` — copy the printed `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_DATABASE_ID`

**Implementation Note**: Pause here after the manual step (real `database_id` in `wrangler.toml`) before proceeding to Phase 2.

---

## Phase 2: Worker Entry Point

### Overview

Create the Hono application with a typed `Env` interface and the `GET /health` route. Verify locally with `wrangler dev --local`.

### Changes Required

#### 1. `src/worker/index.ts` — Hono application

**File**: `src/worker/index.ts` (new file)

**Intent**: Minimal Hono app that binds the D1 environment type and responds to the health-check route. This file is the `main` entry point Wrangler bundles.

**Contract**:
- Export interface `Env` with property `DB: D1Database`
- Instantiate `Hono<{ Bindings: Env }>`
- Register `GET /health` → return `c.json({ ok: true })`
- Export default object: `{ fetch: app.fetch }` (Workers module-format requirement)

### Success Criteria

#### Automated Verification

- `tsc --noEmit -p tsconfig.worker.json` passes with zero errors
- `npx wrangler deploy --dry-run` exits 0 (validates bundle without uploading to Cloudflare; requires `dist/market-pulse/browser/` to exist — run `npm run build` first if rerunning this phase in isolation)

#### Manual Verification

- `npm run worker:dev` starts without error (wrangler dev --local mode)
- `curl http://localhost:8787/health` returns `{"ok":true}` with HTTP 200

**Implementation Note**: Pause and confirm `wrangler dev --local` + health check pass before proceeding to Phase 3.

---

## Phase 3: D1 Migration

### Overview

Write the initial migration SQL creating the `users` table, apply it to local D1, then to remote D1, and deploy.

### Changes Required

#### 1. `migrations/0001_create_users.sql` — users table

**File**: `migrations/0001_create_users.sql` (new file, new directory)

**Intent**: Forward-only migration establishing the `users` table required by S-01. Schema is minimal — only columns needed for auth and notification email, exactly what PRD FR-001/FR-004a specify.

**Contract**:
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  notification_email TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### Success Criteria

#### Automated Verification

- `npm run migrate:local` exits 0 — migration applies cleanly to local D1

#### Manual Verification

- `npm run migrate:remote` exits 0 — schema applied to production D1
- `npm run deploy` exits 0 — Angular build + Worker deploy succeed
- `GET /health` on live Cloudflare URL returns `{"ok":true}` HTTP 200

**Implementation Note**: After all manual criteria pass, commit all Phase 1–3 changes together as a single logical commit.

---

## Testing Strategy

### Automated

- `npm run build` — Angular build unaffected by Worker source
- `tsc --noEmit -p tsconfig.worker.json` — Worker type-checks cleanly
- `npx wrangler deploy --dry-run` — Worker bundle is valid
- `npm run migrate:local` — migration SQL is syntactically valid

### Manual Testing Steps

1. `npm install` → confirm packages install without conflicts
2. `wrangler d1 create marketpulse-db` → copy `database_id` into `wrangler.toml`
3. `npm run migrate:local` → confirm migration applied
4. `npm run worker:dev` → `curl http://localhost:8787/health` → expect `{"ok":true}`
5. `npm run migrate:remote` → apply schema to production D1
6. `npm run deploy` → confirm build + deploy succeed
7. `curl https://<live-url>/health` → expect `{"ok":true}` HTTP 200

## References

- Infrastructure: `context/foundation/infrastructure.md`
- Roadmap item F-01: `context/foundation/roadmap.md` § Foundations

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Configuration

#### Automated

- [x] 1.0 `npm install` completes with three new packages in package-lock.json — 178e9cd
- [x] 1.1 `npm run build` passes with no errors after tsconfig.app.json change — 178e9cd
- [x] 1.2 `tsc --noEmit -p tsconfig.worker.json` passes with zero errors — 178e9cd

#### Manual

- [x] 1.3 `wrangler d1 create marketpulse-db` succeeds; database_id filled in wrangler.toml — 178e9cd

### Phase 2: Worker Entry Point

#### Automated

- [x] 2.1 `tsc --noEmit -p tsconfig.worker.json` passes — 4df0e2e
- [x] 2.2 `npx wrangler deploy --dry-run` exits 0 — 4df0e2e

#### Manual

- [x] 2.3 `npm run worker:dev` starts without error — 4df0e2e
- [x] 2.4 `curl http://localhost:8787/health` returns `{"ok":true}` HTTP 200 — 4df0e2e

### Phase 3: D1 Migration

#### Automated

- [x] 3.1 `npm run migrate:local` exits 0

#### Manual

- [x] 3.2 `npm run migrate:remote` exits 0
- [x] 3.3 `npm run deploy` exits 0
- [x] 3.4 `GET /health` on live Cloudflare URL returns `{"ok":true}` HTTP 200
