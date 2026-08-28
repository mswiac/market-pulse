# E2E generation prompt — admin-gate redirect

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md` § "10xDevs AI Toolkit -
Module 3, Lesson 4") are the levers — this file carries only what they can't
know.

```text
We are adding an E2E test for this risk from context/foundation/test-plan.md:
§3 Phase 6 — "admin-gate redirect", a second client-side facet of Risk #6
(authorization boundary). A logged-in user who is NOT an admin must not be
able to reach the admin panel through the router.

Research anchor:
test-plan.md §3 Phase 6. adminGuard (src/app/core/auth/admin.guard.ts) guards
the four /admin* routes (app.routes.ts) — returns createUrlTree(['/']) unless
authService.currentUser()?.isAdmin. isAdmin is derived server-side from
ADMIN_EMAILS (src/worker/lib/admin.ts) and returned by GET /api/me, so it is
real per-session state, not a client toggle. The shell also hides the whole
"Administrator" nav group behind @if (isAdmin()) (src/app/core/shell/shell.html).
This is complementary to auth-gate-redirect.spec.ts, which only covers the
UNauthenticated case (parent authGuard).

Business scenario (one observable behavior that must stay true after this flow):
A logged-in non-admin who navigates to /admin, /admin/add-instrument,
/admin/remove-instrument, or /admin/remove-user ends up on / (the home shell,
"Twoje alerty" heading) and the "Administrator" nav group is not rendered.

Real boundaries (do not mock — the risk hides here):
storageState (a non-admin session), GET /api/me (isAdmin: false), adminGuard,
Angular Router, shell rendering.

Mocked boundaries (mock at network layer):
None.

Write a Playwright test following seed.spec.ts patterns and the E2E rules.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression this test catches.
```

**Regression caught:** if `adminGuard` stops redirecting non-admins, this test
goes red instead of silently exposing the admin panel (instrument/user
removal) to every authenticated user.
