import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

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
    instrument: 'VIX',
    alertType: 'PRICE',
    threshold: 20,
    notificationEmail: 'alerts@example.com',
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

describe('alerts endpoints', () => {
  it('creates then lists a VIX/PRICE alert, including matching createdAt/updatedAt', async () => {
    const cookie = await registerAndLogIn('vix-price@example.com');

    const createResponse = await createAlert(cookie, { instrument: 'VIX', alertType: 'PRICE', threshold: 18.42 });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      instrument: 'VIX',
      alertType: 'PRICE',
      threshold: 18.42,
      notificationEmail: 'alerts@example.com',
    });
    expect(created['createdAt']).toBe(created['updatedAt']);

    const listResponse = await listAlerts(cookie);
    expect(listResponse.status).toBe(200);
    const alerts = (await listResponse.json()) as Record<string, unknown>[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ instrument: 'VIX', alertType: 'PRICE', threshold: 18.42 });
  });

  it('creates then lists a NASDAQ100/RSI alert', async () => {
    const cookie = await registerAndLogIn('nasdaq-rsi@example.com');

    const createResponse = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'RSI', threshold: 70 });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({ instrument: 'NASDAQ100', alertType: 'RSI', threshold: 70 });

    const listResponse = await listAlerts(cookie);
    await expect(listResponse.json()).resolves.toMatchObject([{ instrument: 'NASDAQ100', alertType: 'RSI', threshold: 70 }]);
  });

  it('rejects an invalid instrument', async () => {
    const cookie = await registerAndLogIn('bad-instrument@example.com');
    const response = await createAlert(cookie, { instrument: 'SPX' });
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
    const response = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'RSI', threshold: -0.01 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('rejects an RSI threshold above 100', async () => {
    const cookie = await registerAndLogIn('over-100-rsi@example.com');
    const response = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'RSI', threshold: 100.01 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('accepts an RSI threshold of exactly 0', async () => {
    const cookie = await registerAndLogIn('rsi-zero@example.com');
    const response = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'RSI', threshold: 0 });
    expect(response.status).toBe(201);
  });

  it('accepts an RSI threshold of exactly 100', async () => {
    const cookie = await registerAndLogIn('rsi-hundred@example.com');
    const response = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'RSI', threshold: 100 });
    expect(response.status).toBe(201);
  });

  it('rejects a price threshold of 0', async () => {
    const cookie = await registerAndLogIn('price-zero@example.com');
    const response = await createAlert(cookie, { instrument: 'VIX', alertType: 'PRICE', threshold: 0 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid threshold' });
  });

  it('accepts a price threshold with decimals', async () => {
    const cookie = await registerAndLogIn('price-decimal@example.com');
    const response = await createAlert(cookie, { instrument: 'NASDAQ100', alertType: 'PRICE', threshold: 4500.25 });
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
    const response = await createAlert(cookie, { instrument: 'VIX', alertType: 'RSI', threshold: 50 });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'RSI is not available for VIX' });
  });

  it('rejects an exact duplicate alert with 409', async () => {
    const cookie = await registerAndLogIn('duplicate-alert@example.com');
    const first = await createAlert(cookie, { instrument: 'VIX', alertType: 'PRICE', threshold: 22 });
    expect(first.status).toBe(201);

    const second = await createAlert(cookie, { instrument: 'VIX', alertType: 'PRICE', threshold: 22 });
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

  it('DB CHECK constraint rejects VIX+RSI on a direct insert (backstop behind the route-level rejection)', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'check-constraint@example.com', password: PASSWORD }),
    });
    const { id: userId } = (await response.json()) as { id: number };

    await expect(
      env.DB.prepare(
        `INSERT INTO alerts (user_id, instrument, alert_type, threshold, notification_email)
         VALUES (?, 'VIX', 'RSI', 50, 'alerts@example.com')`,
      )
        .bind(userId)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('never includes another user\'s alerts (isolation)', async () => {
    const cookieA = await registerAndLogIn('isolation-user-a@example.com');
    const cookieB = await registerAndLogIn('isolation-user-b@example.com');

    await createAlert(cookieA, { instrument: 'VIX', alertType: 'PRICE', threshold: 30 });

    const listForB = await listAlerts(cookieB);
    expect(listForB.status).toBe(200);
    await expect(listForB.json()).resolves.toEqual([]);
  });
});
