// Auth setup — runs once at the start of every `playwright test` run (the
// `chromium` project depends on it), logs in through the real login form and
// writes the session to playwright/.auth/user.json. Every spec then starts
// authenticated via `storageState` (playwright.config.ts) — no spec repeats
// the login flow. See Playwright docs "Authentication".
//
// Credentials come from E2E_EMAIL / E2E_PASSWORD, loaded from e2e/.env by
// playwright.config.ts (gitignored). The account must already exist in the
// local D1; this never creates it.

import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set E2E_EMAIL and E2E_PASSWORD (env or e2e/.env) to a local dev account before running E2E tests.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Hasło').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();

  // Successful login navigates to '/' and renders the authenticated shell.
  await page.waitForURL('/');
  await expect(page.getByRole('heading', { name: 'Twoje alerty' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
