// Shared data helpers for the alert specs. Alerts are unique per
// (user, ticker, type, threshold), so every helper works on a threshold that is
// unique to one call, and cleanup deletes only the exact alert a test created.

import { expect, type APIRequestContext } from '@playwright/test';

export const NASDAQ_TICKER = '^NDX';

// Random 2-decimal value in [10, 900). Under 1000 so no locale groups the
// digits; the pl `number` pipe renders the decimal separator as a comma, so
// text locators built from it match either "." or ",".
export function uniqueThreshold(): number {
  return Number((10 + Math.floor(Math.random() * 89_000) / 100).toFixed(2));
}

// Anchored so 55.50 does not also match 155.50 or 1 055,50 (the pl locale
// groups thousands with a no-break space).
export function thresholdPattern(threshold: number): RegExp {
  const digits = threshold.toFixed(2).replace('.', '[.,]');
  return new RegExp(`(?<![\\d.,\\u00a0\\u202f])${digits}(?!\\d)`);
}

export async function createAlert(
  request: APIRequestContext,
  threshold: number,
  alertType: 'PRICE' | 'RSI' = 'PRICE',
): Promise<number> {
  const res = await request.post('/api/alerts', {
    data: {
      ticker: NASDAQ_TICKER,
      alertType,
      threshold,
      notificationEmail: 'e2e@e2e.market-pulse.test',
      direction: 'up',
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

export async function deleteAlert(request: APIRequestContext, id: number): Promise<void> {
  // 404 when the test already removed it — that is the success path.
  const res = await request.delete(`/api/alerts/${id}`);
  expect([200, 204, 404]).toContain(res.status());
}
