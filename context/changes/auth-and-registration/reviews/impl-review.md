<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth & Registration Implementation Plan

- **Plan**: context/changes/auth-and-registration/plan.md
- **Scope**: Full plan (Phases 1-4 of 4)
- **Date**: 2026-07-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Grounding

`npm run typecheck` ✓, `npm run test:worker` ✓ (12/12 passed), `npm run build` ✓. All 4 phases' Progress checkboxes are `[x]` with commit SHAs; all Manual Verification items were confirmed by the user during implementation (not rubber-stamped — each corresponds to a bug report/fix cycle visible in the session).

## Findings

### F1 — Login endpoint has a timing side-channel that leaks email existence

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/auth.ts:64
- **Detail**: The plan explicitly calls out (Critical Implementation Details) that login must return a generic message "regardless of whether the email is unknown or the password is wrong" as a deliberate anti-enumeration mitigation. The message is correctly generic, but `!user || !(await verifyPassword(...))` short-circuits on an unknown email — no PBKDF2 work happens — while a known email always pays the full hash-verify cost. An attacker can still distinguish the two cases by response latency, defeating the stated intent of the mitigation.
- **Fix**: When `user` is null, still run `verifyPassword` against a fixed dummy hash (e.g. a hardcoded `pbkdf2-sha256$...` value generated once at module load) before returning 401, so both code paths cost the same.
  - Strength: Closes the exact side-channel the plan's mitigation was meant to close, using the same primitive already in `password.ts`.
  - Tradeoff: Every failed login (including truly-unknown emails) now always pays full PBKDF2 cost — a marginal CPU increase on an already CPU-budget-constrained plan (per `project_workers_pbkdf2_cap` constraint), though negligible next to the cost the known-email path already pays.
  - Confidence: HIGH — standard mitigation for this exact class of timing leak.
  - Blind spot: Whether this app's threat model actually cares about email enumeration timing (no rate limiting exists yet either, by design — see "What We're NOT Doing").
- **Decision**: FIXED — always run verifyPassword against a dummy hash on unknown email (src/worker/routes/auth.ts)

### F2 — Bootstrap session check can hijack initial navigation away from public routes

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/app/core/auth/session-expired.interceptor.ts:11-19, src/app/app.config.ts:18-21
- **Detail**: `provideAppInitializer` calls `authService.checkSession()` (→ `GET /api/me`) before the router's initial navigation runs. For any anonymous visitor, this call always 401s. That 401 is caught by the global `sessionExpiredInterceptor`, which unconditionally calls `router.navigateByUrl('/login')` — this fires during app initialization, before the router has performed its own initial navigation to whatever URL the user actually requested. A fresh, unauthenticated visit to `/register` (a public route, not guard-protected) would be forced to `/login` instead of showing the register form. This exact path was never manually verified — Progress item 4.3 only checked `/` (which correctly redirects to `/login` anyway, masking the bug there).
- **Fix A ⭐ Recommended**: Only redirect on 401 if the user was previously authenticated (`authService.currentUser() !== null` at the moment the error is caught, checked before `clearSession()` runs).
  - Strength: One-line guard; the bootstrap call's 401 is inherently a "was never logged in" case (currentUser is still its initial `null`), so this naturally distinguishes it from a genuine mid-session expiry without any request-tagging plumbing.
  - Tradeoff: A truly-expired session that expires between page loads (not mid-session) also starts from `currentUser === null` at bootstrap, so this fix correctly no-ops there too — no over-redirect, but also no forced redirect on a stale cookie hitting `/me` at bootstrap. That's fine since `authGuard` already handles the guarded-route case via `isAuthenticated()`.
  - Confidence: HIGH — matches how the guard already reasons about auth state.
  - Blind spot: Doesn't verify there's no other legitimate 401 (e.g., a future non-auth API 401) that would want the old unconditional behavior.
- **Fix B**: Tag the bootstrap `checkSession()` request (e.g. via `HttpContext`) and have the interceptor skip the redirect specifically for that tagged request.
  - Strength: Keeps "redirect on any 401, from anyone, at any time" as the interceptor's general rule — more predictable for future protected endpoints.
  - Tradeoff: More moving parts (context token, wiring in two files) for a fix that Fix A achieves with one line.
  - Confidence: MEDIUM — correct but unverified against Angular's `HttpContext` API specifics in v22.
  - Blind spot: Whether `HttpContext` survives through `firstValueFrom`/`provideAppInitializer`'s call path unchanged.
- **Decision**: FIXED via Fix A — session-expired.interceptor.ts only redirects when `currentUser()` was non-null before the 401

### F3 — Unplanned scope (Material redesign, routing fix, branding) not folded back into plan.md

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/auth-and-registration/plan.md
- **Detail**: Four substantive changes landed that the plan text never mentions: (1) `@angular/material` + `@angular/cdk` adoption with Material-based register/login/home UI, replacing the plan's "minimal placeholder" framing; (2) the `wrangler.toml` `[assets] binding = "ASSETS"` fix + catch-all route in `src/worker/index.ts`, a real SPA-routing bug found only through manual testing; (3) `src/index.html` title/favicon changes; (4) `src/app/app.html`/`app.ts` Angular CLI scaffold cleanup. All four were discussed and approved by the user interactively during implementation, so this is not silent scope creep — but the plan document itself is now out of sync with what was actually built, which will confuse a future reader treating `plan.md` as ground truth.
- **Fix**: Append a short "Addendum" section to plan.md (or update the Phase 3/4 Changes Required text) noting these four additions and why they happened.
- **Decision**: FIXED — added "Addendum (post-implementation)" section to plan.md

### F4 — No upper bound on password length before PBKDF2/HMAC

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/auth.ts:26 (register), :56 (login)
- **Detail**: Only `MIN_PASSWORD_LENGTH` (8) is enforced; there's no maximum. An oversized password body adds CPU cost feeding into PBKDF2 (register) or an HMAC+PBKDF2 verify (login), on a project whose Free-plan CPU budget is already the reason the iteration count is capped at 10,000 (see `password.ts`'s comment and the plan's Critical Implementation Details).
- **Fix**: Reject passwords over a reasonable cap (e.g. 128 chars) in the same validation block as `MIN_PASSWORD_LENGTH`, on both `/register` and `/login`.
- **Decision**: FIXED — added MAX_PASSWORD_LENGTH (128) check to both /register and /login (src/worker/routes/auth.ts)

### F5 — Cookie name hardcoded as a literal instead of the shared constant

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker/routes/auth.ts:75
- **Detail**: `getCookie(c, 'session_id')` in the logout handler uses a string literal, while `session.ts` exports `SESSION_COOKIE_NAME` and uses it consistently elsewhere (`setSessionCookie`, `clearSessionCookie`, `sessionMiddleware`). Risk of silent drift if the cookie name is ever renamed.
- **Fix**: Import and use `SESSION_COOKIE_NAME` from `../lib/session` in `auth.ts:75`.
- **Decision**: FIXED — auth.ts now imports and uses SESSION_COOKIE_NAME

### F6 — Stale/invalid session cookie isn't cleared on a failed validation

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/lib/session.ts (sessionMiddleware)
- **Detail**: When a request carries a cookie whose session is missing/expired, `sessionMiddleware` returns 401 but never calls `clearSessionCookie(c)`. The browser keeps resending the dead session id on every subsequent request until an explicit logout, costing an extra D1 lookup each time.
- **Fix**: Call `clearSessionCookie(c)` before returning 401 in the invalid/expired branch of `sessionMiddleware`.
- **Decision**: FIXED — session.ts now clears the cookie in the invalid/expired-session branch

### F7 — sessions.user_id has no ON DELETE CASCADE

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: migrations/0003_create_sessions.sql:3
- **Detail**: `user_id INTEGER NOT NULL REFERENCES users(id)` has no cascade action. SQLite FK actions are opt-in, so deleting a user (no such flow exists yet) would leave orphaned session rows rather than cleaning them up. Low urgency today since there's no user-delete path in this plan or the roadmap yet.
- **Fix**: Add `ON DELETE CASCADE` to the FK now, while the table is empty and a migration is cheap.
- **Decision**: FIXED — added migrations/0004_sessions_cascade_delete.sql (shadow-table pattern), applied and verified locally. Remote apply (`npm run migrate:remote`) left for the user — production DB migration is human-only.

### F8 — Malformed JSON body falls through to a bare 500 instead of 400

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker/routes/auth.ts:22, 52
- **Detail**: `c.req.json()` isn't wrapped in try/catch in either `/register` or `/login`. A non-JSON or malformed body throws and falls through to Hono's default error handler (an unstyled 500) instead of the clean 400 the rest of the validation logic produces.
- **Fix**: Wrap the `c.req.json()` call in try/catch (or a shared helper) and return the existing 400/401 validation-error shape on parse failure.
- **Decision**: FIXED — added parseCredentialsBody() helper in auth.ts, used by both /register and /login
