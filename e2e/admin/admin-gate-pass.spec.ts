// E2E — admin-gate pass. Risk: context/foundation/test-plan.md Risk #6
// (authorization boundary), positive facet. Generated via /10x-e2e from
// e2e/prompts/admin-gate-pass.prompt.md, modeled on e2e/seed.spec.ts.
//
// The inverse of e2e/admin-gate-redirect.spec.ts: a logged-in ADMIN must get
// through adminGuard (src/app/core/auth/admin.guard.ts, true only when
// currentUser().isAdmin) and see the "Administrator" nav group. isAdmin is real
// per-session state (derived server-side from ADMIN_EMAILS, returned by
// GET /api/me), so this fails if the guard or the isAdmin derivation starts
// locking admins out.
//
// Runs only in the `chromium-admin` project (playwright.config.ts), whose
// storageState is the admin session written by admin-auth.setup.ts — no
// per-test login. Read-only: nothing to clean up.
//
// The dev server runs the `development-pl` build, so the accessible names below
// are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';

test.describe('admin-gate pass (test-plan.md Risk #6 — admin authorization boundary, positive facet)', () => {
  test('an admin visiting /admin stays on the admin panel and sees the Administrator nav group', async ({
    page,
  }) => {
    await page.goto('/admin');

    // adminGuard lets the admin through: no redirect to the home shell, and the
    // admin panel itself renders.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Pobierz dane giełdowe' })).toBeVisible();

    // The shell renders the admin nav group for an admin.
    await expect(page.getByRole('button', { name: 'Administrator' })).toBeVisible();
  });
});
