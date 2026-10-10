// E2E — history pages smoke. Risk: context/foundation/test-plan.md Risk #4
// (Angular surfaces have little automated coverage), reachability facet.
// Generated via /10x-e2e from e2e/prompts/history-smoke.prompt.md, modeled on
// e2e/seed.spec.ts.
//
// Trigger history runs against the real backend and does not depend on seeded
// events: it asserts the page heading, that either the table or the empty state
// is rendered, and that the load-error message is absent. Instrument history
// keeps the router, instrument list and picker real but fulfils
// GET /api/instruments/:ticker/history with fixed rows, because real closes
// depend on whatever market data the local D1 holds (server-side history logic
// is covered by worker tests). Nothing is persisted, so there is nothing to
// clean up.
//
// The dev server runs the `development-pl` build: the pl `number` pipe renders
// a comma decimal separator.

import { test, expect } from '@playwright/test';

test.describe('history pages smoke (test-plan.md Risk #4 — Angular surfaces)', () => {
  test('trigger history loads and shows a table or the empty state, never the load error', async ({
    page,
  }) => {
    await page.goto('/history/triggers');

    await expect(page.getByRole('heading', { name: 'Uruchomione alerty' })).toBeVisible();
    await expect(
      page.getByRole('table').or(page.getByText('Brak jeszcze uruchomionych alertów.')),
    ).toBeVisible();
    await expect(page.getByText('Nie udało się załadować historii alertów.')).toHaveCount(0);
  });

  test('picking an instrument on instrument history renders its closes', async ({ page }) => {
    await page.route('**/api/instruments/*/history', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ticker: '^NDX',
          rsiEligible: true,
          currency: 'USD',
          history: [
            { date: '2026-10-08', close: 111.11, high: 112, low: 110, rsi: 50 },
            { date: '2026-10-09', close: 222.22, high: 223, low: 221, rsi: 55 },
          ],
        }),
      }),
    );

    await page.goto('/history');
    await expect(page.getByText('Wybierz instrument, aby zobaczyć jego historię.')).toBeVisible();

    await page.getByRole('combobox', { name: 'Instrument' }).fill('NASDAQ');
    await page.getByRole('option', { name: /NASDAQ-100/ }).click();

    await expect(page.getByRole('columnheader', { name: 'Zamknięcie' })).toBeVisible();
    await expect(page.getByRole('row', { name: /2026-10-09.*222,22 USD/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /2026-10-08.*111,11 USD/ })).toBeVisible();
    await expect(page.getByText('Wybierz instrument, aby zobaczyć jego historię.')).toHaveCount(0);
  });
});
