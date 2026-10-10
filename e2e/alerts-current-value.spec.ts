// E2E — current value column on the alerts list. Risk: context/foundation/
// test-plan.md Risk #4 (Angular surfaces regress silently), rendering facet.
// Generated via /10x-e2e from e2e/prompts/alerts-user-flows.prompt.md, modeled
// on e2e/seed.spec.ts.
//
// The real value depends on whatever market data the local D1 holds, so
// GET /api/alerts is fulfilled at the network layer with fixed numbers while
// auth, router, list rendering and number formatting stay real. A broad guard
// aborts any other /api/alerts call; the narrow mock is registered after it
// (Playwright runs the most recently registered matching route). Server-side
// JOIN logic is covered by worker tests. Nothing is persisted, so there is
// nothing to clean up.
//
// The dev server runs the `development-pl` build: the pl `number` pipe renders
// a comma decimal separator.

import { test, expect } from '@playwright/test';

interface MockAlert {
  id: number;
  alertType: 'PRICE' | 'RSI';
  threshold: number;
  currentPrice: number | null;
  currentRsi: number | null;
}

function alert(name: string, a: MockAlert) {
  return {
    ticker: name,
    instrumentName: name,
    instrumentType: 'index',
    currency: 'USD',
    direction: 'up',
    active: true,
    notificationEmail: 'e2e@e2e.market-pulse.test',
    createdAt: 1,
    updatedAt: 1,
    currentHigh: null,
    currentLow: null,
    ...a,
  };
}

test.describe('alerts list current value (test-plan.md Risk #4 — rendering facet)', () => {
  test('shows the formatted price and RSI, and a dash when there is no market data', async ({
    page,
  }) => {
    await page.route('**/api/alerts**', (route) => route.abort());
    await page.route(/\/api\/alerts$/, (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          alert('E2E-PRICE', {
            id: 1,
            alertType: 'PRICE',
            threshold: 100,
            currentPrice: 123.45,
            currentRsi: null,
          }),
          alert('E2E-RSI', {
            id: 2,
            alertType: 'RSI',
            threshold: 70,
            currentPrice: null,
            currentRsi: 55.5,
          }),
          alert('E2E-EMPTY', {
            id: 3,
            alertType: 'PRICE',
            threshold: 200,
            currentPrice: null,
            currentRsi: null,
          }),
        ]),
      });
    });

    await page.goto('/alerts');

    await expect(page.getByText('Bieżąca wartość', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /E2E-RSI.*55,50$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /E2E-EMPTY.*200,00 USD\s*—$/ })).toBeVisible();
  });
});
