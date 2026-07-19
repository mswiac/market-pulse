---
date: 2026-07-19T10:30:45+02:00
researcher: Claude
git_commit: 08d26f658d883ce41815baa604c5c850c0830c46
branch: main
repository: market-pulse
topic: "Alert CRUD — schema, endpoints, and frontend form (S-02)"
tags: [research, codebase, alerts, d1, hono, angular, s-02]
status: complete
last_updated: 2026-07-19
last_updated_by: Claude
---

# Research: Alert CRUD — schema, endpoints, and frontend form (S-02)

**Date**: 2026-07-19T10:30:45+02:00
**Researcher**: Claude
**Git Commit**: 08d26f658d883ce41815baa604c5c850c0830c46
**Branch**: main
**Repository**: market-pulse

## Research Question

How to implement alert CRUD (create alert, view alert list — roadmap S-02): what D1 schema, what backend endpoints, and what frontend form/list should be built, staying consistent with existing patterns from F-01/F-01a/S-01.

## Summary

No `alerts` table or alert-related code exists yet — this is greenfield within an established codebase. The prior slices (backend scaffold, users-email-schema, auth-and-registration) already set every convention needed:

- **Schema**: add `migrations/0005_create_alerts.sql`, a plain forward `CREATE TABLE` (no shadow-table needed — it's a new table, not an existing one being altered). FK to `users(id)` with `ON DELETE CASCADE`, matching the `sessions` table pattern (which needed a follow-up migration to add cascade — get it right the first time here).
- **Backend**: new `src/worker/routes/alerts.ts` Hono sub-app, mounted in `src/worker/index.ts` alongside `authRoutes`. Reuse the existing `sessionMiddleware` unchanged (it was explicitly written generically for this). All queries inline (`c.env.DB.prepare(...)`), scoped by `WHERE user_id = ?` using `c.get('userId')` — there is no automatic row-level isolation, each handler must filter explicitly. No validation library exists (no zod) — manual validation functions, matching `auth.ts`'s style.
- **Frontend**: new `src/app/features/alerts/` components (list + form), Angular Material reactive forms exactly like `login`/`register`, a new `AlertsService` mirroring `AuthService`'s shape (same-origin `/api/alerts` calls, no environment/base-URL config, no CORS, no `withCredentials`). Pre-fill notification email from `AuthService.currentUser()?.email`. `<mat-select>` for instrument/alert-type will be a new UI pattern (Material is already installed, just unused so far for selects).

## Detailed Findings

### D1 Schema

Migrations live in `/home/swiacm/projects/market-pulse/migrations/`, named `NNNN_description.sql`, applied in filename order via `wrangler d1 migrations apply marketpulse-db [--local|--remote]` (`package.json:12-13`). Next file: `0005_create_alerts.sql`.

Existing migrations (full contents) establish two patterns:
- **New table** (`0001_create_users.sql`, `0003_create_sessions.sql`): plain `CREATE TABLE IF NOT EXISTS` / `CREATE TABLE`.
- **Altering an existing table** (`0002_users_email_schema.sql`, `0004_sessions_cascade_delete.sql`): expand/contract — `CREATE TABLE x_new`, copy data if needed, `DROP TABLE x`, `RENAME x_new TO x`. D1/SQLite cannot `ALTER TABLE` to add constraints in place.

Since `alerts` is a brand-new table, only the first pattern applies — no shadow-table dance needed.

Reference shape to follow (`sessions`, after its cascade-delete fix):
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```
Get the `ON DELETE CASCADE` right in the first `alerts` migration — it was missed on `sessions` and needed a follow-up migration (`context/archive/2026-06-26-backend-scaffold` follow-ups; `migrations/0004_sessions_cascade_delete.sql`).

Final `users` table (after `0001`+`0002`): `id INTEGER PK AUTOINCREMENT`, `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `created_at INTEGER NOT NULL DEFAULT (unixepoch())`. No `notification_email` column exists on `users` — it was dropped in `0002`. This confirms the per-alert notification email must live on the new `alerts` table itself; the account-email prefill is an application-layer concern (frontend reads `AuthService.currentUser().email` as a form default), not a DB join. This was explicitly anticipated in `context/archive/2026-06-28-users-email-schema/plan.md`: *"Future `alerts.notification_email` column (S-02) pre-fills from `users.email` at the application layer — no schema dependency introduced here."*

Suggested `alerts` columns (derived from PRD FR-004/FR-005, no prior column names were committed anywhere):
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `instrument TEXT NOT NULL` — `'VIX'` or `'NASDAQ100'` (enum enforced at the application layer, consistent with the codebase's no-ORM/no-validation-library style; a `CHECK` constraint is an option D1/SQLite supports natively if stricter DB-level enforcement is wanted)
- `alert_type TEXT NOT NULL` — `'price'` or `'rsi'`
- `threshold REAL NOT NULL` — RSI must validate 0–100 at the application layer (frontend + backend), no DB-level range check is used elsewhere in this codebase for numeric bounds
- `notification_email TEXT NOT NULL`
- `created_at INTEGER NOT NULL DEFAULT (unixepoch())`

An index on `user_id` (mirroring `idx_sessions_expires_at`) is worth adding since every list query filters by it.

D1 binding: `wrangler.toml:11-14`, binding name `DB`, accessed as `c.env.DB` (`D1Database`). `Env` interface at `src/worker/index.ts:4-8`.

No repository/DAO layer exists — queries are written inline in route handlers (`src/worker/routes/auth.ts`), e.g.:
```ts
const inserted = await c.env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id')
  .bind(email, passwordHash)
  .first<{ id: number }>();
```
The closest thing to an exception is `src/worker/lib/session.ts`, which factors session queries into plain functions taking `db: D1Database` as a parameter — a reasonable template if alert query logic grows complex enough to warrant extraction, but inline-in-route-handler (matching `auth.ts`) is the dominant convention and is sufficient for create+list.

No shared `types.ts`/`models/` — row shapes are inline anonymous types per query (`.first<{ id: number; email: string }>()`). No existing precedent forces a shared `Alert` interface; either inline per-query or a small local type near the alerts route file is consistent with current practice.

Tests auto-pick-up new migrations: `vitest.config.mts` loads all files under `migrations/` via `readD1Migrations()` and applies them in test setup (`test/setup/apply-migrations.ts`) — no config change needed when `0005_create_alerts.sql` is added.

### Backend endpoints

Worker root: `src/worker/` (`wrangler.toml:3` → `main = "src/worker/index.ts"`).
```
src/worker/
  index.ts            — Hono app entry, mounts route modules, Env interface
  routes/auth.ts       — auth route module
  lib/session.ts        — session cookie + sessionMiddleware
  lib/password.ts       — password hashing
```

`index.ts` pattern:
```ts
const app = new Hono<{ Bindings: Env }>();
app.route('/api', authRoutes);
app.get('/api/health', (c) => c.json({ ok: true }));
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));   // SPA fallback — must stay last
```
Add `src/worker/routes/alerts.ts` exporting a Hono sub-app; mount with `app.route('/api', alertsRoutes)` before the catch-all `app.get('*', ...)`.

Auth: `sessionMiddleware` (`src/worker/lib/session.ts`) reads the `session_id` cookie, validates + slides expiration, `c.set('userId', session.userId)`. Applied **per-route**, not globally — in `auth.ts` only `/me` uses it. Since **every** alert endpoint requires auth, apply it once at the module top: `alertsRoutes.use('*', sessionMiddleware)`. Downstream handlers read `c.get('userId')` and must manually scope every query with `WHERE user_id = ?` — there is no automatic row-level isolation.

Route module needs its own `type Variables = { userId: number }` passed to `new Hono<{ Bindings: Env; Variables: Variables }>()`, matching `auth.ts:24,26`.

Response/error conventions (from `auth.ts`):
- Success: `c.json(<object|array>, <status>)` — 200 GET, 201 create, 204 (`c.body(null, 204)`) for no-content actions.
- Error: always `{ error: <string> }` — 400 bad input, 401 unauthorized, 409 conflict.
- Body parsing wrapped to return `null` on invalid JSON, then null-checked.
- DB errors inspected by message string (e.g. `.includes('UNIQUE')` → 409), otherwise rethrown (→ Hono default 500).

No validation library (no zod, no `@hono/zod-validator`) — manual validation functions like `normalizeEmail`/`EMAIL_PATTERN` in `auth.ts`. Replicate this style: helpers to validate `instrument` (`VIX`/`NASDAQ100` enum), `alertType` (`price`/`rsi`), numeric `threshold` (finite number; if `alertType === 'rsi'`, additionally 0–100), and email format (reuse `EMAIL_PATTERN`/`normalizeEmail`).

No CORS middleware anywhere — not needed, since the Angular SPA and `/api/*` are served same-origin from one Worker (`ASSETS` binding + catch-all route). Alert endpoints need no new CORS config.

Test pattern to replicate: `test/worker/auth.test.ts` fetches via `cloudflare:workers` export, extracts the session cookie helper, asserts status/JSON with `toMatchObject`. A new `test/worker/alerts.test.ts` should register+login a user first to get a cookie, then exercise create/list.

### Frontend

`src/app/` structure: `core/auth/` (singleton services/guards/interceptors) vs `features/<name>/<component>/` (routed standalone components, 3 files each: `.ts`/`.html`/`.scss`, no `.component` suffix). For alerts: `src/app/features/alerts/alert-form/` and `src/app/features/alerts/alert-list/` (or a combined container), mirroring `features/auth/login/` and `features/auth/register/`.

Component pattern (from `login.ts`, full 45-line file read):
- Standalone `@Component({ imports: [ReactiveFormsModule, ...MatModules] })`, `inject()` for DI (not constructor injection).
- `fb.nonNullable.group({...})` with per-field `Validators` arrays.
- `signal<string|null>(null)` for error message, `signal(false)` for submitting; `[disabled]="form.invalid || submitting()"`.
- `.subscribe({ next, error })` on service calls returning `Observable<T>`.
- Template: Material `<mat-form-field>` + `@if`/`@else if` control-flow blocks per validation error (`hasError('required') && touched`), reused verbatim in style for threshold (`required`/`min`/`max`) and email fields.
- `register.ts` additionally shows server-error mapping: `form.controls.X.setErrors({ server: true })` + `markAsTouched()` — useful if the backend rejects e.g. an out-of-range RSI threshold.
- `<mat-select>`/`<mat-option>` for instrument/alert-type dropdowns is a **new** UI pattern in this codebase (Material `^22.0.4` is already a dependency, just unused for selects so far — no existing example to copy, but standard Material API).

Backend access — `AuthService` (`src/app/core/auth/auth.service.ts`, full 40-line file read): `@Injectable({ providedIn: 'root' })`, `inject(HttpClient)`, a private `signal<AuthUser | null>(null)` + public `.asReadonly()` + `computed()` for `isAuthenticated`, methods return `Observable<T>` calling root-relative `/api/...` paths with `.pipe(tap(...))` to sync the signal. **No base-URL/environment config, no `withCredentials`, no CORS** — same-origin `fetch` adapter (`provideHttpClient(withFetch(), ...)`) defaults to same-origin credentials, and dev-server proxying (`proxy.conf.json` → `angular.json:92`) forwards `/api` to the local Worker. A new `AlertsService` should follow this exact shape: CRUD methods (`create`/`list`/`update`/`delete`) returning `Observable<Alert>`/`Observable<Alert[]>` against `/api/alerts`.

Current-user exposure: `AuthService.currentUser` signal, populated at bootstrap via `provideAppInitializer` calling `checkSession()` (`app.config.ts`) before first navigation — so it's already populated by the time any guarded component renders. For the alert form's email prefill: `inject(AuthService)`, initialize the form control default from `this.authService.currentUser()?.email ?? ''`, leave it editable (same validators as login's email field).

Routing (`app.routes.ts`, full 19-line file read): flat array, `loadComponent` lazy imports, `canActivate: [authGuard]` per protected route, catch-all `{ path: '**', redirectTo: '' }` must stay last. `authGuard` (`core/auth/auth.guard.ts`) is a simple `CanActivateFn` checking `authService.isAuthenticated()`. New alert routes (e.g. `path: ''` for the list — replacing/extending the current placeholder `Home` component which says "Alert management is coming soon", and `path: 'alerts/new'` for the form) each need `canActivate: [authGuard]`, added before the catch-all.

No `environment.ts`/`src/environments/` exists anywhere — dev/prod split is handled entirely by `proxy.conf.json` (dev) + same-origin Worker serving (prod). No new config needed for `AlertsService`.

## Code References

- `migrations/0001_create_users.sql` — original users table (superseded)
- `migrations/0002_users_email_schema.sql` — shadow-table pattern example; final `users` schema
- `migrations/0003_create_sessions.sql`, `migrations/0004_sessions_cascade_delete.sql` — new-table + FK-cascade-fix example
- `wrangler.toml:3` — Worker `main` entry
- `wrangler.toml:11-14` — D1 binding config
- `src/worker/index.ts:4-8` — `Env` interface
- `src/worker/index.ts:9,12` — route mounting pattern
- `src/worker/routes/auth.ts:24,26` — `Variables` type + typed Hono app
- `src/worker/routes/auth.ts:28-32` — `normalizeEmail` helper
- `src/worker/routes/auth.ts:34-43` — safe JSON body parsing
- `src/worker/routes/auth.ts:64-73` — insert + UNIQUE-conflict handling
- `src/worker/routes/auth.ts:78` — 201 create response
- `src/worker/routes/auth.ts:106-113` — 204 no-content response (logout)
- `src/worker/routes/auth.ts:115-126` — `/me` protected-route pattern (auth applied per-route, `WHERE id = ?` scoping)
- `src/worker/lib/session.ts:5-6` — cookie name / TTL constants
- `src/worker/lib/session.ts:52-66` — `setSessionCookie` (httpOnly/sameSite/secure/maxAge)
- `src/worker/lib/session.ts:70-90` — `sessionMiddleware`
- `package.json:12-13` — migration npm scripts
- `vitest.config.mts:6,12` — test migration loading
- `test/setup/apply-migrations.ts` — test migration application
- `test/worker/auth.test.ts` — integration test pattern to mirror
- `src/app/app.routes.ts` (full file) — routing table + guard usage
- `src/app/core/auth/auth.guard.ts` (full file) — `CanActivateFn` pattern
- `src/app/core/auth/auth.service.ts` (full file) — service shape to mirror for `AlertsService`
- `src/app/features/auth/login/login.ts` (full file) — component pattern to mirror
- `src/app/features/auth/login/login.html` — Material form-field + validation-message pattern
- `src/app/features/auth/register/register.ts:39-51` — server-error-to-form-control mapping pattern
- `src/app/features/home/home.ts:15,18`, `src/app/features/home/home.html:4-6,16-18,19` — current signal-read pattern; placeholder text ("Alert management is coming soon") to replace
- `src/app/app.config.ts:14,18-21` — `provideHttpClient(withFetch())`; `provideAppInitializer` bootstrapping `checkSession()`
- `proxy.conf.json`, `angular.json:92` — dev-server `/api` proxy

## Architecture Insights

- **Consistent no-ORM, no-validation-library philosophy** across both backend (raw SQL via `D1Database.prepare`, manual field validation) and frontend (no state-management library beyond Angular signals, no schema-validation library for forms beyond Angular's built-in `Validators`). Alert CRUD should not introduce zod, an ORM, or any new dependency — doing so would break established consistency for no clear benefit at this scale.
- **Per-route (not global) middleware application** is deliberate — `auth.ts` only guards `/me`, leaving `/register`/`/login` public. Alerts routes are a full-auth resource, so apply `sessionMiddleware` once at the module level (`alertsRoutes.use('*', sessionMiddleware)`) rather than repeating it per-route.
- **User isolation is manual, not structural** — there's no query-builder or DB view enforcing `user_id` scoping; every alerts handler must remember to filter. This is the single highest-risk correctness point for S-02 given the PRD's isolation NFR — worth flagging explicitly in the plan and covering with a test that user A cannot see/edit/delete user B's alert.
- **Same-origin serving eliminates whole categories of config** (CORS, base-URL, `withCredentials`) that a split-origin deployment would need — this pattern was locked in during F-01 (backend scaffold) and should NOT be revisited for alerts.
- **Forward-only, additive migrations** — the shadow-table pattern exists specifically for altering existing tables; a new `alerts` table needs only a plain `CREATE TABLE`, avoiding that complexity entirely.

## Historical Context (from prior changes)

- `context/archive/2026-07-14-auth-and-registration/plan.md` — password hashing decision (Web Crypto PBKDF2, 10k iterations, pepper via Workers Secret) driven by `workerd`'s hard 100k-iteration cap and the Free plan's tighter effective CPU budget (see also user memory `project_workers_pbkdf2_cap.md`); not directly relevant to alerts but confirms the "no native/WASM crypto deps" convention. Also states explicitly that `sessionMiddleware` "is written generically so S-02's protected alert routes can reuse it without new session logic" — direct confirmation that no new auth plumbing is needed.
- `context/archive/2026-06-26-backend-scaffold/` follow-ups — documents the D1 `ALTER TABLE` limitation and the shadow-table fix pattern, and the missed-then-fixed `ON DELETE CASCADE` on `sessions.user_id` — a concrete gotcha to avoid repeating on `alerts.user_id`.
- `context/archive/2026-06-28-users-email-schema/plan.md` and `plan-brief.md` — explicitly anticipated `alerts.notification_email` as an application-layer prefill from `users.email`, with no schema coupling — confirms the `notification_email` column belongs on `alerts`, not derived via join.
- Roadmap risk note (`context/foundation/roadmap.md:129`, S-02 section): "Introduces the `alerts` table and its forward-only D1 migration. RSI threshold type requires input validation on the frontend (range 0–100) but no backend RSI calculation yet... First multi-field Angular form beyond auth." — confirms scope boundary: S-02 stores the threshold and instrument/type choice only; actual RSI computation and current-value display is S-04/F-02, out of scope here.

## Related Research

None yet under `context/changes/**/research.md` for this specific slice prior to this document. Sibling research/plans for prerequisite slices: `context/archive/2026-06-26-backend-scaffold/research.md`, `context/archive/2026-06-28-users-email-schema/research.md` (if present), `context/archive/2026-07-14-auth-and-registration/research.md`.

## Open Questions

1. **Exact instrument enum values on the wire** — `'VIX'`/`'NASDAQ100'` vs `'NASDAQ-100'` vs numeric codes — not decided anywhere yet; pick one and keep it consistent across DB, API, and frontend `<mat-select>` option values. Recommend deciding this in `/10x-plan`.
2. **CHECK constraints vs application-only validation** — the codebase has no precedent for DB-level `CHECK` constraints (only `NOT NULL`/`UNIQUE`/FK). Decide whether `alerts.alert_type IN ('price','rsi')` and threshold-range enforcement belong at the DB layer too, or stay purely in the Worker/Angular validation layers per existing convention.
3. **Does `Home` get replaced or extended?** The current placeholder home component (`src/app/features/home/home.html:19`, "Alert management is coming soon") is the natural home for the alert list — decide in planning whether S-02 replaces `Home` outright or adds a separate `/alerts` route and leaves `Home` as a dashboard shell.
