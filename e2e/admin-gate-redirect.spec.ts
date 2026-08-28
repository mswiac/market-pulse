// E2E — admin-gate redirect. Risk: context/foundation/test-plan.md §3 Phase 6,
// second client-side facet of Risk #6 (authorization boundary). Generated via
// /10x-e2e (standalone) from e2e/prompts/admin-gate-redirect.prompt.md, modeled
// on e2e/seed.spec.ts.
//
// A logged-in NON-admin must not reach the admin panel through the router:
// adminGuard (src/app/core/auth/admin.guard.ts) redirects to / unless
// currentUser().isAdmin, and the shell hides the "Administrator" nav group
// behind @if (isAdmin()). isAdmin is real per-session state (server-derived
// from ADMIN_EMAILS, returned by GET /api/me), not a client toggle. This
// complements auth-gate-redirect.spec.ts, which covers only the UNauthenticated
// case (parent authGuard).
//
// Seed patterns: getByRole locators, wait-for-state, self-contained and
// independently runnable, name tied to the risk. Auth via storageState — the
// default `setup` account (e2e/.env) is a non-admin, which is exactly what this
// scenario needs, so no per-test login.
//
// The dev server runs the `development-pl` build, so the accessible names below
// are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';

const ADMIN_ROUTES = [
  '/admin',
  '/admin/add-instrument',
  '/admin/remove-instrument',
  '/admin/remove-user',
] as const;

test.describe('admin-gate redirect (test-plan.md §3 Phase 6 — Risk #6, admin authorization boundary)', () => {
  for (const route of ADMIN_ROUTES) {
    test(`a non-admin visiting ${route} is redirected to the home shell`, async ({ page }) => {
      await page.goto(route);

      // adminGuard -> createUrlTree(['/']): we land on the home shell, not the
      // admin panel.
      await page.waitForURL('/');
      await expect(page.getByRole('heading', { name: 'Twoje alerty' })).toBeVisible();

      // The admin nav group must not render for a non-admin.
      await expect(page.getByRole('button', { name: 'Administrator' })).toBeHidden();
    });
  }
});
