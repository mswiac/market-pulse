// E2E — alerts list filtering (issue #159). Risk: with many alerts a user must
// be able to narrow the list, and filters must never hide alerts permanently
// (clearing restores the full list).
//
// Modeled on e2e/delete-alert.spec.ts: getByRole locators, wait-for-state,
// random thresholds so parallel runs don't collide on the alerts UNIQUE
// constraint, and an afterEach sweep that deletes this run's alerts via the API.
//
// The dev server runs the `development-pl` build — accessible names below are
// the Polish targets from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';

const createdThresholds = new Set<string>();

const randomThreshold = (min: number, spread: number) => {
  const value = (min + Math.floor(Math.random() * spread) / 100).toFixed(2);
  createdThresholds.add(value);
  return value;
};

const rowFor = (page: Page, label: string, threshold: string) =>
  page.getByRole('button', { name: new RegExp(`NASDAQ-100.*${label}.*${threshold.replace('.', '[.,]')}`) });

async function createNdxAlert(page: Page, alertType: 'Cena' | 'RSI', threshold: string) {
  await page.getByRole('button', { name: 'Nowy alert' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nowy alert' })).toBeVisible();

  await dialog.getByRole('combobox', { name: 'Instrument' }).fill('NASDAQ');
  await page.getByRole('option', { name: /NASDAQ-100/ }).click();
  await dialog.getByRole('combobox', { name: 'Typ alertu' }).click();
  await page.getByRole('option', { name: alertType, exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Próg' }).fill(threshold);

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/alerts') && r.request().method() === 'POST' && r.ok(),
  );
  await dialog.getByRole('button', { name: 'Utwórz alert' }).click();
  await created;
  await expect(dialog).toBeHidden();
}

test.afterEach(async ({ page }) => {
  if (createdThresholds.size === 0) return;
  const res = await page.request.get('/api/alerts');
  if (res.ok()) {
    const alerts = (await res.json()) as { id: number; ticker: string; threshold: number }[];
    for (const a of alerts) {
      if (a.ticker === '^NDX' && createdThresholds.has(Number(a.threshold).toFixed(2))) {
        await page.request.delete(`/api/alerts/${a.id}`);
      }
    }
  }
  createdThresholds.clear();
});

test.describe('alerts list filtering (issue #159)', () => {
  test('filtering by alert type narrows the list and clearing restores it', async ({ page }) => {
    // Price under 1000 so no locale groups digits; RSI must stay within 0-100.
    const priceThreshold = randomThreshold(10, 89_000);
    const rsiThreshold = randomThreshold(1, 9_800);

    await page.goto('/');
    await createNdxAlert(page, 'Cena', priceThreshold);
    await createNdxAlert(page, 'RSI', rsiThreshold);

    const priceRow = rowFor(page, 'Próg cenowy', priceThreshold);
    const rsiRow = rowFor(page, 'Próg RSI', rsiThreshold);
    await expect(priceRow).toBeVisible();
    await expect(rsiRow).toBeVisible();

    await page.getByRole('combobox', { name: 'Typ alertu' }).click();
    await page.getByRole('option', { name: 'Próg RSI' }).click();

    await expect(rsiRow).toBeVisible();
    await expect(priceRow).toBeHidden();

    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();

    await expect(priceRow).toBeVisible();
    await expect(rsiRow).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wyczyść filtry' })).toBeHidden();
  });
});
