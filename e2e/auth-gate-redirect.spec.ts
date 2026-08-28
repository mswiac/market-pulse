// E2E — auth-gate redirect. Risk: context/foundation/test-plan.md §3 Phase 6,
// client-side facet of Risk #6 (authorization boundary). Generated via
// /10x-e2e (standalone) from e2e/prompts/auth-gate-redirect.prompt.md, modeled
// on e2e/seed.spec.ts.
//
// Two browser-only failure modes of MarketPulse's auth layer — neither is
// reachable from a worker/unit test (they need a real Angular Router plus a
// real browser cookie jar):
//   1. authGuard — a logged-out browser hitting a protected route
//      (/, /history, /admin) is redirected to /login and never renders the
//      shell.
//   2. session-expired.interceptor — a user authenticated THIS session, whose
//      D1 session then expires server-side (next API call → 401), is routed to
//      /login without the SPA throwing.
//
// Seed patterns applied: getByRole / getByLabel locators, wait-for-state (never
// wait-for-time), each test self-contained and independently runnable, names
// tied to the risk. Auth normally comes from storageState (the `setup` project
// writes playwright/.auth/user.json); the first describe overrides it with an
// empty state on purpose — that logged-out browser IS the scenario, so no UI
// login happens there.
//
// The dev server runs the `development-pl` build, so the accessible names in
// the locators below are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';

const PROTECTED_ROUTES = ['/', '/history', '/admin'] as const;

test.describe('auth-gate redirect (test-plan.md §3 Phase 6 — client-side auth boundary)', () => {
  test.describe('logged-out browser is sent to /login by authGuard', () => {
    // No stored session — this logged-out state is the scenario, not a
    // missing-setup gap, hence the local storageState override.
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const route of PROTECTED_ROUTES) {
      test(`visiting ${route} without a session redirects to /login`, async ({ page }) => {
        await page.goto(route);

        await page.waitForURL('**/login');
        await expect(page.getByRole('button', { name: 'Zaloguj się' })).toBeVisible();
        await expect(page.getByLabel('Hasło')).toBeVisible();
        // The protected shell must never have rendered.
        await expect(page.getByRole('button', { name: 'Wyloguj' })).toBeHidden();
      });
    }
  });

  test('a mid-session 401 (expired D1 session) sends an authenticated user to /login without crashing', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    // Authenticated via storageState. Load the protected home shell and let its
    // initial API calls settle, so the APP_INITIALIZER checkSession (GET
    // /api/me) has populated currentUser. session-expired.interceptor only
    // *redirects* (rather than silently clearing local state) when it sees
    // `wasAuthenticated`, and that is only true after a successful in-session
    // load — so the trigger below must be an in-app action, not a full reload.
    const alertsLoaded = page.waitForResponse(
      (r) => r.url().includes('/api/alerts') && r.request().method() === 'GET',
    );
    await page.goto('/');
    await alertsLoaded;
    await expect(page.getByRole('heading', { name: 'Twoje alerty' })).toBeVisible();

    // From here the server has "forgotten" the session: every API call 401s.
    await page.route('**/api/**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'session expired' }),
      });
    });

    // Opening the alert dialog fires the first in-session GET /api/instruments;
    // it 401s → session-expired.interceptor → navigateByUrl('/login').
    await page.getByRole('button', { name: 'Nowy alert' }).click();

    await page.waitForURL('**/login');
    await expect(page.getByRole('button', { name: 'Zaloguj się' })).toBeVisible();
    await expect(page.getByLabel('Hasło')).toBeVisible();

    // "without crashing": we left the protected shell, the login form is
    // interactive, and no uncaught exception reached the browser. The alert
    // dialog that fired the request is not asserted on — MatDialog doesn't
    // reliably auto-close on this client-side navigation, and a lingering
    // overlay is a cosmetic nit, not part of this risk.
    await expect(page.getByRole('heading', { name: 'Twoje alerty' })).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});
