import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const BASE_URL = 'https://example.com';
const PASSWORD = 'correct horse battery staple';

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('expected a Set-Cookie header');
  return setCookie.split(';')[0];
}

async function registerAndLogIn(email: string): Promise<string> {
  const response = await exports.default.fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return sessionCookieFrom(response);
}

function validAlertBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: '^VIX',
    alertType: 'PRICE',
    threshold: 20,
    notificationEmail: 'alerts@example.com',
    direction: 'up',
    ...overrides,
  };
}

async function createAlert(cookie: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(validAlertBody(overrides)),
  });
}

async function listAlerts(cookie?: string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/alerts`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function updateAlert(cookie: string, id: number, overrides: Record<string, unknown> = {}): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/alerts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(validAlertBody(overrides)),
  });
}

async function deleteAlert(cookie: string, id: number): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/alerts/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

describe('alerts endpoints', () => {
  // This project's D1 test binding isn't isolated per test (see scheduled.test.ts
  // and rsi-eligibility-triggers.test.ts for the same note) — market_data.ticker
  // is a PRIMARY KEY, so any test seeding it must start from a clean table or a
  // later insert for the same ticker collides.
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM market_data').run();
  });

  it('creates then lists a VIX/PRICE alert, including matching createdAt/updatedAt', async () => {
    const cookie = await registerAndLogIn('vix-price@example.com');

    const createResponse = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 18.42 });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      ticker: '^VIX',
      instrumentName: 'VIX',
      instrumentType: 'index',
      currency: 'USD',
      alertType: 'PRICE',
      threshold: 18.42,
      notificationEmail: 'alerts@example.com',
      direction: 'up',
      active: true,
      currentPrice: null,
      currentRsi: null,
    });
    expect(created['createdAt']).toBe(created['updatedAt']);

    const listResponse = await listAlerts(cookie);
    expect(listResponse.status).toBe(200);
    const alerts = (await listResponse.json()) as Record<string, unknown>[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      ticker: '^VIX',
      instrumentName: 'VIX',
      instrumentType: 'index',
      currency: 'USD',
      alertType: 'PRICE',
      threshold: 18.42,
      direction: 'up',
      active: true,
      currentPrice: null,
      currentRsi: null,
    });
  });

  it('creates then lists a NASDAQ-100/RSI alert', async () => {
    const cookie = await registerAndLogIn('nasdaq-rsi@example.com');

    const createResponse = await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: 70 });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      ticker: '^NDX',
      instrumentName: 'NASDAQ-100',
      instrumentType: 'index',
      currency: 'USD',
      alertType: 'RSI',
      threshold: 70,
      currentPrice: null,
      currentRsi: null,
    });

    const listResponse = await listAlerts(cookie);
    await expect(listResponse.json()).resolves.toMatchObject([
      {
        ticker: '^NDX',
        instrumentName: 'NASDAQ-100',
        instrumentType: 'index',
        currency: 'USD',
        alertType: 'RSI',
        threshold: 70,
        currentPrice: null,
        currentRsi: null,
      },
    ]);
  });

  it('returns seeded market data as currentPrice/currentRsi for a matching alert', async () => {
    const cookie = await registerAndLogIn('market-data-join@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^NDX', 4567.89, 62.5)
      .run();

    await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: 70 });

    const listResponse = await listAlerts(cookie);
    await expect(listResponse.json()).resolves.toMatchObject([
      { ticker: '^NDX', currentPrice: 4567.89, currentRsi: 62.5 },
    ]);
  });

  it('rejects an invalid instrument', async () => {
    const cookie = await registerAndLogIn('bad-instrument@example.com');
    const response = await createAlert(cookie, { ticker: 'SPX' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid instrument' });
  });

  it('rejects an invalid alert type', async () => {
    const cookie = await registerAndLogIn('bad-alerttype@example.com');
    const response = await createAlert(cookie, { alertType: 'MACD' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid alert type' });
  });

  it('rejects a non-numeric threshold', async () => {
    const cookie = await registerAndLogIn('nonnumeric-threshold@example.com');
    const response = await createAlert(cookie, { threshold: 'not a number' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('rejects a negative RSI threshold', async () => {
    const cookie = await registerAndLogIn('negative-rsi@example.com');
    const response = await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: -0.01 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('rejects an RSI threshold above 100', async () => {
    const cookie = await registerAndLogIn('over-100-rsi@example.com');
    const response = await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: 100.01 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('accepts an RSI threshold of exactly 0', async () => {
    const cookie = await registerAndLogIn('rsi-zero@example.com');
    const response = await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: 0 });
    expect(response.status).toBe(201);
  });

  it('accepts an RSI threshold of exactly 100', async () => {
    const cookie = await registerAndLogIn('rsi-hundred@example.com');
    const response = await createAlert(cookie, { ticker: '^NDX', alertType: 'RSI', threshold: 100 });
    expect(response.status).toBe(201);
  });

  it('rejects a price threshold of 0', async () => {
    const cookie = await registerAndLogIn('price-zero@example.com');
    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 0 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('accepts a price threshold with decimals', async () => {
    const cookie = await registerAndLogIn('price-decimal@example.com');
    const response = await createAlert(cookie, { ticker: '^NDX', alertType: 'PRICE', threshold: 4500.25 });
    expect(response.status).toBe(201);
  });

  it('rejects a malformed notification email', async () => {
    const cookie = await registerAndLogIn('bad-email@example.com');
    const response = await createAlert(cookie, { notificationEmail: 'not-an-email' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid notification email' });
  });

  it('rejects VIX + RSI with the specific error message', async () => {
    const cookie = await registerAndLogIn('vix-rsi@example.com');
    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'RSI', threshold: 50 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'RSI is not available for VIX' });
  });

  it('creates an alert with direction "down"', async () => {
    const cookie = await registerAndLogIn('direction-down@example.com');
    const response = await createAlert(cookie, { direction: 'down' });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ direction: 'down', active: true });
  });

  it('rejects an invalid direction', async () => {
    const cookie = await registerAndLogIn('bad-direction@example.com');
    const response = await createAlert(cookie, { direction: 'sideways' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid direction' });
  });

  it('starts an "up" alert inactive when the current price already meets the threshold', async () => {
    const cookie = await registerAndLogIn('armed-up-already-met@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 25, null)
      .run();

    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20, direction: 'up' });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ active: false });
  });

  it('starts a "down" alert inactive when the current price already meets the threshold', async () => {
    const cookie = await registerAndLogIn('armed-down-already-met@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 15, null)
      .run();

    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20, direction: 'down' });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ active: false });
  });

  it('starts a "down" alert inactive when only the day\'s low (not the close) already meets the threshold', async () => {
    const cookie = await registerAndLogIn('armed-down-low-already-met@example.com');
    // Close (25) is still above the threshold — only the intraday low (18) has
    // crossed it. computeArmed must use the same high/low-aware rule as the
    // cron, not just close, or this alert would start armed and then
    // immediately disagree with the very next evaluation run.
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, high, low, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())')
      .bind('^VIX', 25, null, 26, 18)
      .run();

    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20, direction: 'down' });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ active: false });
  });

  it('starts an "up" alert active when the current price has not yet reached the threshold', async () => {
    const cookie = await registerAndLogIn('armed-up-not-met@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 15, null)
      .run();

    const response = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20, direction: 'up' });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ active: true });
  });

  it('rejects an exact duplicate alert with 409', async () => {
    const cookie = await registerAndLogIn('duplicate-alert@example.com');
    const first = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 22 });
    expect(first.status).toBe(201);

    const second = await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 22 });
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'duplicate alert' });
  });

  it('rejects a malformed JSON body with 400', async () => {
    const cookie = await registerAndLogIn('malformed-body@example.com');
    const response = await exports.default.fetch(`${BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{not valid json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects POST without a session cookie', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAlertBody()),
    });
    expect(response.status).toBe(401);
  });

  it('rejects GET without a session cookie', async () => {
    const response = await listAlerts();
    expect(response.status).toBe(401);
  });

  it('never includes another user\'s alerts (isolation)', async () => {
    const cookieA = await registerAndLogIn('isolation-user-a@example.com');
    const cookieB = await registerAndLogIn('isolation-user-b@example.com');

    await createAlert(cookieA, { ticker: '^VIX', alertType: 'PRICE', threshold: 30 });

    const listForB = await listAlerts(cookieB);
    expect(listForB.status).toBe(200);
    await expect(listForB.json()).resolves.toEqual([]);
  });

  it('updates an alert, advancing updatedAt past createdAt and persisting the new values', async () => {
    const cookie = await registerAndLogIn('update-happy-path@example.com');
    const created = (await (await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20 })).json()) as Record<
      string,
      unknown
    >;

    const updateResponse = await updateAlert(cookie, created['id'] as number, {
      ticker: '^VIX',
      alertType: 'PRICE',
      threshold: 25,
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as Record<string, unknown>;
    expect(updated).toMatchObject({
      id: created['id'],
      ticker: '^VIX',
      instrumentName: 'VIX',
      instrumentType: 'index',
      currency: 'USD',
      alertType: 'PRICE',
      threshold: 25,
      currentPrice: null,
      currentRsi: null,
    });
    expect(updated['createdAt']).toBe(created['createdAt']);
    expect(updated['updatedAt']).toBeGreaterThanOrEqual(created['updatedAt'] as number);

    const listResponse = await listAlerts(cookie);
    await expect(listResponse.json()).resolves.toMatchObject([{ threshold: 25 }]);
  });

  it('recomputes active on edit when the threshold crosses the current market value', async () => {
    const cookie = await registerAndLogIn('recompute-armed-on-edit@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 20, null)
      .run();

    const created = (await (
      await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 25, direction: 'up' })
    ).json()) as Record<string, unknown>;
    expect(created['active']).toBe(true);

    // Lowering the threshold below the current price (20) flips the "up"
    // condition to already-met, so the alert should re-arm as inactive.
    const updateResponse = await updateAlert(cookie, created['id'] as number, {
      ticker: '^VIX',
      alertType: 'PRICE',
      threshold: 15,
      direction: 'up',
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ active: false });
  });

  it('recomputes active on edit when direction changes against an unchanged threshold', async () => {
    const cookie = await registerAndLogIn('recompute-armed-on-direction-edit@example.com');
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 20, null)
      .run();

    const created = (await (
      await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 15, direction: 'up' })
    ).json()) as Record<string, unknown>;
    expect(created['active']).toBe(false);

    const updateResponse = await updateAlert(cookie, created['id'] as number, {
      ticker: '^VIX',
      alertType: 'PRICE',
      threshold: 15,
      direction: 'down',
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ active: true });
  });

  it('rejects an update with an invalid threshold, mirroring create validation', async () => {
    const cookie = await registerAndLogIn('update-bad-threshold@example.com');
    const created = (await (await createAlert(cookie)).json()) as Record<string, unknown>;

    const response = await updateAlert(cookie, created['id'] as number, { threshold: 0 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('rejects updating an alert to VIX + RSI with the specific error message', async () => {
    const cookie = await registerAndLogIn('update-vix-rsi@example.com');
    const created = (await (await createAlert(cookie)).json()) as Record<string, unknown>;

    const response = await updateAlert(cookie, created['id'] as number, { ticker: '^VIX', alertType: 'RSI', threshold: 50 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'RSI is not available for VIX' });
  });

  it('rejects updating an alert to collide with a different existing alert', async () => {
    const cookie = await registerAndLogIn('update-duplicate@example.com');
    await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 20 });
    const second = (await (await createAlert(cookie, { ticker: '^VIX', alertType: 'PRICE', threshold: 22 })).json()) as Record<
      string,
      unknown
    >;

    const response = await updateAlert(cookie, second['id'] as number, { ticker: '^VIX', alertType: 'PRICE', threshold: 20 });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'duplicate alert' });
  });

  it('returns 404 updating a nonexistent alert id', async () => {
    const cookie = await registerAndLogIn('update-nonexistent@example.com');
    const response = await updateAlert(cookie, 999999);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'alert not found' });
  });

  it('returns 404 updating another user\'s alert (isolation)', async () => {
    const cookieA = await registerAndLogIn('update-isolation-a@example.com');
    const cookieB = await registerAndLogIn('update-isolation-b@example.com');
    const created = (await (await createAlert(cookieA)).json()) as Record<string, unknown>;

    const response = await updateAlert(cookieB, created['id'] as number, { threshold: 99 });
    expect(response.status).toBe(404);
  });

  it('rejects PUT without a session cookie', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/alerts/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAlertBody()),
    });
    expect(response.status).toBe(401);
  });

  it('deletes an alert, removing it from the list', async () => {
    const cookie = await registerAndLogIn('delete-happy-path@example.com');
    const created = (await (await createAlert(cookie)).json()) as Record<string, unknown>;

    const deleteResponse = await deleteAlert(cookie, created['id'] as number);
    expect(deleteResponse.status).toBe(204);

    const listResponse = await listAlerts(cookie);
    await expect(listResponse.json()).resolves.toEqual([]);
  });

  it('returns 404 deleting a nonexistent alert id', async () => {
    const cookie = await registerAndLogIn('delete-nonexistent@example.com');
    const response = await deleteAlert(cookie, 999999);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'alert not found' });
  });

  it('returns 404 deleting another user\'s alert (isolation)', async () => {
    const cookieA = await registerAndLogIn('delete-isolation-a@example.com');
    const cookieB = await registerAndLogIn('delete-isolation-b@example.com');
    const created = (await (await createAlert(cookieA)).json()) as Record<string, unknown>;

    const response = await deleteAlert(cookieB, created['id'] as number);
    expect(response.status).toBe(404);

    const listForA = await listAlerts(cookieA);
    await expect(listForA.json()).resolves.toHaveLength(1);
  });

  it('rejects DELETE without a session cookie', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/alerts/1`, { method: 'DELETE' });
    expect(response.status).toBe(401);
  });
});
