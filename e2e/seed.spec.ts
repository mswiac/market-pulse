// Seed / exemplar E2E test — every generated test is modeled on this file.
// What you show is what you get: role-based locators, wait-for-state (never
// wait-for-time), a unique identifier in the test data, full self-contained
// cleanup, and a name tied to a risk.
//
// Risk (context/foundation/test-plan.md): Risk #4 — the Angular frontend
// (src/app/features) has near-zero automated coverage, and the Alert Form is
// the richest untested surface. This test exercises that surface at the only
// layer where it is real: the browser driving the form through auth → POST
// /api/alerts → D1 → re-render, and proving the alert survives a full reload
// (the lesson's canonical "data must survive the round trip" scenario).
//
// Assumptions this file does NOT set up (later practical-task steps do):
//   - playwright.config.ts with baseURL http://localhost:4200 + a webServer
//     block (or `npm start` running) against the -pl locale build.
//   - storageState auth: a `setup` project logs in once and writes
//     playwright/.auth/user.json; this test starts already authenticated.
// The dev server runs the `development-pl` configuration, so accessible names
// below are the Polish UI strings.

import { test, expect } from '@playwright/test';

test('alert created through the form persists after a page reload', async ({ page }) => {
  // Unique threshold → no collision with the alerts UNIQUE(user_id, ticker,
  // alert_type, threshold) constraint across parallel runs and re-runs, and a
  // value distinctive enough to assert on directly.
  // Under 1000 so no locale groups the digits; the pl `number` pipe in the
  // list renders the decimal separator as a comma, so match either "." or ",".
  const threshold = ((Date.now() % 90_000) / 100 + 10).toFixed(2);
  const thresholdText = new RegExp(`NASDAQ-100.*${threshold.replace('.', '[.,]')}`);

  await page.goto('/');

  // --- Create the alert -----------------------------------------------------
  await page.getByRole('button', { name: 'Nowy alert' }).click();
  await expect(page.getByRole('heading', { name: 'Nowy alert' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Instrument' }).click();
  await page.getByRole('option', { name: 'NASDAQ-100' }).click();

  await page.getByRole('spinbutton', { name: 'Próg' }).fill(threshold);

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/alerts') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByRole('button', { name: 'Utwórz alert' }).click();
  await created;

  // Dialog closes and the new alert is listed.
  await expect(page.getByRole('heading', { name: 'Nowy alert' })).toBeHidden();
  const alertPanel = page.getByRole('button', { name: thresholdText });
  await expect(alertPanel).toBeVisible();

  // --- The actual risk: it must survive a full reload ----------------------
  await page.reload();
  await expect(page.getByRole('button', { name: thresholdText })).toBeVisible();

  // --- Cleanup ------------------------------------------------------------
  await page.getByRole('button', { name: thresholdText }).click();
  await page
    .getByRole('region', { name: thresholdText })
    .getByRole('button', { name: 'Usuń alert' })
    .click();
  await page.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(page.getByRole('button', { name: thresholdText })).toBeHidden();
});
