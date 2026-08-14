import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_URL = 'https://example.com';
const PASSWORD = 'correct horse battery staple';
const ADMIN_EMAIL = 'admin@example.com'; // matches ADMIN_EMAILS in vitest.config.mts

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

// The admin tests reuse the same ADMIN_EMAIL identity across several `it`
// blocks (D1 isn't reset per test, and `users.email` is UNIQUE) — log in if
// the account already exists from an earlier test in this file, else register.
async function logInAsAdmin(): Promise<string> {
  const loginResponse = await exports.default.fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
  });
  if (loginResponse.ok) return sessionCookieFrom(loginResponse);
  return registerAndLogIn(ADMIN_EMAIL);
}

function yahooBody(timestamps: number[], closes: Array<number | null>, currency?: string) {
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: { quote: [{ close: closes, high: closes, low: closes }] },
          meta: currency ? { currency } : undefined,
        },
      ],
      error: null,
    },
  };
}

async function insertSuffixInstrument(currency = 'PLN'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind('TESTBACKFILL', 'Test SA', 'pl_stock', 0, 'yahoo', currency, '.WA')
    .run();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function fetchMarketData(cookie: string | null, body: Record<string, unknown>): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/market-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function addInstrument(cookie: string | null, body: Record<string, unknown>): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/instruments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function getInstrumentImpact(cookie: string | null, ticker: string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/instruments/${encodeURIComponent(ticker)}/impact`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function removeInstrument(cookie: string | null, ticker: string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/instruments/${encodeURIComponent(ticker)}`, {
    method: 'DELETE',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function getUserId(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>();
  if (!row) throw new Error(`no user found for ${email}`);
  return row.id;
}

async function insertAlert(ticker: string, userId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email, direction) VALUES (?, ?, 'PRICE', 100, 'alerts@example.com', 'up')`,
  )
    .bind(userId, ticker)
    .run();
}

async function insertTriggerEvent(ticker: string, userId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO trigger_events (user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, notification_email, email_status)
     VALUES (?, NULL, ?, 'PRICE', 'up', 100, 101, 'alerts@example.com', 'sent')`,
  )
    .bind(userId, ticker)
    .run();
}

async function listUsers(cookie: string | null): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/users`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function getUserImpact(cookie: string | null, id: number | string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/users/${id}/impact`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function removeUser(cookie: string | null, id: number | string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function validNewInstrument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'us_stock',
    ticker: 'TEST.US',
    name: 'Test Co',
    currency: 'USD',
    rsiEligible: true,
    ...overrides,
  };
}

interface PriceHistoryRow {
  ticker: string;
  date: string;
  close: number;
  high: number | null;
  low: number | null;
}

describe('POST /api/admin/market-data', () => {
  // Test D1 binding isn't isolated per test — clear price_history explicitly.
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM price_history').run();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await env.DB.prepare("DELETE FROM instruments WHERE ticker = 'TESTBACKFILL'").run();
  });

  it('returns 401 with no session', async () => {
    const response = await fetchMarketData(null, { ticker: '^VIX', from: '2026-01-01', to: '2026-01-05' });
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin@example.com');

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 400 with code unknown_instrument for an unknown ticker', async () => {
    const cookie = await logInAsAdmin();

    const response = await fetchMarketData(cookie, { ticker: '^NOPE', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('unknown_instrument');
  });

  it('returns 400 with code invalid_range_order when from is after to', async () => {
    const cookie = await logInAsAdmin();

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-10', to: '2026-01-01' });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('invalid_range_order');
  });

  it('returns 400 with code future_to_date when to is in the future', async () => {
    const cookie = await logInAsAdmin();
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-01', to: future });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('future_to_date');
  });

  it('returns 400 with code range_too_large when the range exceeds 730 days', async () => {
    const cookie = await logInAsAdmin();

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2020-01-01', to: '2026-01-01' });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('range_too_large');
  });

  it('fetches and writes price_history for an admin, overwriting pre-existing rows', async () => {
    const cookie = await logInAsAdmin();
    await env.DB.prepare('INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, ?, ?)')
      .bind('^VIX', '2026-01-05', 1, 1, 1)
      .run();

    const body = yahooBody([1767620200, 1767706600], [100.5, 101.25]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, body))),
    );

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-01', to: '2026-01-10' });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { daysWritten: number };
    expect(json.daysWritten).toBe(2);

    const { results } = await env.DB.prepare('SELECT * FROM price_history WHERE ticker = ? ORDER BY date')
      .bind('^VIX')
      .all<PriceHistoryRow>();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ date: '2026-01-05', close: 100.5 });
  });

  it('returns daysWritten: 0 for a range with no trading days, without erroring', async () => {
    const cookie = await logInAsAdmin();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody([], [])))),
    );

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-03', to: '2026-01-04' });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { daysWritten: number };
    expect(json.daysWritten).toBe(0);
  });

  it('returns 502 with code fetch_failed when the Yahoo fetch fails', async () => {
    const cookie = await logInAsAdmin();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(502);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('fetch_failed');
  });

  it('returns 500 with code write_failed when the D1 batch write fails', async () => {
    const cookie = await logInAsAdmin();
    const body = yahooBody([1767620200], [100.5]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, body))),
    );
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('boom'));

    const response = await fetchMarketData(cookie, { ticker: '^VIX', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('write_failed');
    batchSpy.mockRestore();
  });

  it('fetches a suffix-bearing instrument via ticker+suffix, writing price_history under the bare ticker', async () => {
    await insertSuffixInstrument();
    const cookie = await logInAsAdmin();

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody([1767620200], [100.5]))));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchMarketData(cookie, { ticker: 'TESTBACKFILL', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(200);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('TESTBACKFILL.WA'));

    const row = await env.DB.prepare('SELECT * FROM price_history WHERE ticker = ?').bind('TESTBACKFILL').first();
    expect(row).not.toBeNull();
    const wrongTicker = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind('TESTBACKFILL.WA').first();
    expect(wrongTicker).toBeNull();
  });

  it('auto-corrects instruments.currency when the fetched currency disagrees with the stored value', async () => {
    await insertSuffixInstrument('USD');
    const cookie = await logInAsAdmin();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody([1767620200], [100.5], 'PLN')))),
    );

    const response = await fetchMarketData(cookie, { ticker: 'TESTBACKFILL', from: '2026-01-01', to: '2026-01-05' });

    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT currency FROM instruments WHERE ticker = ?')
      .bind('TESTBACKFILL')
      .first<{ currency: string }>();
    expect(row?.currency).toBe('PLN');
  });
});

describe('POST /api/admin/instruments', () => {
  afterEach(async () => {
    await env.DB.prepare('DELETE FROM instruments WHERE ticker LIKE ?').bind('TEST%').run();
  });

  it('returns 401 with no session', async () => {
    const response = await addInstrument(null, validNewInstrument());
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-instruments@example.com');

    const response = await addInstrument(cookie, validNewInstrument());

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 400 with code invalid_body for a malformed JSON body', async () => {
    const cookie = await logInAsAdmin();

    const response = await exports.default.fetch(`${BASE_URL}/api/admin/instruments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{not valid json',
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('invalid_body');
  });

  it('returns 400 with code instrument_type_invalid for an unknown type', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ type: 'crypto' }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_type_invalid');
  });

  it('returns 400 with code instrument_ticker_required for an empty ticker', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ ticker: '  ' }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_ticker_required');
  });

  it('returns 400 with code instrument_name_required for an empty name', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ name: '' }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_name_required');
  });

  it('returns 400 with code instrument_currency_invalid for a malformed currency', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ currency: 'US' }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_currency_invalid');
  });

  it('returns 400 with code instrument_rsi_eligible_invalid for a non-boolean rsiEligible', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ rsiEligible: 'true' }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_rsi_eligible_invalid');
  });

  it('creates a pl_stock instrument with an explicit suffix, provider always yahoo, visible via GET /api/instruments without suffix/provider', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(
      cookie,
      validNewInstrument({
        type: 'pl_stock',
        ticker: 'TEST.PL',
        name: 'Test SA',
        currency: 'PLN',
        rsiEligible: true,
        suffix: '.WA',
      }),
    );

    expect(response.status).toBe(201);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created).toEqual({
      ticker: 'TEST.PL',
      name: 'Test SA',
      type: 'pl_stock',
      rsiEligible: true,
      provider: 'yahoo',
      currency: 'PLN',
      suffix: '.WA',
    });

    const listResponse = await exports.default.fetch(`${BASE_URL}/api/instruments`, { headers: { Cookie: cookie } });
    const instruments = (await listResponse.json()) as Record<string, unknown>[];
    expect(instruments).toEqual(
      expect.arrayContaining([{ ticker: 'TEST.PL', name: 'Test SA', type: 'pl_stock', rsiEligible: true, currency: 'PLN' }]),
    );
  });

  it('creates an us_stock instrument with provider always yahoo and suffix defaulting to empty when omitted', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ type: 'us_stock', ticker: 'TEST.US2' }));

    expect(response.status).toBe(201);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created['provider']).toBe('yahoo');
    expect(created['suffix']).toBe('');
  });

  it('normalizes a lowercase ticker to uppercase regardless of what was typed', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ ticker: 'test.lower' }));

    expect(response.status).toBe(201);
    const created = (await response.json()) as { ticker: string };
    expect(created.ticker).toBe('TEST.LOWER');

    const row = await env.DB.prepare('SELECT ticker FROM instruments WHERE ticker = ?').bind('TEST.LOWER').first();
    expect(row).not.toBeNull();
  });

  it('persists rsiEligible: false and round-trips it correctly, not just the default true case', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(
      cookie,
      validNewInstrument({ type: 'index', ticker: 'TEST.IDX', name: 'Test Index', currency: 'USD', rsiEligible: false }),
    );

    expect(response.status).toBe(201);
    const created = (await response.json()) as { rsiEligible: boolean };
    expect(created.rsiEligible).toBe(false);

    const row = await env.DB.prepare('SELECT rsi_eligible FROM instruments WHERE ticker = ?').bind('TEST.IDX').first<{
      rsi_eligible: number;
    }>();
    expect(row?.rsi_eligible).toBe(0);
  });

  it('returns 409 with code instrument_duplicate_ticker for a ticker that already exists', async () => {
    const cookie = await logInAsAdmin();

    const response = await addInstrument(cookie, validNewInstrument({ type: 'index', ticker: '^VIX', currency: 'USD' }));

    expect(response.status).toBe(409);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('instrument_duplicate_ticker');
  });
});

describe('GET /api/admin/instruments/:ticker/impact', () => {
  const TICKER = 'TESTIMPACT';

  afterEach(async () => {
    await env.DB.prepare('DELETE FROM alerts WHERE ticker = ?').bind(TICKER).run();
    await env.DB.prepare('DELETE FROM instruments WHERE ticker = ?').bind(TICKER).run();
  });

  it('returns 401 with no session', async () => {
    const response = await getInstrumentImpact(null, TICKER);
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-impact@example.com');

    const response = await getInstrumentImpact(cookie, TICKER);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 404 with code unknown_instrument for a ticker not in the registry', async () => {
    const cookie = await logInAsAdmin();

    const response = await getInstrumentImpact(cookie, 'TESTIMPACTNOPE');

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('unknown_instrument');
  });

  it('returns alertsCount: 0 for an instrument with no alerts', async () => {
    const cookie = await logInAsAdmin();
    await addInstrument(cookie, validNewInstrument({ ticker: TICKER }));

    const response = await getInstrumentImpact(cookie, TICKER);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ticker: string; alertsCount: number };
    expect(json).toEqual({ ticker: TICKER, alertsCount: 0 });
  });

  it('returns the correct non-zero alertsCount across multiple users', async () => {
    const cookie = await logInAsAdmin();
    await addInstrument(cookie, validNewInstrument({ ticker: TICKER }));
    await registerAndLogIn('impact-user1@example.com');
    await registerAndLogIn('impact-user2@example.com');
    await insertAlert(TICKER, await getUserId('impact-user1@example.com'));
    await insertAlert(TICKER, await getUserId('impact-user2@example.com'));

    const response = await getInstrumentImpact(cookie, TICKER);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { alertsCount: number };
    expect(json.alertsCount).toBe(2);
  });
});

describe('DELETE /api/admin/instruments/:ticker', () => {
  const TICKER = 'TESTDELETE';

  afterEach(async () => {
    await env.DB.prepare('DELETE FROM trigger_events WHERE ticker = ?').bind(TICKER).run();
    await env.DB.prepare('DELETE FROM alerts WHERE ticker = ?').bind(TICKER).run();
    await env.DB.prepare('DELETE FROM price_history WHERE ticker = ?').bind(TICKER).run();
    await env.DB.prepare('DELETE FROM market_data WHERE ticker = ?').bind(TICKER).run();
    await env.DB.prepare('DELETE FROM instruments WHERE ticker = ?').bind(TICKER).run();
  });

  it('returns 401 with no session', async () => {
    const response = await removeInstrument(null, TICKER);
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-delete@example.com');

    const response = await removeInstrument(cookie, TICKER);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 404 with code unknown_instrument for a ticker not in the registry', async () => {
    const cookie = await logInAsAdmin();

    const response = await removeInstrument(cookie, 'TESTDELETENOPE');

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('unknown_instrument');
  });

  it('cascade-deletes alerts/price_history/market_data, leaves trigger_events untouched, and reports alertsDeleted', async () => {
    const cookie = await logInAsAdmin();
    await addInstrument(cookie, validNewInstrument({ ticker: TICKER }));

    await registerAndLogIn('delete-user1@example.com');
    await registerAndLogIn('delete-user2@example.com');
    const userId1 = await getUserId('delete-user1@example.com');
    const userId2 = await getUserId('delete-user2@example.com');
    await insertAlert(TICKER, userId1);
    await insertAlert(TICKER, userId2);
    const alert1 = await env.DB.prepare('SELECT id FROM alerts WHERE user_id = ? AND ticker = ?')
      .bind(userId1, TICKER)
      .first<{ id: number }>();

    await env.DB.prepare('INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)').bind(TICKER, '2026-01-05', 100).run();
    await env.DB.prepare('INSERT INTO market_data (ticker, price) VALUES (?, ?)').bind(TICKER, 100).run();
    await env.DB.prepare(
      `INSERT INTO trigger_events (user_id, alert_id, ticker, alert_type, direction, threshold, value_at_trigger, notification_email, email_status)
       VALUES (?, ?, ?, 'PRICE', 'up', 100, 101, 'alerts@example.com', 'sent')`,
    )
      .bind(userId1, alert1?.id, TICKER)
      .run();

    const response = await removeInstrument(cookie, TICKER);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ticker: string; alertsDeleted: number };
    expect(json).toEqual({ ticker: TICKER, alertsDeleted: 2 });

    const instrumentRow = await env.DB.prepare('SELECT 1 FROM instruments WHERE ticker = ?').bind(TICKER).first();
    expect(instrumentRow).toBeNull();

    const alertsCountRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM alerts WHERE ticker = ?')
      .bind(TICKER)
      .first<{ count: number }>();
    expect(alertsCountRow?.count).toBe(0);

    const priceHistoryRow = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind(TICKER).first();
    expect(priceHistoryRow).toBeNull();

    const marketDataRow = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind(TICKER).first();
    expect(marketDataRow).toBeNull();

    const triggerEventRow = await env.DB.prepare('SELECT alert_id FROM trigger_events WHERE ticker = ?')
      .bind(TICKER)
      .first<{ alert_id: number | null }>();
    expect(triggerEventRow).not.toBeNull();
    // D1 enforces the `alerts(id) ON DELETE SET NULL` FK on trigger_events.alert_id
    // (confirmed empirically here) — the row itself survives, but its alert_id link
    // to the now-deleted alert is nulled by the DB engine, not by this endpoint's code.
    expect(triggerEventRow?.alert_id).toBeNull();
  });

  it('removes the ticker from GET /api/instruments after deletion', async () => {
    const cookie = await logInAsAdmin();
    await addInstrument(cookie, validNewInstrument({ ticker: TICKER }));

    await removeInstrument(cookie, TICKER);

    const listResponse = await exports.default.fetch(`${BASE_URL}/api/instruments`, { headers: { Cookie: cookie } });
    const instruments = (await listResponse.json()) as Record<string, unknown>[];
    expect(instruments.some((i) => i['ticker'] === TICKER)).toBe(false);
  });

  it('returns 500 with code delete_failed when the D1 batch delete fails', async () => {
    const cookie = await logInAsAdmin();
    await addInstrument(cookie, validNewInstrument({ ticker: TICKER }));
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('boom'));

    const response = await removeInstrument(cookie, TICKER);

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('delete_failed');
    batchSpy.mockRestore();
  });
});

describe('GET /api/admin/users', () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM users WHERE email LIKE 'list-users-%'").run();
  });

  it('returns 401 with no session', async () => {
    const response = await listUsers(null);
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-list-users@example.com');

    const response = await listUsers(cookie);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it("excludes the admin's own account and includes other registered users", async () => {
    const cookie = await logInAsAdmin();
    await registerAndLogIn('list-users-other@example.com');

    const response = await listUsers(cookie);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { users: Array<{ id: number; email: string }> };
    expect(json.users.some((u) => u.email === ADMIN_EMAIL)).toBe(false);
    expect(json.users.some((u) => u.email === 'list-users-other@example.com')).toBe(true);
  });
});

describe('GET /api/admin/users/:id/impact', () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM users WHERE email LIKE 'impact-user-%'").run();
  });

  it('returns 401 with no session', async () => {
    const response = await getUserImpact(null, 1);
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-user-impact@example.com');

    const response = await getUserImpact(cookie, 1);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 400 with code invalid_user_id for a non-numeric id', async () => {
    const cookie = await logInAsAdmin();

    const response = await getUserImpact(cookie, 'not-a-number');

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('invalid_user_id');
  });

  it('returns 404 with code unknown_user for a numeric id not in users', async () => {
    const cookie = await logInAsAdmin();

    const response = await getUserImpact(cookie, 999999999);

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('unknown_user');
  });

  it('returns zero counts for a user with no alerts or trigger events', async () => {
    const cookie = await logInAsAdmin();
    await registerAndLogIn('impact-user-empty@example.com');
    const userId = await getUserId('impact-user-empty@example.com');

    const response = await getUserImpact(cookie, userId);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { id: number; email: string; alertsCount: number; triggerEventsCount: number };
    expect(json).toEqual({ id: userId, email: 'impact-user-empty@example.com', alertsCount: 0, triggerEventsCount: 0 });
  });

  it('returns correct non-zero counts after seeding alerts and trigger events', async () => {
    const cookie = await logInAsAdmin();
    await registerAndLogIn('impact-user-full@example.com');
    const userId = await getUserId('impact-user-full@example.com');
    await insertAlert('^VIX', userId);
    await insertAlert('^NDX', userId);
    await insertTriggerEvent('^VIX', userId);

    const response = await getUserImpact(cookie, userId);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { alertsCount: number; triggerEventsCount: number };
    expect(json.alertsCount).toBe(2);
    expect(json.triggerEventsCount).toBe(1);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM users WHERE email LIKE 'delete-user-%'").run();
  });

  it('returns 401 with no session', async () => {
    const response = await removeUser(null, 1);
    expect(response.status).toBe(401);
  });

  it('returns 403 with code forbidden for a logged-in non-admin', async () => {
    const cookie = await registerAndLogIn('not-admin-user-delete@example.com');

    const response = await removeUser(cookie, 1);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('forbidden');
  });

  it('returns 400 with code invalid_user_id for a non-numeric id', async () => {
    const cookie = await logInAsAdmin();

    const response = await removeUser(cookie, 'not-a-number');

    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('invalid_user_id');
  });

  it('returns 403 with code cannot_delete_self when the admin targets their own id, and leaves the admin account intact', async () => {
    const cookie = await logInAsAdmin();
    const adminId = await getUserId(ADMIN_EMAIL);

    const response = await removeUser(cookie, adminId);

    expect(response.status).toBe(403);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('cannot_delete_self');

    const stillThere = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(adminId).first();
    expect(stillThere).not.toBeNull();
  });

  it('returns 404 with code unknown_user for a numeric id not in users', async () => {
    const cookie = await logInAsAdmin();

    const response = await removeUser(cookie, 999999999);

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('unknown_user');
  });

  it('deletes the user and cascades sessions/alerts/trigger_events, leaving the admin untouched', async () => {
    const cookie = await logInAsAdmin();
    const adminId = await getUserId(ADMIN_EMAIL);
    const targetCookie = await registerAndLogIn('delete-user-target@example.com');
    const targetId = await getUserId('delete-user-target@example.com');
    await insertAlert('^VIX', targetId);
    await insertAlert('^NDX', targetId);
    await insertTriggerEvent('^VIX', targetId);
    const targetSessionId = targetCookie.split('=')[1];

    const response = await removeUser(cookie, targetId);

    expect(response.status).toBe(200);
    const json = (await response.json()) as { id: number; email: string; alertsDeleted: number; triggerEventsDeleted: number };
    expect(json).toEqual({ id: targetId, email: 'delete-user-target@example.com', alertsDeleted: 2, triggerEventsDeleted: 1 });

    const userRow = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(targetId).first();
    expect(userRow).toBeNull();

    const sessionRow = await env.DB.prepare('SELECT 1 FROM sessions WHERE id = ?').bind(targetSessionId).first();
    expect(sessionRow).toBeNull();

    const alertsCountRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM alerts WHERE user_id = ?')
      .bind(targetId)
      .first<{ count: number }>();
    expect(alertsCountRow?.count).toBe(0);

    const triggerEventsCountRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM trigger_events WHERE user_id = ?')
      .bind(targetId)
      .first<{ count: number }>();
    expect(triggerEventsCountRow?.count).toBe(0);

    const adminRow = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(adminId).first();
    expect(adminRow).not.toBeNull();
  });

  it('returns 500 with code delete_failed when the D1 batch delete fails', async () => {
    const cookie = await logInAsAdmin();
    await registerAndLogIn('delete-user-batch-fail@example.com');
    const targetId = await getUserId('delete-user-batch-fail@example.com');
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('boom'));

    const response = await removeUser(cookie, targetId);

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe('delete_failed');
    batchSpy.mockRestore();
  });
});
