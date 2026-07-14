# Auth & Registration Implementation Plan

## Overview

Implement email + password registration, login, and logout (PRD FR-001/002/003, roadmap slice S-01). Sessions are D1-backed with sliding expiration, delivered via an httpOnly `SameSite=Lax` cookie. Passwords are hashed with Web Crypto PBKDF2 plus an HMAC pepper (no native/WASM dependency), with the iteration count tuned to fit the Workers Free plan's CPU budget. This is the first backend logic beyond the `/health` route and the first Angular form in the app, so it also establishes the initial backend test infrastructure and the frontend auth/routing conventions that later slices (S-02 alert CRUD onward) will reuse.

## Current State Analysis

- `src/worker/index.ts` is an 11-line Hono app with a single `GET /health` route. No other routes, no middleware, no auth code exist.
- `users` table (`migrations/0002_users_email_schema.sql`) already has `id`, `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `created_at`. Nothing populates `password_hash` yet.
- No `sessions` table exists.
- `src/app/app.routes.ts` is empty (`export const routes: Routes = [];`). No components beyond the default Angular CLI scaffold exist under `src/app/`. `@angular/forms` is a dependency but unused. `provideHttpClient` is not registered in `src/app/app.config.ts`.
- No `src/environments/` config and no `proxy.conf.json` exist — `ng serve` and `wrangler dev --local` are today two disconnected processes.
- Zero backend test tooling (no vitest, no `@cloudflare/vitest-pool-workers`). `npm test` runs Karma/Jasmine for the frontend only and is not applicable here (`skipTests: true` is set globally — no Angular component specs are generated).
- Deploy is same-origin: the Worker serves both the built SPA and the API in production (`wrangler.toml`), so there's no CORS boundary to design around in prod — only in local dev.

## Desired End State

A user can register with email + password, is immediately logged in, sees a minimal authenticated home view with their email and a logout button, can close the browser and return within the session window without re-authenticating (sliding expiration), can log out (which ends the D1 session and clears the cookie), and is redirected to `/login` if they try to reach the authenticated view without a valid session. All backend auth logic has automated test coverage. Verification: manually walk through register → land on home → refresh page (still authenticated) → logout → confirm redirected to `/login` when revisiting the home route.

### Key Discoveries:

- Cookie `secure: true` requires HTTPS; `wrangler dev --local` serves plain HTTP by default, so hardcoding `secure: true` would silently break login in local dev (session cookie never gets stored by the browser). The `secure` flag must be derived from the incoming request's protocol.
- `nodejs_compat` is already enabled (`wrangler.toml:4`), so `Buffer` is available for base64 encoding of the PBKDF2 salt/hash — no extra dependency needed for that.
- No official Hono session middleware exists for this use case; a hand-rolled D1-backed session (opaque random token as both the D1 primary key and the cookie value) is the standard approach for custom renewal logic.
- `@cloudflare/vitest-pool-workers` (current major version) applies D1 migrations to the test database via `applyD1Migrations()` in a `setupFiles` entry, reading the same `migrations/*.sql` files used by `wrangler d1 migrations apply` — no separate test schema to maintain.
- Cloudflare's `workerd` runtime hard-caps `crypto.subtle` PBKDF2 at 100,000 iterations (unconfigurable, independent of billing plan — enforced in `workerd`'s own source, see `cloudflare/workerd#1346`). Even 100,000 iterations costs roughly ~50ms of CPU time by Cloudflare's own estimate, well over the Workers Free plan's ~10ms-per-request budget this project is currently on (`context/foundation/infrastructure.md` risk register). The usable iteration count is therefore bounded by the Free plan's CPU budget, not by OWASP's current 600k recommendation or even `workerd`'s ceiling.

## What We're NOT Doing

- Email verification at registration (account is active immediately after registration).
- Forgot-password / password-reset flow (deferred to a later slice; requires Resend, which isn't wired up until S-05).
- Login rate limiting / brute-force protection (deferred; noted as a conscious gap, not an oversight).
- CSRF token (double-submit or otherwise) — `SameSite=Lax` on the session cookie is the chosen mitigation for this slice.
- The alert dashboard / alert list UI (S-02) — the post-login view built here is a minimal placeholder (user email + logout button) whose only job is to give FR-003 (logout) a UI surface and to give the route guard something to protect.
- Refresh tokens / multi-device session management UI (e.g. "log out other devices") — out of scope; D1 sessions support it structurally later if ever needed, but no UI for it now.

## Implementation Approach

Data model → backend (test infra, then auth logic) → frontend. All backend routes are namespaced under `/api/*` (new convention, established here) so that Angular client-side routes (e.g. a future `/login` page path) never collide with API paths at the Worker's routing layer; `GET /health` moves to `GET /api/health` for consistency. The session-validation middleware is written as a reusable Hono middleware so S-02 (alert CRUD) can mount it on protected routes without rewriting session logic.

## Critical Implementation Details

- **Cookie `secure` flag in local dev**: derive `secure` from the request's own protocol (`new URL(c.req.url).protocol === 'https:'`) rather than hardcoding `true`. Hardcoding breaks session cookie storage under `wrangler dev --local` (plain HTTP), which would make the entire login flow untestable locally.
- **Sliding expiration write-avoidance**: only re-write `sessions.expires_at` (and re-set the cookie) when more than a threshold fraction of the TTL has already elapsed since the last renewal — not on every single request. Renewing unconditionally on every request means a D1 write per page load with no user-visible benefit.
- **Register auto-login ordering**: after the `INSERT INTO users` succeeds, the register handler must create the session row and set the cookie using the newly inserted user's id in the same request — registration and login share the "create session + set cookie" code path, they don't redirect to a separate login step.
- **Login vs. registration error messages differ on purpose**: registration returns an explicit `409 "email already registered"` (chosen for UX — see Key Decisions in the brief). Login returns a generic `401 "invalid email or password"` regardless of whether the email is unknown or the password is wrong — this is a different, standard mitigation against account enumeration via the login endpoint specifically, and should not be "fixed" to match registration's explicitness.
- **Password hashing is CPU-budget-constrained, not security-preference-constrained**: the PBKDF2 iteration count is bounded below both `workerd`'s hard cap (100,000, unconfigurable) and the Workers Free plan's ~10ms CPU-per-request budget — roughly 10,000-15,000 iterations is the realistic ceiling, to be confirmed by measuring actual CPU time in Phase 3 (via `wrangler tail`'s `cpuMs` field or local timing) and raised as high as the measured budget comfortably allows. This is a platform constraint, not a deliberate security choice — leave a code comment saying so, so a future maintainer doesn't "fix" it back toward 600k and break every request. To compensate for the lower iteration count, password hashing also includes an HMAC-SHA256 pepper keyed by a `PASSWORD_PEPPER` Workers Secret (set via `wrangler secret put PASSWORD_PEPPER`, never in `wrangler.toml`) — a leaked D1 dump alone is insufficient to brute-force passwords without also compromising the Workers Secret.

## Phase 1: Database — sessions table

### Overview

Add the `sessions` table that backend session logic (Phase 3) depends on.

### Changes Required:

#### 1. Sessions table migration

**File**: `migrations/0003_create_sessions.sql`

**Intent**: Create a new table for D1-backed sessions. This is a new table, not a schema change to `users`, so it's a plain forward `CREATE TABLE` — no shadow-table pattern needed (that pattern in `0002` was only required because it altered an existing table's columns).

**Contract**: `sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`, plus an index on `expires_at` to keep future cleanup/lookup queries cheap. `id` is the opaque random session token itself (also the cookie value) — no separate secret/lookup-key split.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly locally: `npm run migrate:local`
- Migration applies cleanly to remote D1: `npm run migrate:remote`

#### Manual Verification:

- `sessions` table visible via `wrangler d1 execute marketpulse-db --local --command "SELECT sql FROM sqlite_master WHERE name='sessions'"`

---

## Phase 2: Backend test infrastructure

### Overview

Stand up `@cloudflare/vitest-pool-workers` so Phase 3's auth logic can ship with tests from the start. This is the first backend test tooling in the repo.

### Changes Required:

#### 1. Test tooling dependencies

**File**: `package.json`

**Intent**: Add `vitest` and `@cloudflare/vitest-pool-workers` as devDependencies, and a script to run backend tests separately from `ng test` (which stays Karma/Jasmine-only for the frontend, per `skipTests: true`).

**Contract**: New devDependencies `vitest` and `@cloudflare/vitest-pool-workers`; new script `"test:worker": "vitest run"`.

#### 2. Vitest config

**File**: `vitest.config.ts` (repo root)

**Intent**: Wire the Workers test pool to the existing `wrangler.toml` and expose the repo's D1 migrations to the test environment.

**Contract**:
```ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { setupFiles: ["./test/setup/apply-migrations.ts"] },
  };
});
```

#### 3. Migration setup file

**File**: `test/setup/apply-migrations.ts`

**Intent**: Apply the real `migrations/*.sql` files to the test D1 instance before any test runs, so tests exercise the actual schema rather than a hand-maintained copy.

**Contract**: Calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` from `cloudflare:test` / `env` from `cloudflare:workers`, per the vitest-pool-workers setup-file convention. Idempotent — safe if the setup file runs more than once.

#### 4. tsconfig coverage for tests

**File**: `tsconfig.worker.json`

**Intent**: Ensure `test/**/*.ts` type-checks under the worker tsconfig (it currently only includes `src/worker/**/*.ts`) so `npm run typecheck` also covers test files, including resolving the `cloudflare:test`/`cloudflare:workers` virtual modules used by the test setup file.

**Contract**: Extend the `include` array to add `test/**/*.ts`. Extend the `types` array to add `"@cloudflare/vitest-pool-workers/types"` alongside the existing `"@cloudflare/workers-types"` — required for `tsc` to resolve `cloudflare:test`/`cloudflare:workers` imports (Cloudflare's documented pattern; without it, `npm run typecheck` fails with "Cannot find module 'cloudflare:test'").

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` runs successfully with zero tests (empty suite, tooling wired) or a trivial smoke test asserting `env.DB` is defined
- `npm run typecheck` passes with `test/` included

---

## Phase 3: Backend — auth logic

### Overview

Password hashing, the `/api/register`, `/api/login`, `/api/logout`, `/api/me` endpoints, and the reusable session-validation middleware. `/health` moves to `/api/health` to establish the `/api/*` namespace convention before the frontend (Phase 4) starts consuming it.

### Changes Required:

#### 1. Password hashing

**File**: `src/worker/lib/password.ts`

**Intent**: Hash and verify passwords using Web Crypto PBKDF2 plus an HMAC-SHA256 pepper — no native modules or WASM, runs natively in the Workers isolate, and stays within the Workers Free plan's CPU budget.

**Contract**: `hashPassword(password: string, pepper: string): Promise<string>` and `verifyPassword(password: string, pepper: string, stored: string): Promise<boolean>`. The password is first peppered via `HMAC-SHA256(key=pepper, message=password)` (negligible CPU cost), then the peppered value is stretched via PBKDF2. Stored format is self-describing so the iteration count can be tuned without a migration: `pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>`. Default iteration count: 10,000 (within NIST SP 800-63B's floor recommendation) — benchmark in Phase 3 and raise as high as the Workers Free plan's CPU budget comfortably allows (hard ceiling: 100,000, `workerd`'s cap — see Critical Implementation Details). 16-byte random salt via `crypto.getRandomValues`, base64 via `Buffer` (available through `nodejs_compat`). Verification must use a constant-time byte comparison, not `===`. The pepper comes from a new `PASSWORD_PEPPER` Workers Secret, never `wrangler.toml`.

#### 2. Session helpers + middleware

**File**: `src/worker/lib/session.ts`

**Intent**: Create, validate + slide-renew, and destroy D1-backed sessions; expose a Hono middleware that other routes (including future S-02 alert routes) can mount to require authentication.

**Contract**: `createSession(db, userId): Promise<{ id: string; expiresAt: number }>`, `validateSession(db, sessionId): Promise<{ userId: number } | null>` (also performs the sliding-expiration renewal write when due — see Critical Implementation Details), `destroySession(db, sessionId): Promise<void>`, and `sessionMiddleware` (Hono `MiddlewareHandler`) that reads the `session_id` cookie, validates it, attaches the user id via `c.set('userId', ...)`, and returns 401 on missing/invalid/expired session. Session TTL: 7 days; renewal threshold: renew once per hour of continued activity (avoids a D1 write on every request).

#### 3. Auth routes

**File**: `src/worker/routes/auth.ts`

**Intent**: Implement the four endpoints. Registration validates email format and an 8-character minimum password length before hashing; on `UNIQUE` constraint violation from D1, returns the explicit "already registered" message (per Key Decisions). Login always returns a generic invalid-credentials message on any failure (wrong email or wrong password alike). Registration creates a session immediately (auto-login) rather than requiring a separate login step.

**Contract**: `POST /register` (email, password → 201 + user + session cookie, or 400/409), `POST /login` (email, password → 200 + user + session cookie, or 401), `POST /logout` (idempotent — 204 + clears cookie even with no/invalid existing session), `GET /me` (requires `sessionMiddleware` → 200 + user, or 401). Cookie options: `httpOnly: true`, `sameSite: 'Lax'`, `secure` derived from request protocol (see Critical Implementation Details), `path: '/'`, `maxAge` matching the session TTL.

#### 4. Wire routes into the Worker entry point

**File**: `src/worker/index.ts`

**Intent**: Mount the auth router under `/api`, move the existing health check to `/api/health`.

**Contract**: `app.route('/api', authRoutes)`; `app.get('/api/health', ...)` replaces the old `app.get('/health', ...)`; the `Env` interface gains `PASSWORD_PEPPER: string`, backed by a new Workers Secret (see Phase 3 manual verification for the `wrangler secret put` step).

#### 5. Backend tests

**File**: `test/worker/password.test.ts`, `test/worker/auth.test.ts`

**Intent**: Cover the password hash/verify round-trip and the four auth endpoints (happy path for each, plus duplicate-email registration, wrong-password login, unauthenticated `/me`, and logout clearing the session).

**Contract**: Standard vitest `it`/`expect` blocks using `env.DB` and `SELF.fetch(...)` (or the app's `fetch` handler directly) per the vitest-pool-workers pattern established in Phase 2.

### Success Criteria:

#### Automated Verification:

- `npm run test:worker` passes, including the new auth tests
- `npm run typecheck` passes

#### Manual Verification:

- `curl` against `wrangler dev --local`: register a new email, confirm `Set-Cookie` header present and a row appears in `sessions`; call `/api/me` with the cookie and get the user back; call `/api/logout`, then `/api/me` again and confirm 401
- Registering the same email twice returns 409 with the explicit message
- Logging in with a wrong password returns the generic 401 message (not "wrong password" specifically)
- `PASSWORD_PEPPER` secret is set for both local dev and remote (`wrangler secret put PASSWORD_PEPPER`, plus its local-dev equivalent) before testing register/login
- Measure actual CPU time of `/api/register` and `/api/login` (via `wrangler tail`'s `cpuMs` field or local timing) and confirm the chosen iteration count fits comfortably within the Workers Free plan's ~10ms budget; raise iterations toward the 100,000 ceiling if headroom allows

---

## Phase 4: Frontend — auth end to end

### Overview

Local dev wiring, the signal-based `AuthService`, register/login forms, the functional route guard, the minimal authenticated home placeholder, and full manual verification of the flow.

### Changes Required:

#### 1. Local dev proxy

**File**: `proxy.conf.json` (repo root), `angular.json`

**Intent**: Let `ng serve` forward `/api/*` requests to `wrangler dev --local` so the frontend can be developed with live reload while talking to the real backend.

**Contract**: `proxy.conf.json` maps `"/api"` to the local Worker's dev URL; `angular.json`'s `serve` target gets `"proxyConfig": "proxy.conf.json"` added under its `development` configuration.

#### 2. HttpClient registration

**File**: `src/app/app.config.ts`

**Intent**: Register Angular's `HttpClient` so `AuthService` can call the backend.

**Contract**: Add `provideHttpClient(withFetch())` to the `providers` array.

#### 3. Auth service

**File**: `src/app/core/auth/auth.service.ts`

**Intent**: Central signal-based auth state, consumed by the guard and the auth components. Establishes `core/` as the convention for singleton app-wide services (first such service in the app).

**Contract**: `currentUser: Signal<{ id: number; email: string } | null>`, `isAuthenticated: Signal<boolean>` (computed), `register(email, password): Observable<...>`, `login(email, password): Observable<...>`, `logout(): Observable<void>`, `checkSession(): Observable<...>` (calls `GET /api/me`, used once at app bootstrap to restore auth state after a page refresh since the session cookie is httpOnly and unreadable from JS).

#### 4. Route guard

**File**: `src/app/core/auth/auth.guard.ts`

**Intent**: Protect the authenticated home route; redirect unauthenticated visitors to `/login`. Reusable by S-02's future protected routes.

**Contract**: Functional `CanActivateFn` reading `AuthService.isAuthenticated`; on false, returns a `UrlTree` for `/login` instead of `true`.

#### 5. Register & login components

**File**: `src/app/features/auth/register/register.ts` (+ `.html`, `.scss`), `src/app/features/auth/login/login.ts` (+ `.html`, `.scss`)

**Intent**: Standalone components with Angular Reactive Forms (first reactive form in the app — establishes the convention). Register: email + password fields, 8-character min length validator, submit calls `AuthService.register`, navigates to the home route on success, surfaces the 409 "already registered" message inline on the email field. Login: email + password fields, submit calls `AuthService.login`, navigates to the home route on success, surfaces the generic invalid-credentials message.

**Contract**: `ReactiveFormsModule`-based `FormGroup` with `Validators.required`/`Validators.email`/`Validators.minLength(8)`; error message rendered from the HTTP error response body.

#### 6. Authenticated home placeholder

**File**: `src/app/features/home/home.ts` (+ `.html`, `.scss`)

**Intent**: Minimal guarded view giving FR-003 (logout) a UI surface until S-02 replaces it with the real alert dashboard. Shows the logged-in user's email and a logout button calling `AuthService.logout()`, navigating to `/login` on completion.

**Contract**: Standalone component, no additional routes/state beyond what `AuthService` already exposes.

#### 7. Route wiring

**File**: `src/app/app.routes.ts`

**Intent**: Register the three routes and the guard.

**Contract**: `/register` and `/login` public; `''` (home) behind `canActivate: [authGuard]`; unknown paths redirect to `''`.

#### 8. Documentation sync

**File**: `CLAUDE.md`

**Intent**: The Architecture section's Auth line still says "username + password" from before F-01a; fix it now that real auth code exists to avoid compounding the drift.

**Contract**: Update the one-line description under **Architecture** → Auth to reflect email + password with D1-backed sessions.

#### 9. Session-expiry interceptor

**File**: `src/app/core/auth/session-expired.interceptor.ts`

**Intent**: Catch a session that expires or is revoked while the user is already sitting on the guarded home view — `AuthService.isAuthenticated` is only set at bootstrap and re-checked on navigation, so without this, a stale "authenticated" UI state would persist until the next full navigation. Also gives S-02's future protected API calls a place to land a 401.

**Contract**: A functional `HttpInterceptorFn` registered via `provideHttpClient(withFetch(), withInterceptors([sessionExpiredInterceptor]))` (extends item 2's `provideHttpClient` call). On any `401` response, clears `AuthService.currentUser` and navigates to `/login`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run build` succeeds

#### Manual Verification:

- Fresh browser session: visiting `/` redirects to `/login` (no session cookie yet)
- Register a new account → landed on home view showing the registered email
- Refresh the page → still authenticated (session restored via `/api/me`), no redirect to `/login`
- Click logout → redirected to `/login`; revisiting `/` redirects to `/login` again (session actually ended, not just a client-side flag)
- Registering with an already-used email shows the "already registered" message inline
- Logging in with a wrong password shows the generic invalid-credentials message
- Repeat the full register → refresh → logout flow once more against `wrangler dev --local` fronted by `ng serve` + `proxy.conf.json`, to confirm the dev proxy wiring works end to end (not just against the deployed/same-origin build)
- While on the authenticated home view, delete the session's row from the `sessions` table directly (simulating expiry/revocation), then trigger any API call (e.g. reload `/api/me` manually or wait for the next call) and confirm the interceptor clears auth state and redirects to `/login`

---

## Testing Strategy

### Unit Tests:

- Password hashing: correct verify on matching password, reject on wrong password, two hashes of the same password differ (random salt), reject verify when the pepper doesn't match.
- Session helpers: valid session resolves to the right user; expired session resolves to null; renewal only rewrites `expires_at` when past the threshold, not on every call.

### Integration Tests:

- Full register → `/api/me` → logout → `/api/me` (expect 401) cycle via the Worker's `fetch` handler in vitest.
- Duplicate registration returns 409; wrong-password login returns generic 401.

### Manual Testing Steps:

1. Register → land on home → refresh → still logged in → logout → redirected and blocked from `/`.
2. Duplicate-email registration and wrong-password login error messages, as listed in Phase 4 manual verification.
3. Full flow through the `ng serve` + `proxy.conf.json` dev setup, not just the production-style same-origin build.

## Performance Considerations

Sliding-expiration renewal is throttled (see Critical Implementation Details) specifically to avoid a D1 write on every authenticated request. PBKDF2 iteration count is bounded by the Workers Free plan's ~10ms CPU-per-request budget (see Critical Implementation Details) — default 10,000 iterations, tuned upward during Phase 3 based on measured CPU time, well below `workerd`'s 100,000 hard cap. The `PASSWORD_PEPPER` Workers Secret compensates for the lower-than-OWASP-ideal iteration count at negligible extra CPU cost (a single HMAC-SHA256 pass).

## Migration Notes

`migrations/0003_create_sessions.sql` is a plain `CREATE TABLE`, not a shadow-table migration — no existing data to preserve since `sessions` is new. No changes to the existing `users` table are needed for this slice.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01, `auth-and-registration`)
- PRD: `context/foundation/prd.md` (FR-001, FR-002, FR-003, Access Control section)
- Prior migration pattern: `migrations/0002_users_email_schema.sql` (shadow-table pattern, for reference — not used here)
- Users table: `migrations/0001_create_users.sql`, `migrations/0002_users_email_schema.sql`
- Worker entry point (current): `src/worker/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — sessions table

#### Automated

- [x] 1.1 Migration applies cleanly locally: `npm run migrate:local`
- [x] 1.2 Migration applies cleanly to remote D1: `npm run migrate:remote`

#### Manual

- [x] 1.3 `sessions` table visible via `wrangler d1 execute`

### Phase 2: Backend test infrastructure

#### Automated

- [ ] 2.1 `npm run test:worker` runs successfully (empty/smoke suite)
- [ ] 2.2 `npm run typecheck` passes with `test/` included

### Phase 3: Backend — auth logic

#### Automated

- [ ] 3.1 `npm run test:worker` passes, including auth tests
- [ ] 3.2 `npm run typecheck` passes

#### Manual

- [ ] 3.3 curl flow: register → cookie + sessions row → `/api/me` → logout → `/api/me` 401
- [ ] 3.4 Duplicate email registration returns 409 with explicit message
- [ ] 3.5 Wrong-password login returns generic 401 message
- [ ] 3.6 `PASSWORD_PEPPER` secret set for local dev and remote before testing register/login
- [ ] 3.7 Measured CPU time of `/api/register`/`/api/login` fits the Workers Free plan's ~10ms budget; iterations tuned accordingly

### Phase 4: Frontend — auth end to end

#### Automated

- [ ] 4.1 `npm run typecheck` passes
- [ ] 4.2 `npm run build` succeeds

#### Manual

- [ ] 4.3 Visiting `/` with no session redirects to `/login`
- [ ] 4.4 Register → landed on home view with registered email
- [ ] 4.5 Refresh page → still authenticated, no redirect
- [ ] 4.6 Logout → redirected to `/login`; revisiting `/` redirects again
- [ ] 4.7 Duplicate-email registration shows inline "already registered" message
- [ ] 4.8 Wrong-password login shows generic invalid-credentials message
- [ ] 4.9 Full flow verified through `ng serve` + `proxy.conf.json` dev wiring
- [ ] 4.10 Session-expiry interceptor clears auth state and redirects to `/login` when a stale/revoked session hits a 401
