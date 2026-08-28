# E2E generation prompt — auth-gate redirect

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md` for one
standalone risk. The seed test (`e2e/seed.spec.ts`) and the E2E rules
(`CLAUDE.md` § "10xDevs AI Toolkit - Module 3, Lesson 4") are the quality
levers — this file only carries what they can't know.

```text
We are adding an E2E test for this risk from context/foundation/test-plan.md:
§3 Phase 6 — "auth-gate redirect", the client-side facet of Risk #6
(cross-user isolation / authorization boundary). An unauthenticated browser
that reaches a protected route, or a browser whose D1 session expires
mid-session, must be sent to /login by the Angular auth layer rather than
rendering protected content.

Research anchor:
test-plan.md §3 Phase 6 scope note. Two browser-only mechanisms:
- authGuard (src/app/core/auth/auth.guard.ts) guards the '' shell route
  (/, /history, /admin) — returns createUrlTree(['/login']) when
  AuthService.isAuthenticated() is false.
- session-expired.interceptor.ts — on any HTTP 401 calls clearSession() and,
  only if the user was authenticated this session, navigateByUrl('/login').
app.config.ts runs checkSession() (GET /api/me) in an APP_INITIALIZER before
the first navigation, so a fresh protected-page load has currentUser set —
which is why the mid-session case must be triggered by an in-app action, not
a full reload (a reload re-runs the initializer with currentUser still null,
so the guard, not the interceptor, would do the redirect).

Business scenario (one observable behavior that must stay true after this flow):
1. A logged-out browser opening /, /history, or /admin ends up on /login with
   the login form visible and never renders the app shell.
2. A logged-in browser whose next API call returns 401 (session gone
   server-side) ends up on /login, leaves the protected shell, and raises no
   uncaught error.

Real boundaries (do not mock — the risk hides here):
Browser cookie jar / storageState, authGuard, Angular Router, the Worker
session-validation middleware (GET /api/me, GET /api/instruments).

Mocked boundaries (mock at network layer):
Scenario 2 only — page.route('**/api/**') fulfilling 401 to simulate the D1
session being deleted server-side mid-session. No external API is involved.

Write a Playwright test following seed.spec.ts patterns and the E2E rules.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression this test catches.
```

**Regression caught:** if `authGuard` stops redirecting logged-out users, or
`session-expired.interceptor` stops routing an expired session to `/login`,
this test goes red instead of silently exposing protected pages.
