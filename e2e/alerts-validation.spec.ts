// E2E — alert form validation. Risk: context/foundation/test-plan.md Risk #4
// (Angular alert form regresses silently), validation facet. Generated via
// /10x-e2e from e2e/prompts/alerts-user-flows.prompt.md, modeled on
// e2e/seed.spec.ts.
//
// One test per case. The client-side cases must show their message AND send no
// POST /api/alerts (nothing is saved); the duplicate case goes to the real
// server, which answers 409, and must show a message instead of a second row.
// Requests are recorded from the synchronous `request` event so a late POST
// cannot slip past an assertion.
//
// Alerts created here (the duplicate original) are removed by id in afterEach.
// The dev server runs the `development-pl` build, so accessible names are the
// Polish targets from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';
import { createAlert, deleteAlert, thresholdPattern, uniqueThreshold } from './alerts-api';

let alertId: number | undefined;

test.afterEach(async ({ request }) => {
  if (alertId !== undefined) await deleteAlert(request, alertId);
  alertId = undefined;
});

function recordCreatePosts(page: Page): string[] {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.url());
  });
  return posts;
}

async function openFormWithNasdaq(page: Page) {
  await page.goto('/alerts');
  await page.getByRole('button', { name: 'Nowy alert' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nowy alert' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Instrument' }).fill('NASDAQ');
  await page.getByRole('option', { name: /NASDAQ-100/ }).click();
  return dialog;
}

test.describe('alert form validation (test-plan.md Risk #4 — alert form, validation facet)', () => {
  test('an empty threshold shows "Pole wymagane." and the form cannot be submitted', async ({
    page,
  }) => {
    const posts = recordCreatePosts(page);
    const dialog = await openFormWithNasdaq(page);

    const threshold = dialog.getByRole('spinbutton', { name: /Próg/ });
    await threshold.focus();
    await threshold.blur();

    await expect(dialog.getByText('Pole wymagane.').first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Utwórz alert' })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  test('a price threshold of 0 shows the "greater than 0" message and nothing is saved', async ({
    page,
  }) => {
    const posts = recordCreatePosts(page);
    const dialog = await openFormWithNasdaq(page);

    const threshold = dialog.getByRole('spinbutton', { name: /Próg/ });
    await threshold.fill('0');
    // Material shows field errors only once the control is touched.
    await threshold.blur();

    await expect(dialog.getByText('Wartość musi być większa od 0.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Utwórz alert' })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  test('an RSI threshold above 100 shows the 0–100 range message and nothing is saved', async ({
    page,
  }) => {
    const posts = recordCreatePosts(page);
    const dialog = await openFormWithNasdaq(page);

    await dialog.getByRole('combobox', { name: 'Typ alertu' }).click();
    await page.getByRole('option', { name: 'RSI', exact: true }).click();
    const threshold = dialog.getByRole('spinbutton', { name: /Próg/ });
    await threshold.fill('101');
    await threshold.blur();

    await expect(dialog.getByText('Wartość musi mieścić się w zakresie 0–100.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Utwórz alert' })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  test('a duplicate alert shows "Taki alert już istnieje." instead of saving a second row', async ({
    page,
    request,
  }) => {
    const threshold = uniqueThreshold();
    alertId = await createAlert(request, threshold);

    const dialog = await openFormWithNasdaq(page);
    await dialog.getByRole('spinbutton', { name: /Próg/ }).fill(threshold.toFixed(2));

    const rejected = page.waitForResponse(
      (r) => r.url().endsWith('/api/alerts') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Utwórz alert' }).click();
    expect((await rejected).status()).toBe(409);

    await expect(dialog.getByText('Taki alert już istnieje.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: thresholdPattern(threshold) })).toHaveCount(1);
  });
});
