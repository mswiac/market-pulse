// E2E — admin "Remove instrument" screen. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions): a confirm
// dialog gates an irreversible delete, and the delete must hit the instrument
// that was picked. Generated via /10x-e2e from
// e2e/prompts/admin-management.prompt.md, modeled on e2e/seed.spec.ts,
// e2e/admin/admin-gate-pass.spec.ts and e2e/delete-alert.spec.ts.
//
// The instrument list, the impact preview and the DELETE are mocked in the
// browser with a small stateful stub. Adding an instrument through the real
// endpoint asks Yahoo (e2e must not), and seeding the local D1 from outside the
// Worker races its own writes (SQLITE_BUSY), so nothing here touches the
// database. That the delete really cascades is covered by
// test/worker/admin.test.ts.
//
// Runs only in the `chromium-admin` project. The dev server runs the
// `development-pl` build, so the accessible names below are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';
import { instrumentName, uniqueTicker } from './admin-api';

let ticker: string;
let instruments: {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: boolean;
  currency: string;
}[];
let deletes: string[];

test.beforeEach(async ({ page }) => {
  ticker = uniqueTicker();
  // A second instrument stays in the list: with an empty list the screen shows
  // its "no instruments" state instead of the picker.
  instruments = [
    { ticker, name: instrumentName(ticker), type: 'us_stock', rsiEligible: false, currency: 'USD' },
    {
      ticker: 'E2EKEEP',
      name: 'E2E Instrument Kept',
      type: 'us_stock',
      rsiEligible: false,
      currency: 'USD',
    },
  ];
  deletes = [];

  await page.route(
    (url) => url.pathname === '/api/instruments',
    (route) => route.fulfill({ json: instruments }),
  );
  await page.route(
    (url) => url.pathname === `/api/admin/instruments/${ticker}/impact`,
    (route) => route.fulfill({ json: { ticker, alertsCount: 2 } }),
  );
  // Records every DELETE the page sends, for any ticker, so a delete aimed at
  // the wrong instrument cannot go unnoticed.
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().includes('/api/admin/instruments/')) {
      deletes.push(new URL(request.url()).pathname);
    }
  });
  await page.route(
    (url) => url.pathname === `/api/admin/instruments/${ticker}`,
    (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      instruments = instruments.filter((i) => i.ticker !== ticker);
      return route.fulfill({ json: { ticker, alertsDeleted: 2 } });
    },
  );
});

async function pickAndRequestRemoval(page: Page): Promise<void> {
  await page.goto('/admin/remove-instrument');
  await page.getByRole('combobox', { name: 'Instrument' }).fill(ticker);
  await page.getByRole('option', { name: new RegExp(`^${ticker} `) }).click();
  await page.getByRole('button', { name: 'Usuń instrument' }).click();
}

test.describe('remove instrument admin screen (test-plan.md Risk #8 — destructive-action UI, instrument facet)', () => {
  test('confirming the dialog sends the delete for the picked instrument and the picker stops offering it', async ({
    page,
  }) => {
    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Usunąć ten instrument?' })).toBeVisible();
    await expect(dialog.getByText(`Instrument: ${ticker}`)).toBeVisible();

    const removed = page.waitForRequest(
      (r) => r.url().endsWith(`/api/admin/instruments/${ticker}`) && r.method() === 'DELETE',
    );
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    await removed;
    await expect(page.getByText(`Usunięto ${ticker}`)).toBeVisible();
    expect(deletes).toEqual([`/api/admin/instruments/${ticker}`]);

    // The screen re-reads the list after the delete, so the picker no longer
    // finds the ticker.
    await page.getByRole('combobox', { name: 'Instrument' }).fill(ticker);
    await expect(page.getByRole('option', { name: 'Brak wyników' })).toBeVisible();
  });

  test('cancelling the dialog removes nothing', async ({ page }) => {
    await pickAndRequestRemoval(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Instrument: ${ticker}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();

    // The screen is usable again (submit re-enabled) and no delete was sent.
    await expect(page.getByRole('button', { name: 'Usuń instrument' })).toBeEnabled();
    expect(deletes).toHaveLength(0);
    await page.getByRole('combobox', { name: 'Instrument' }).fill(ticker);
    await expect(page.getByRole('option', { name: new RegExp(`^${ticker} `) })).toBeVisible();
  });
});
