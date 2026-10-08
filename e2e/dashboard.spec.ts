// E2E — dashboard (Pulpit) landing page (issue #167).
// Risk: the dashboard replaced the alerts list at `/`; a regression would leave
// users landing on a broken/empty page, or lose the route to their alerts.
//
// The dev server runs the `development-pl` build — accessible names below are
// the Polish strings from src/locale/messages.pl.xlf. Read-only: creates no
// data, so there is nothing to clean up.

import { test, expect } from '@playwright/test';

test('dashboard: landing page lists instruments and filtering narrows the table', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pulpit' })).toBeVisible();

  const ndxRow = page.getByRole('row', { name: /NASDAQ-100/ });
  const vixRow = page.getByRole('row', { name: /VIX/ });
  await expect(ndxRow).toBeVisible();
  await expect(vixRow).toBeVisible();

  await page.getByRole('combobox', { name: 'Instrument' }).fill('nasdaq');
  await page.getByRole('option', { name: /NASDAQ-100/ }).click();

  await expect(ndxRow).toBeVisible();
  await expect(vixRow).toBeHidden();

  await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
  await expect(vixRow).toBeVisible();
});

test('dashboard: the Alerty menu item opens the alerts page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Alerty', exact: true }).click();

  await page.waitForURL('**/alerts');
  await expect(page.getByRole('heading', { name: 'Twoje alerty' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nowy alert' })).toBeVisible();
});
