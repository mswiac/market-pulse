// E2E — alert pause and resume. Covers the manual pause feature (GitHub issue
// #199): pausing goes through PATCH /api/alerts/:id, and a paused alert shows a
// "Wstrzymany" status that is distinct from the automatic Active/Inactive one.
// Reloading proves the flag was persisted server-side, not just patched into
// the local signal.
//
// The alert is created through the API (own setup) and removed by id in
// afterEach. The dev server runs the `development-pl` build, so accessible
// names are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';
import { createAlert, deleteAlert, thresholdPattern, uniqueThreshold } from './alerts-api';

let alertId: number | undefined;

test.afterEach(async ({ request }) => {
  if (alertId !== undefined) await deleteAlert(request, alertId);
  alertId = undefined;
});

test.describe('alert pause (issue #199)', () => {
  test('a paused alert shows the paused status across a reload and can be resumed', async ({
    page,
    request,
  }) => {
    const threshold = uniqueThreshold();
    alertId = await createAlert(request, threshold);

    await page.goto('/alerts');
    await page.getByRole('button', { name: thresholdPattern(threshold) }).click();

    const paused = page.waitForResponse(
      (r) => /\/api\/alerts\/\d+/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'Wstrzymaj alert' }).click();
    await paused;
    await expect(page.getByText('Wstrzymany', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: thresholdPattern(threshold) }).click();
    await expect(page.getByText('Wstrzymany', { exact: true })).toBeVisible();

    const resumed = page.waitForResponse(
      (r) => /\/api\/alerts\/\d+/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'Wznów alert' }).click();
    await resumed;
    await expect(page.getByText('Wstrzymany', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Wstrzymaj alert' })).toBeVisible();
  });
});
