// E2E — admin "Remove instrument" screen. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions): a confirm
// dialog gates an irreversible delete, and the delete must hit the instrument
// that was picked and really persist. Generated via /10x-e2e from
// e2e/prompts/admin-management.prompt.md, modeled on e2e/seed.spec.ts,
// e2e/admin/admin-gate-pass.spec.ts and e2e/delete-alert.spec.ts.
//
// Nothing is mocked: UI → GET .../impact → dialog → DELETE → local D1. Each test
// creates its own run-unique instrument through the admin API and afterEach
// deletes it (a 404 after a successful UI delete is fine).
//
// Runs only in the `chromium-admin` project. The dev server runs the
// `development-pl` build, so the accessible names below are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';
import {
  createInstrument,
  deleteInstrument,
  listInstrumentTickers,
  uniqueTicker,
} from './admin-api';

let ticker: string;

test.beforeEach(async ({ request }) => {
  ticker = uniqueTicker();
  await createInstrument(request, ticker);
});

test.afterEach(async ({ request }) => {
  await deleteInstrument(request, ticker);
});

async function pickAndRequestRemoval(page: Page): Promise<void> {
  await page.goto('/admin/remove-instrument');
  await page.getByRole('combobox', { name: 'Instrument' }).fill(ticker);
  await page.getByRole('option', { name: new RegExp(`^${ticker} `) }).click();
  await page.getByRole('button', { name: 'Usuń instrument' }).click();
}

test.describe('remove instrument admin screen (test-plan.md Risk #8 — destructive-action UI, instrument facet)', () => {
  test('confirming the dialog removes the picked instrument from the picker and the server', async ({
    page,
    request,
  }) => {
    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Usunąć ten instrument?' })).toBeVisible();
    await expect(dialog.getByText(`Instrument: ${ticker}`)).toBeVisible();

    const removed = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/admin/instruments/${ticker}`) && r.request().method() === 'DELETE',
    );
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByText(`Usunięto ${ticker}`)).toBeVisible();

    // Gone for real: not in the server's list, and not offered by the picker
    // after a full reload.
    expect(await listInstrumentTickers(request)).not.toContain(ticker);
    await page.reload();
    await page.getByRole('combobox', { name: 'Instrument' }).fill(ticker);
    await expect(page.getByRole('option', { name: 'Brak wyników' })).toBeVisible();
  });

  test('cancelling the dialog removes nothing', async ({ page, request }) => {
    const deletes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().includes('/api/admin/instruments/'))
        deletes.push(r.url());
    });

    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Instrument: ${ticker}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();

    // The screen is usable again (submit re-enabled) and no delete was sent.
    await expect(page.getByRole('button', { name: 'Usuń instrument' })).toBeEnabled();
    expect(deletes).toHaveLength(0);
    expect(await listInstrumentTickers(request)).toContain(ticker);
  });
});
