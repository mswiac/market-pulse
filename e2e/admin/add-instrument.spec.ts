// E2E — admin "Add instrument" screen. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions), applied by
// analogy: the screen writes to D1 and the UI must send exactly what the admin
// typed (ticker normalized) and refresh the instrument list. Generated via
// /10x-e2e from e2e/prompts/admin-management.prompt.md, modeled on
// e2e/seed.spec.ts and e2e/admin/admin-gate-pass.spec.ts.
//
// Nothing is mocked: UI → POST /api/admin/instruments → local D1. The instrument
// is proved to exist by finding it in the picker after a full page load, i.e.
// from GET /api/instruments, not from client-side state. afterEach deletes the
// run-unique ticker through the admin API.
//
// Runs only in the `chromium-admin` project. The dev server runs the
// `development-pl` build, so the accessible names below are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect } from '@playwright/test';
import { deleteInstrument, instrumentName, uniqueTicker } from './admin-api';

let ticker: string;

test.beforeEach(() => {
  ticker = uniqueTicker();
});

test.afterEach(async ({ request }) => {
  await deleteInstrument(request, ticker);
});

test.describe('add instrument admin screen (test-plan.md Risk #8 — destructive-action UI, create facet)', () => {
  test('a submitted instrument is saved with an uppercased ticker and is selectable in the instrument picker after a reload', async ({
    page,
  }) => {
    await page.goto('/admin/add-instrument');
    await expect(page.getByRole('heading', { name: 'Dodaj instrument' })).toBeVisible();

    // The ticker is typed in lowercase; leaving the field normalizes it.
    await page.getByLabel('Ticker', { exact: true }).fill(ticker.toLowerCase());
    await page.getByLabel('Nazwa spółki').fill(instrumentName(ticker));
    await expect(page.getByLabel('Ticker', { exact: true })).toHaveValue(ticker);

    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/instruments') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Dodaj instrument' }).click();
    expect((await created).status()).toBe(201);
    await expect(page.getByText(`Dodano instrument ${ticker}.`)).toBeVisible();

    // A full page load re-reads the instrument list from the server: the new
    // instrument must be there, found by its (uppercased) ticker.
    await page.goto('/admin/remove-instrument');
    const picker = page.getByRole('combobox', { name: 'Instrument' });
    await picker.fill(ticker);
    await expect(
      page.getByRole('option', { name: new RegExp(`${ticker} — ${instrumentName(ticker)}`) }),
    ).toBeVisible();
  });

  test('picking the PL companies type prefills PLN and the submitted instrument is created with it', async ({
    page,
  }) => {
    await page.goto('/admin/add-instrument');

    await page.getByRole('combobox', { name: 'Typ' }).click();
    await page.getByRole('option', { name: 'Spółki PL' }).click();
    await expect(page.getByRole('combobox', { name: 'Waluta' })).toHaveText('PLN');

    await page.getByLabel('Ticker', { exact: true }).fill(ticker);
    await page.getByLabel('Nazwa spółki').fill(instrumentName(ticker));

    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/instruments') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Dodaj instrument' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ type: 'pl_stock', currency: 'PLN' });
  });
});
