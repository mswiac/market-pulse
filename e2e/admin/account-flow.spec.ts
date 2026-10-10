// E2E — account flow. Risks: context/foundation/test-plan.md Risk #4 (auth form
// input handling) and Risk #6 (session boundary after logout). Generated via
// /10x-e2e from e2e/prompts/account-flow.prompt.md, modeled on e2e/seed.spec.ts
// and e2e/admin/remove-user.spec.ts.
//
// Nothing is mocked: UI → /api/register | /api/login | /api/logout → session
// cookie → authGuard → D1. The browser starts anonymous (empty storageState).
// Users are global rows only an admin can delete, so this lives under
// e2e/admin/ and afterEach removes every user the test created through a
// separate request context carrying the admin session — looked up by email, so
// cleanup also works when the test failed before it saw the user's id.
//
// The dev server runs the `development-pl` build, so the accessible names below
// are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect, type Page, type Playwright } from '@playwright/test';
import { registerUser, uniqueSuffix, type RegisteredUser } from './admin-api';

test.use({ storageState: { cookies: [], origins: [] } });

const createdEmails = new Set<string>();

test.afterEach(async ({ playwright, baseURL }) => {
  if (createdEmails.size === 0) return;
  const admin = await playwright.request.newContext({
    baseURL,
    storageState: 'playwright/.auth/admin.json',
  });
  try {
    const res = await admin.get('/api/admin/users');
    expect(res.ok()).toBeTruthy();
    const { users } = (await res.json()) as { users: { id: number; email: string }[] };
    for (const user of users.filter((u) => createdEmails.has(u.email))) {
      const del = await admin.delete(`/api/admin/users/${user.id}`);
      expect([200, 404]).toContain(del.status());
    }
  } finally {
    await admin.dispose();
    createdEmails.clear();
  }
});

async function registeredViaApi(playwright: Playwright, baseURL: string): Promise<RegisteredUser> {
  const user = await registerUser(playwright, baseURL);
  createdEmails.add(user.email);
  return user;
}

async function submitCredentials(
  page: Page,
  button: string,
  user: Pick<RegisteredUser, 'email' | 'password'>,
): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Hasło', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: button }).click();
}

test.describe('account flow (test-plan.md Risk #4 auth forms, Risk #6 session boundary)', () => {
  test('a new user can register, log out, and log back in with the same credentials', async ({
    page,
  }) => {
    const user = {
      email: `e2e-${uniqueSuffix().toLowerCase()}@e2e.market-pulse.test`,
      password: `E2e-${uniqueSuffix()}-pw`,
    };
    createdEmails.add(user.email);

    await page.goto('/register');
    await submitCredentials(page, 'Zarejestruj się', user);
    await expect(page.getByRole('heading', { name: 'Pulpit' })).toBeVisible();

    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is really gone: a protected page sends the visitor back.
    await page.goto('/alerts');
    await expect(page).toHaveURL(/\/login$/);

    await submitCredentials(page, 'Zaloguj się', user);
    await expect(page.getByRole('heading', { name: 'Pulpit' })).toBeVisible();
  });

  test('a wrong password shows the invalid-credentials error and keeps the user on the login page', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const user = await registeredViaApi(playwright, baseURL!);

    await page.goto('/login');
    await submitCredentials(page, 'Zaloguj się', {
      email: user.email,
      password: `${user.password}x`,
    });

    await expect(page.getByText('Nieprawidłowy e-mail lub hasło.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Pulpit' })).toHaveCount(0);
  });

  test('registering an already-registered email shows the taken message and does not log in', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const user = await registeredViaApi(playwright, baseURL!);

    await page.goto('/register');
    await submitCredentials(page, 'Zarejestruj się', user);

    await expect(page.getByText('Ten adres e-mail jest już zarejestrowany.')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'Pulpit' })).toHaveCount(0);
  });
});
