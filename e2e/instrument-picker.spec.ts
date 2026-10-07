// E2E — searchable instrument picker on the instrument history page.
// Risk: the type → instrument cascade was replaced by one type-ahead field
// (issue #160); a regression would leave the history page unable to select an
// instrument at all, or silently show data for the wrong one.
//
// The dev server runs the `development-pl` build — accessible names below are
// the Polish strings from src/locale/messages.pl.xlf. Read-only: creates no
// data, so there is nothing to clean up.

import { test, expect } from '@playwright/test';

test('instrument history: searching by name selects the instrument and shows its history table', async ({ page }) => {
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Historia walorów' })).toBeVisible();
  await expect(page.getByText('Wybierz instrument, aby zobaczyć jego historię.')).toBeVisible();

  const instrument = page.getByRole('combobox', { name: 'Instrument' });
  await instrument.fill('nasdaq');
  await page.getByRole('option', { name: /NASDAQ-100/ }).click();

  await expect(instrument).toHaveValue(/NASDAQ-100/);
  await expect(page.getByRole('columnheader', { name: 'Zamknięcie' })).toBeVisible();
  await expect(page.getByText('Wybierz instrument, aby zobaczyć jego historię.')).toBeHidden();
});

test('instrument history: text matching nothing stays in the field with a hint and selects nothing', async ({ page }) => {
  await page.goto('/history');

  const instrument = page.getByRole('combobox', { name: 'Instrument' });
  await instrument.fill('zzzzqq');
  await expect(page.getByRole('option', { name: 'Brak wyników' })).toBeVisible();

  await page.getByRole('heading', { name: 'Historia walorów' }).click();

  await expect(instrument).toHaveValue('zzzzqq');
  await expect(page.getByText('Wybierz instrument z listy')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Zamknięcie' })).toBeHidden();
});
