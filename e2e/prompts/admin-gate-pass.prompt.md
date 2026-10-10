# E2E generation prompt — admin gate pass

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md` § "10xDevs AI Toolkit -
Module 3, Lesson 4") are the levers — this file carries only what they can't
know.

```text
We are adding an E2E test for this risk from context/foundation/test-plan.md:
Risk #6 (authorization boundary), the positive facet: a logged-in ADMIN must
get through the admin gate. This is the inverse of admin-gate-redirect.spec.ts
(non-admin is sent home) — without it, an over-strict guard that locks out
everyone, admins included, would stay green.

Research anchor:
adminGuard (src/app/core/auth/admin.guard.ts) returns true only when
authService.currentUser()?.isAdmin. isAdmin is derived server-side from
ADMIN_EMAILS (src/worker/lib/admin.ts) and returned by GET /api/me. The shell
shows the "Administrator" nav group (pl build, shell.nav.admin) behind
@if (isAdmin()) (src/app/core/shell/shell.html). The /admin route renders the
"Pobierz dane giełdowe" heading (adminPanel.title).

Business scenario (one observable behavior that must stay true after this flow):
A logged-in admin sees the "Administrator" nav group and a direct visit to
/admin stays on /admin and renders the admin panel, instead of being
redirected to the home shell.

Real boundaries (do not mock — the risk hides here):
storageState (the admin session from the setup-admin project), GET /api/me
(isAdmin: true), adminGuard, Angular Router, shell rendering.

Mocked boundaries (mock at network layer):
None.

Write a Playwright test following seed.spec.ts patterns and the E2E rules.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression this test catches.
```

**Regression caught:** if `adminGuard` (or the `isAdmin` derivation) starts
rejecting admins, this test goes red instead of silently locking every admin
out of the admin panel.
