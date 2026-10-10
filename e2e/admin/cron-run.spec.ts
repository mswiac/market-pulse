// E2E — Force data refresh admin page. Risk: context/foundation/test-plan.md
// Risk #8 (admin panel UI for destructive / irreversible actions), applied by
// analogy: Risk #8 names the delete-confirm dialogs, and this page has the same
// shape — a confirm dialog gating an irreversible action, plus a truthful
// rendering of its outcome. Generated via /10x-e2e from
// e2e/prompts/cron-run.prompt.md, modeled on e2e/seed.spec.ts and
// e2e/admin/admin-gate-pass.spec.ts.
//
// The page sends three POST /api/admin/cron/run requests (fetch pl, fetch
// other, evaluate) only after the confirm dialog. That endpoint is mocked at
// the network layer — a real call would hit Yahoo and send real emails — while
// the admin session, guard, router, dialog and results rendering stay real.
// Server logic is covered by worker tests.
//
// Runs only in the `chromium-admin` project (storageState from
// admin-auth.setup.ts). Nothing is persisted, so there is nothing to clean up.
// The dev server runs the `development-pl` build, so the accessible names below
// are the Polish targets from src/locale/messages.pl.xlf.

import { test, expect, type Page } from '@playwright/test';

interface CronRunSummary {
  tickers: { ticker: string; status: 'ok' | 'error'; error?: string }[];
  alertsEvaluated: number;
  emails: { alertId: number; ticker: string; status: 'sent' | 'failed'; error?: string }[];
  errors: string[];
}

interface MockedResponse {
  status?: number;
  body: CronRunSummary;
}

interface CronRunRequestBody {
  phase: 'fetch' | 'evaluate';
  market?: 'pl' | 'other';
}

const EMPTY: CronRunSummary = { tickers: [], alertsEvaluated: 0, emails: [], errors: [] };

// Fulfils each of the page's three calls from the matching entry and records
// every cron-run POST body in the order it is sent. Installed before
// navigation so no click can ever reach the real endpoint. The endpoint sends
// real emails, so a broad guard aborts any /api/admin call the narrow mock
// does not match (e.g. after a URL change) — the test then fails instead of
// triggering a real refresh. Playwright runs the most recently registered
// matching route, so the narrow mock must be registered after the guard.
// Requests are recorded from the synchronous `request` event, not from the
// route handler, so a request sent late cannot slip past an assertion.
async function mockCronRun(
  page: Page,
  responses: { fetchPl?: MockedResponse; fetchOther?: MockedResponse; evaluate?: MockedResponse },
): Promise<CronRunRequestBody[]> {
  const requests: CronRunRequestBody[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/admin/cron/run')) {
      requests.push(request.postDataJSON() as CronRunRequestBody);
    }
  });
  await page.route('**/api/admin/**', (route) => route.abort());
  await page.route('**/api/admin/cron/run', async (route) => {
    const body = route.request().postDataJSON() as CronRunRequestBody;
    const picked =
      body.phase === 'evaluate'
        ? responses.evaluate
        : body.market === 'pl'
          ? responses.fetchPl
          : responses.fetchOther;
    const { status = 200, body: json } = picked ?? { body: EMPTY };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  return requests;
}

async function triggerAndConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Wymuś aktualizację danych' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Wymuś', exact: true }).click();
}

test.describe('force data refresh admin page (test-plan.md Risk #8 — destructive-action UI, browser facet)', () => {
  test('a clean run shows OK tickers, the evaluated count, no emails and no Errors section', async ({
    page,
  }) => {
    const requests = await mockCronRun(page, {
      fetchPl: { body: { ...EMPTY, tickers: [{ ticker: 'E2E-GOOD-PL', status: 'ok' }] } },
      fetchOther: { body: { ...EMPTY, tickers: [{ ticker: 'E2E-GOOD-OTHER', status: 'ok' }] } },
      evaluate: { body: { ...EMPTY, alertsEvaluated: 3 } },
    });

    await page.goto('/admin/cron-run');
    await triggerAndConfirm(page);

    // The pipeline fetched both markets, then evaluated (stale-data guard
    // depends on evaluation running last).
    await expect(page.getByRole('heading', { name: 'Tickery' })).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { phase: 'fetch', market: 'pl' },
        { phase: 'fetch', market: 'other' },
      ]),
    );
    expect(requests[2]).toEqual({ phase: 'evaluate' });

    for (const ticker of [/E2E-GOOD-PL/, /E2E-GOOD-OTHER/]) {
      await expect(
        page.getByRole('row', { name: ticker }).getByRole('cell', { name: 'OK', exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText('Ocenione alerty: 3')).toBeVisible();
    await expect(page.getByText('Nie wysłano żadnych e-maili.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Błędy' })).toHaveCount(0);
  });

  test('a failed ticker in a 207 response shows its error status and message in the Tickers table', async ({
    page,
  }) => {
    await mockCronRun(page, {
      fetchPl: { body: { ...EMPTY, tickers: [{ ticker: 'E2E-GOOD-PL', status: 'ok' }] } },
      fetchOther: {
        status: 207,
        body: {
          ...EMPTY,
          tickers: [
            { ticker: 'E2E-BAD-TICKER', status: 'error', error: 'Upstream returned no rows' },
          ],
        },
      },
    });

    await page.goto('/admin/cron-run');
    await triggerAndConfirm(page);

    const failedRow = page.getByRole('row', { name: /E2E-BAD-TICKER/ });
    await expect(failedRow).toBeVisible();
    await expect(failedRow).toContainText('Błąd');
    await expect(failedRow).toContainText('Upstream returned no rows');

    // The healthy ticker is not tainted by its neighbour's failure.
    const healthyRow = page.getByRole('row', { name: /E2E-GOOD-PL/ });
    await expect(healthyRow.getByRole('cell', { name: 'OK', exact: true })).toBeVisible();
    await expect(healthyRow).not.toContainText('Błąd');
  });

  test('run-level errors in a 207 response are listed in the Errors section', async ({ page }) => {
    await mockCronRun(page, {
      fetchPl: { body: { ...EMPTY, tickers: [{ ticker: 'E2E-GOOD-PL', status: 'ok' }] } },
      evaluate: {
        status: 207,
        body: {
          ...EMPTY,
          errors: ['Stale market data for E2E-STALE', 'Failed to load alerts for evaluation'],
        },
      },
    });

    await page.goto('/admin/cron-run');
    await triggerAndConfirm(page);

    await expect(page.getByRole('heading', { name: 'Błędy' })).toBeVisible();
    // Exactly these two messages, in the list that holds them.
    const errorsList = page
      .getByRole('list')
      .filter({ hasText: 'Stale market data for E2E-STALE' });
    await expect(errorsList.getByRole('listitem')).toHaveText([
      'Stale market data for E2E-STALE',
      'Failed to load alerts for evaluation',
    ]);
  });

  test('cancelling the confirm dialog sends no request and shows no results', async ({ page }) => {
    const requests = await mockCronRun(page, {});

    await page.goto('/admin/cron-run');
    const trigger = page.getByRole('button', { name: 'Wymuś aktualizację danych' });
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Wymusić aktualizację danych teraz?' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(dialog).toBeHidden();

    // A run started by the cancel would disable the button synchronously
    // (submitting) and then render results; neither happens.
    await expect(trigger).toBeEnabled();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    expect(requests).toHaveLength(0);
    await expect(page.getByRole('heading', { name: 'Tickery' })).toHaveCount(0);
  });
});
