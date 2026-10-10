// E2E — admin "Remove user" screen. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions): a confirm
// dialog gates an irreversible account delete, which must hit the user that was
// picked, really persist, and the admin's own account must not be offered.
// Generated via /10x-e2e from e2e/prompts/admin-management.prompt.md, modeled on
// e2e/seed.spec.ts and e2e/admin/admin-gate-pass.spec.ts.
//
// Nothing is mocked: UI → GET .../impact → dialog → DELETE → local D1. Each test
// registers its own throwaway user (fresh request context, see admin-api.ts) and
// afterEach deletes it by id (a 404 after a successful UI delete is fine).
// "Really removed" is proved by the user no longer being able to log in.
//
// Runs only in the `chromium-admin` project. The dev server runs the
// `development-pl` build, so the accessible names below are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';
import { deleteUser, loginStatus, registerUser, type RegisteredUser } from './admin-api';

let user: RegisteredUser;
// Set only once registration succeeded, so a failed beforeEach neither makes
// afterEach throw (masking the real error) nor deletes a previous test's id.
let registeredId: number | undefined;

test.beforeEach(async ({ playwright, baseURL }) => {
  registeredId = undefined;
  user = await registerUser(playwright, baseURL!);
  registeredId = user.id;
});

test.afterEach(async ({ request }) => {
  if (registeredId !== undefined) await deleteUser(request, registeredId);
});

async function pickAndRequestRemoval(page: Page): Promise<void> {
  await page.goto('/admin/remove-user');
  await page.getByRole('combobox', { name: 'Użytkownik' }).click();
  await page.getByRole('option', { name: user.email, exact: true }).click();
  await page.getByRole('button', { name: 'Usuń użytkownika' }).click();
}

test.describe('remove user admin screen (test-plan.md Risk #8 — destructive-action UI, user facet)', () => {
  test('confirming the dialog removes the picked user, who can then no longer log in', async ({
    page,
    playwright,
    baseURL,
  }) => {
    expect(await loginStatus(playwright, baseURL!, user)).toBe(200);
    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Usunąć tego użytkownika?' })).toBeVisible();
    await expect(dialog.getByText(`Użytkownik: ${user.email}`)).toBeVisible();

    const removed = page.waitForResponse(
      (r) => r.url().endsWith(`/api/admin/users/${user.id}`) && r.request().method() === 'DELETE',
    );
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByText(`Usunięto ${user.email}`)).toBeVisible();

    // Gone for real: no longer offered, and the credentials stop working.
    await page.reload();
    await page.getByRole('combobox', { name: 'Użytkownik' }).click();
    await expect(page.getByRole('option', { name: user.email, exact: true })).toHaveCount(0);
    expect(await loginStatus(playwright, baseURL!, user)).toBe(401);
  });

  test('cancelling the dialog removes nothing', async ({ page, playwright, baseURL }) => {
    const deletes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().includes('/api/admin/users/')) deletes.push(r.url());
    });

    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Użytkownik: ${user.email}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('button', { name: 'Usuń użytkownika' })).toBeEnabled();
    expect(deletes).toHaveLength(0);
    expect(await loginStatus(playwright, baseURL!, user)).toBe(200);
  });

  test('an admin is not offered their own account in the list', async ({ page, request }) => {
    const meRes = await request.get('/api/me');
    expect(meRes.ok()).toBeTruthy();
    const me = (await meRes.json()) as { email: string };

    await page.goto('/admin/remove-user');
    await page.getByRole('combobox', { name: 'Użytkownik' }).click();
    // The list is loaded (our throwaway user is in it) but the admin is not.
    // The 403 cannot_delete_self contract is covered by test/worker/admin.test.ts;
    // a real DELETE of the admin's own id is deliberately not sent from here, as a
    // regressed guard would delete the local dev admin account.
    await expect(page.getByRole('option', { name: user.email, exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: me.email, exact: true })).toHaveCount(0);
  });
});
