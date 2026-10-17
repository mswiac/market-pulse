// E2E — admin "Add instrument" screen. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions), applied by
// analogy: the screen writes to D1 and the UI must send exactly what the admin
// typed (ticker normalized) and show the outcome. Generated via /10x-e2e from
// e2e/prompts/admin-management.prompt.md, modeled on e2e/seed.spec.ts and
// e2e/admin/admin-gate-pass.spec.ts.
//
// POST /api/admin/instruments is mocked in the browser: the real endpoint asks
// Yahoo about the symbol, and e2e must not call Yahoo. The endpoint itself is
// covered by test/worker/admin.test.ts; here the risk is the form — what it
// sends and how it reports each outcome. Nothing is written, so no cleanup.
//
// Runs only in the `chromium-admin` project. The dev server runs the
// `development-pl` build, so the accessible names below are the Polish targets
// from src/locale/messages.pl.xlf.

import { test, expect, type Page, type Route } from '@playwright/test';
import { instrumentName, uniqueTicker } from './admin-api';

const ENDPOINT = '**/api/admin/instruments';

let ticker: string;

test.beforeEach(() => {
  ticker = uniqueTicker();
});

function created(overrides: Record<string, unknown> = {}) {
  return {
    ticker,
    name: instrumentName(ticker),
    type: 'us_stock',
    rsiEligible: false,
    provider: 'yahoo',
    currency: 'USD',
    suffix: '',
    currencyCorrectedFrom: null,
    ...overrides,
  };
}

// Only the POST is answered; anything else on the path (none today) passes through.
async function mockPost(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.route(ENDPOINT, (route) =>
    route.request().method() === 'POST' ? respond(route) : route.continue(),
  );
}

async function fillAndSubmit(page: Page): Promise<void> {
  await page.getByLabel('Ticker', { exact: true }).fill(ticker);
  await page.getByLabel('Nazwa spółki').fill(instrumentName(ticker));
  await page.getByRole('button', { name: 'Dodaj instrument' }).click();
}

test.describe('add instrument admin screen (test-plan.md Risk #8 — destructive-action UI, create facet)', () => {
  test('a submitted instrument is sent with an uppercased ticker and the success message names it', async ({
    page,
  }) => {
    await mockPost(page, (route) => route.fulfill({ status: 201, json: created() }));
    await page.goto('/admin/add-instrument');
    await expect(page.getByRole('heading', { name: 'Dodaj instrument' })).toBeVisible();

    // The ticker is typed in lowercase; leaving the field normalizes it.
    await page.getByLabel('Ticker', { exact: true }).fill(ticker.toLowerCase());
    await page.getByLabel('Nazwa spółki').fill(instrumentName(ticker));
    await expect(page.getByLabel('Ticker', { exact: true })).toHaveValue(ticker);

    const request = page.waitForRequest(
      (r) => r.url().endsWith('/api/admin/instruments') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Dodaj instrument' }).click();
    expect((await request).postDataJSON()).toMatchObject({
      ticker,
      name: instrumentName(ticker),
    });
    await expect(page.getByText(`Dodano instrument ${ticker}.`)).toBeVisible();
  });

  test('picking the PL companies type prefills PLN and the submitted instrument is sent with it', async ({
    page,
  }) => {
    await mockPost(page, (route) =>
      route.fulfill({ status: 201, json: created({ type: 'pl_stock', currency: 'PLN' }) }),
    );
    await page.goto('/admin/add-instrument');

    await page.getByRole('combobox', { name: 'Typ' }).click();
    await page.getByRole('option', { name: 'Spółki PL' }).click();
    await expect(page.getByRole('combobox', { name: 'Waluta' })).toHaveText('PLN');

    await page.getByLabel('Ticker', { exact: true }).fill(ticker);
    await page.getByLabel('Nazwa spółki').fill(instrumentName(ticker));

    const request = page.waitForRequest(
      (r) => r.url().endsWith('/api/admin/instruments') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Dodaj instrument' }).click();
    expect((await request).postDataJSON()).toMatchObject({ type: 'pl_stock', currency: 'PLN' });
  });

  test('the button reads "Sprawdzam dane…" and is disabled while the server checks the symbol', async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await mockPost(page, async (route) => {
      await gate;
      await route.fulfill({ status: 201, json: created() });
    });
    await page.goto('/admin/add-instrument');

    await fillAndSubmit(page);
    await expect(page.getByRole('button', { name: 'Sprawdzam dane…' })).toBeDisabled();

    release();
    await expect(page.getByText(`Dodano instrument ${ticker}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sprawdzam dane…' })).toHaveCount(0);
  });

  test('a currency corrected to Yahoo\'s is reported in the success message', async ({ page }) => {
    await mockPost(page, (route) =>
      route.fulfill({
        status: 201,
        json: created({ type: 'pl_stock', currency: 'USD', currencyCorrectedFrom: 'PLN' }),
      }),
    );
    await page.goto('/admin/add-instrument');

    await fillAndSubmit(page);
    await expect(
      page.getByText(`Dodano instrument ${ticker}. Waluta poprawiona z PLN na USD (według Yahoo).`),
    ).toBeVisible();
  });

  test('a symbol Yahoo does not know shows the not-found message', async ({ page }) => {
    await mockPost(page, (route) =>
      route.fulfill({
        status: 422,
        json: { error: 'Yahoo has no data for this symbol', code: 'instrument_symbol_not_found' },
      }),
    );
    await page.goto('/admin/add-instrument');

    await fillAndSubmit(page);
    await expect(
      page.getByText('Yahoo nie ma danych dla tego symbolu. Sprawdź ticker i sufiks.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj instrument' })).toBeEnabled();
  });

  test('a Yahoo outage shows the try-again message', async ({ page }) => {
    await mockPost(page, (route) =>
      route.fulfill({
        status: 502,
        json: {
          error: 'market data provider is unavailable',
          code: 'instrument_provider_unavailable',
        },
      }),
    );
    await page.goto('/admin/add-instrument');

    await fillAndSubmit(page);
    await expect(
      page.getByText('Dostawca danych rynkowych jest chwilowo niedostępny. Spróbuj ponownie.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj instrument' })).toBeEnabled();
  });
});
