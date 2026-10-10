// E2E — alert editing. Risk: context/foundation/test-plan.md Risk #4 (Angular
// alert form regresses silently), edit facet. Generated via /10x-e2e from
// e2e/prompts/alerts-user-flows.prompt.md, modeled on e2e/seed.spec.ts.
//
// The form is shared by create and edit; edit goes through PUT /api/alerts/:id.
// Reloading is what proves the new threshold was persisted server-side and the
// old one replaced, not just patched in the local signal.
//
// The alert under edit is created through the API (own setup) and removed by id
// in afterEach, so a failure mid-test cannot leave it behind. The dev server
// runs the `development-pl` build, so accessible names are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';
import { createAlert, deleteAlert, thresholdPattern, uniqueThreshold } from './alerts-api';

let alertId: number | undefined;

test.afterEach(async ({ request }) => {
  if (alertId !== undefined) await deleteAlert(request, alertId);
  alertId = undefined;
});

test.describe('alert editing (test-plan.md Risk #4 — alert form, edit facet)', () => {
  test('a changed threshold is saved and survives a reload, replacing the old value', async ({
    page,
    request,
  }) => {
    const oldThreshold = uniqueThreshold();
    // Rounded: float addition can leave 12.840000000000002, which the server
    // (fed the 2-decimal form value) would never store.
    const newThreshold = Number((oldThreshold + 0.5).toFixed(2));
    alertId = await createAlert(request, oldThreshold);

    await page.goto('/alerts');
    const oldPanel = page.getByRole('button', { name: thresholdPattern(oldThreshold) });
    await oldPanel.click();
    await page.getByRole('button', { name: 'Edytuj alert' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edytuj alert' })).toBeVisible();
    await dialog.getByRole('spinbutton', { name: /Próg/ }).fill(newThreshold.toFixed(2));

    const saved = page.waitForResponse(
      (r) => /\/api\/alerts\/\d+/.test(r.url()) && r.request().method() === 'PUT' && r.ok(),
    );
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await saved;
    await expect(dialog).toBeHidden();

    // The point of the risk: the new value is what the server now holds.
    await page.reload();
    await expect(page.getByRole('button', { name: thresholdPattern(newThreshold) })).toBeVisible();
    await expect(page.getByRole('button', { name: thresholdPattern(oldThreshold) })).toHaveCount(0);

    // The rendered text is only a substring match (1055.50 also contains 55.50),
    // so pin the exact stored value through the API.
    const res = await request.get('/api/alerts');
    const stored = ((await res.json()) as { id: number; threshold: number }[]).find(
      (a) => a.id === alertId,
    );
    expect(stored?.threshold).toBe(newThreshold);
  });
});
