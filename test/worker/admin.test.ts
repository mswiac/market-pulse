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

function yahooBody(timestamps: number[], closes: Array<number | null>) {
  return {
    chart: {
      result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes, high: closes, low: closes }] } }],
      error: null,
    },
  };
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

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
