# Auth & Registration — Plan Brief

> Full plan: `context/changes/auth-and-registration/plan.md`

## What & Why

Implement email + password registration, login, and logout (PRD FR-001/002/003, roadmap slice S-01). This is the first authenticated flow in MarketPulse and the prerequisite for every alert-management slice that follows (S-02 onward) — nobody can create or see an alert without an account.

## Starting Point

`users` table already has `email` (unique) + `password_hash` columns (F-01a). Nothing else exists: the Worker has a single `/health` route, the Angular app has an empty route table and no forms, and there is zero backend test tooling.

## Desired End State

A visitor can register with an email and password, is immediately logged in, and lands on a minimal home view showing their email with a logout button. Returning later (even after closing the browser, within the session window) keeps them logged in without re-authenticating. Logging out actually ends the session server-side — revisiting the app afterward requires logging in again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Session storage | D1-backed sessions table, sliding expiration | User wants full control over revocation (logout must actually invalidate, not just expire) | Plan |
| Password hashing | Web Crypto PBKDF2 + HMAC pepper (Workers Secret); iterations tuned (~10k default) to fit the Workers Free plan's ~10ms CPU budget, raised toward `workerd`'s 100k hard cap if measurement allows | `workerd` hard-caps PBKDF2 at 100k regardless of plan, and even 100k exceeds the Free plan's CPU budget (~50ms); the pepper compensates for the lower iteration count at negligible extra CPU cost | Plan (revised in plan-review triage) |
| Cookie transport | httpOnly, `SameSite=Lax`, `secure` derived from request protocol | Avoids XSS token theft; SameSite is deemed sufficient CSRF mitigation at this scale (no separate CSRF token) | Plan |
| Backend testing | Set up `@cloudflare/vitest-pool-workers` now | First real backend logic in the repo — cheaper to establish the test pattern now than retrofit later, and auth is security-sensitive code | Plan |
| Local dev wiring | `proxy.conf.json` proxying `/api/*` to `wrangler dev --local` | Keeps Angular live-reload while talking to the real Worker | Plan |
| Email verification | Not required — account active immediately | Not in PRD scope; avoids pulling Resend into this slice (it's not wired up until S-05) | Plan |
| Password reset | Explicitly deferred to a later slice | Same reason — needs Resend, not yet available | Plan |
| Login rate limiting | Explicitly deferred | Acceptable risk at MVP/single-user scale; PRD doesn't require it | Plan |
| Duplicate-email registration | Explicit "already registered" message | Better UX for the target (near-single) user base outweighs enumeration risk at this scale | Plan |
| Wrong-password login | Generic "invalid email or password" | Standard anti-enumeration practice, deliberately different from the registration answer above | Plan |
| Password strength | Minimum 8 characters only | Simple to implement on both ends; PBKDF2 iteration count is the real defense, not complexity rules | Plan |
| Priority if time runs short | Keep test coverage; degrade sliding expiration to a fixed TTL first | User explicitly ranked UX polish (sliding expiration) below having tests for security-sensitive code | Plan |

## Scope

**In scope:** register/login/logout endpoints, D1 sessions with sliding expiration, PBKDF2 hashing, backend test infra + tests, Angular register/login forms, route guard, session-expiry HTTP interceptor, minimal authenticated home placeholder, local dev proxy wiring.

**Out of scope:** email verification, password reset, login rate limiting, CSRF token (beyond `SameSite`), the real alert dashboard (S-02), multi-device session management UI.

## Architecture / Approach

Data model → backend (test infra, then auth logic) → frontend, in that dependency order. All backend routes move under a new `/api/*` namespace (including relocating `/health`) so Angular's client-side routes never collide with API paths once both are served from the same origin in production. The session-validation middleware is written generically so S-02's protected alert routes can reuse it without new session logic.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | `sessions` table migration | Low — new table, no shadow-table complexity |
| 2. Backend test infra | `@cloudflare/vitest-pool-workers` wired to real D1 migrations | New tooling in this repo — first time it's configured |
| 3. Backend auth logic | Hashing, register/login/logout/me endpoints, session middleware, tests | Cookie `secure` flag must be protocol-derived or local dev auth breaks; PBKDF2 iteration count must fit the Workers Free plan's CPU budget (`workerd` hard-caps at 100k regardless of plan, but that alone is still ~5x over the Free budget) — tune and benchmark, don't assume a textbook default works here |
| 4. Frontend auth | Dev proxy, `AuthService`, forms, guard, home placeholder, full manual flow | First Angular form + first route guard in the app — no existing pattern to lean on |

**Prerequisites:** F-01a (users table with email) — already done.
**Estimated effort:** ~3-4 sessions across 4 phases, within the 3-week MVP budget.

## Open Risks & Assumptions

- `@cloudflare/vitest-pool-workers`'s current API (the `cloudflareTest` plugin shape used in this plan) was verified against current Cloudflare docs/examples during planning, not against a locally-installed version — confirm the installed version matches this shape when Phase 2 starts, since the package is still evolving.
- The 10,000-iteration PBKDF2 default (and the ~10-15k realistic ceiling) is extrapolated from Cloudflare's own public figure of ~50ms for 100,000 iterations, not a direct benchmark of this Worker — Phase 3 must measure real CPU time and adjust before treating the number as final.
- The minimal home placeholder (Phase 4, item 6) is a scope call made during planning, not an explicit PRD requirement — it exists solely to give logout a UI surface and the guard something to protect; S-02 will replace it.

## Success Criteria (Summary)

- A user can register, land on an authenticated view, survive a page refresh, and log out — with the session actually revoked server-side on logout, not just cleared client-side.
- All backend auth logic (hashing, session lifecycle, all four endpoints) has automated test coverage via `@cloudflare/vitest-pool-workers`.
- The full flow works through both the production-style same-origin build and the local `ng serve` + `proxy.conf.json` dev setup.
