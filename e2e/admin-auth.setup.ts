// Admin auth setup — the admin twin of auth.setup.ts. Runs once per
// `playwright test` run (the `chromium-admin` project depends on it), logs in
// through the real login form as an administrator and writes the session to
// playwright/.auth/admin.json. Specs under e2e/admin/ start authenticated as
// that admin via `storageState` (playwright.config.ts).
//
// Credentials come from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, loaded from the
// same gitignored env file as the user credentials. The account must already
// exist in the local D1 AND its email must be listed in the Worker's
// ADMIN_EMAILS — that is what makes `isAdmin` true. This never creates it.

import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (env or the local e2e env file) to a local dev admin account (listed in ADMIN_EMAILS) before running E2E tests.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Hasło').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();

  // Successful login navigates to '/' and renders the authenticated shell.
  await page.waitForURL('/');
  await expect(page.getByRole('heading', { name: 'Pulpit' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
