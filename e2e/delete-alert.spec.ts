// E2E — alert deletion via confirm dialog. Risk: context/foundation/test-plan.md
// §3 Phase 6, the dialog-guarded-destructive-action + persistence facet in the
// Risk #4 / Risk #8 area. Generated via /10x-e2e (standalone) from
// e2e/prompts/delete-alert.prompt.md, modeled on e2e/seed.spec.ts.
//
// alert-list.ts opens the delete-alert-confirm MatDialog and only calls
// AlertsService.delete() (DELETE /api/alerts/:id -> D1) when the dialog closes
// truthy. delete() optimistically drops the row from the alerts signal, so the
// list updates before any reload — the reload is what proves the DELETE
// actually persisted server-side.
//
// Seed patterns: getByRole locators, wait-for-state, unique threshold per
// alert, self-contained tests, names tied to the risk. An afterEach sweeps any
// alert this run created (matched by the run's own thresholds) via the API, so
// re-runs don't hit the alerts UNIQUE(user_id, ticker, alert_type, threshold)
// constraint even if a test fails before its own cleanup.
//
// The dev server runs the `development-pl` build — accessible names below are
// the Polish targets from src/locale/messages.pl.xlf.

import { test, expect, type Page, type Locator } from '@playwright/test';

const createdThresholds = new Set<string>();

async function createPriceAlert(page: Page): Promise<{ thresholdText: RegExp; panel: Locator }> {
  // Random 2-decimal value in [10, 900). Under 1000 so no locale groups the
  // digits; the pl `number` pipe renders the decimal separator as a comma, so
  // the locator matches either "." or ",". Random (not Date.now) so the two
  // tests never collide on the alerts UNIQUE constraint when run in parallel.
  const threshold = (10 + Math.floor(Math.random() * 89_000) / 100).toFixed(2);
  createdThresholds.add(threshold);
  const thresholdText = new RegExp(`NASDAQ-100.*${threshold.replace('.', '[.,]')}`);

  await page.goto('/');
  await page.getByRole('button', { name: 'Nowy alert' }).click();
  await expect(page.getByRole('heading', { name: 'Nowy alert' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Instrument' }).click();
  await page.getByRole('option', { name: 'NASDAQ-100' }).click();
  await page.getByRole('spinbutton', { name: 'Próg' }).fill(threshold);

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/alerts') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByRole('button', { name: 'Utwórz alert' }).click();
  await created;
  await expect(page.getByRole('heading', { name: 'Nowy alert' })).toBeHidden();

  const panel = page.getByRole('button', { name: thresholdText });
  await expect(panel).toBeVisible();
  return { thresholdText, panel };
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

test.describe('alert deletion via confirm dialog (test-plan.md §3 Phase 6)', () => {
  test('confirming the delete dialog removes the alert permanently', async ({ page }) => {
    // Two alerts: one to delete, one as an anchor. The anchor lets a post-reload
    // "still gone" assertion mean something — without it, `toBeHidden()` passes
    // in the window after reload() before the list has fetched anything.
    const target = await createPriceAlert(page);
    const anchor = await createPriceAlert(page);

    await target.panel.click(); // expand to reveal the action row
    const deleted = page.waitForResponse(
      (r) => /\/api\/alerts\/\d+/.test(r.url()) && r.request().method() === 'DELETE' && r.ok(),
    );
    await page
      .getByRole('region', { name: target.thresholdText })
      .getByRole('button', { name: 'Usuń alert' })
      .click();
    await expect(page.getByRole('heading', { name: 'Usunąć ten alert?' })).toBeVisible();
    await page.getByRole('button', { name: 'Usuń', exact: true }).click();
    await deleted;

    await expect(target.panel).toBeHidden();
    await expect(anchor.panel).toBeVisible();

    // The actual risk: the DELETE must have persisted. After a reload, wait for
    // the anchor to re-render (the list has loaded), then the deleted alert must
    // still be absent.
    await page.reload();
    await expect(page.getByRole('button', { name: anchor.thresholdText })).toBeVisible();
    await expect(page.getByRole('button', { name: target.thresholdText })).toBeHidden();
  });

  test('cancelling the delete dialog keeps the alert', async ({ page }) => {
    const { thresholdText, panel } = await createPriceAlert(page);

    await panel.click();
    await page
      .getByRole('region', { name: thresholdText })
      .getByRole('button', { name: 'Usuń alert' })
      .click();
    await expect(page.getByRole('heading', { name: 'Usunąć ten alert?' })).toBeVisible();
    await page.getByRole('button', { name: 'Anuluj', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Usunąć ten alert?' })).toBeHidden();
    await expect(page.getByRole('button', { name: thresholdText })).toBeVisible();

    // Still there after a reload — cancel did not delete it server-side.
    await page.reload();
    await expect(page.getByRole('button', { name: thresholdText })).toBeVisible();
  });
});
