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

async function getInstruments(cookie?: string, type?: string): Promise<Response> {
  const url = type ? `${BASE_URL}/api/instruments?type=${type}` : `${BASE_URL}/api/instruments`;
  return exports.default.fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function getHistory(ticker: string, cookie?: string): Promise<Response> {
  return exports.default.fetch(`${BASE_URL}/api/instruments/${ticker}/history`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

// Seeds `closes.length` consecutive daily rows for `ticker`, oldest starting
// at 2020-01-01, so tests control exactly how much lookback history exists.
// `highs`/`lows` are optional and default to null (matching an un-backfilled
// row) — pass them when a test needs to assert on returned high/low values.
async function seedPriceHistory(
  ticker: string,
  closes: number[],
  highs?: Array<number | null>,
  lows?: Array<number | null>,
): Promise<void> {
  const start = new Date('2020-01-01T00:00:00Z');
  const statements = closes.map((close, i) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    return env.DB.prepare('INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, ?, ?)').bind(
      ticker,
      date.toISOString().slice(0, 10),
      close,
      highs?.[i] ?? null,
      lows?.[i] ?? null,
    );
  });
  await env.DB.batch(statements);
}

describe('instruments endpoint', () => {
  it('rejects a request without a session cookie', async () => {
    const response = await getInstruments();
    expect(response.status).toBe(401);
  });

  it('returns the seeded instruments with ticker/name/type/rsiEligible/currency when authenticated', async () => {
    const cookie = await registerAndLogIn('instruments-list@example.com');

    const response = await getInstruments(cookie);
    expect(response.status).toBe(200);
    const instruments = (await response.json()) as Record<string, unknown>[];

    expect(instruments).toHaveLength(2);
    expect(instruments).toEqual(
      expect.arrayContaining([
        { ticker: '^VIX', name: 'VIX', type: 'index', rsiEligible: false, currency: 'USD' },
        { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
      ]),
    );
    for (const instrument of instruments) {
      expect(Object.keys(instrument).sort()).toEqual(['currency', 'name', 'rsiEligible', 'ticker', 'type']);
    }
  });

  it('filters by type, returning both seeded instruments for type=index', async () => {
    const cookie = await registerAndLogIn('instruments-filter-match@example.com');

    const response = await getInstruments(cookie, 'index');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveLength(2);
  });

  it('returns an empty array for a type with no matching instruments', async () => {
    const cookie = await registerAndLogIn('instruments-filter-empty@example.com');

    const response = await getInstruments(cookie, 'gpw_company');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });
});

describe('instrument history endpoint', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM price_history').run();
  });

  it('rejects a request without a session cookie', async () => {
    const response = await getHistory('^NDX');
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown ticker', async () => {
    const cookie = await registerAndLogIn('history-unknown-ticker@example.com');

    const response = await getHistory('^FOO', cookie);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'unknown instrument' });
  });

  it('returns rsiEligible: false, currency: USD, and every rsi null for ^VIX', async () => {
    const cookie = await registerAndLogIn('history-vix@example.com');
    await seedPriceHistory('^VIX', Array.from({ length: 20 }, (_, i) => 20 + i));

    const response = await getHistory('^VIX', cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticker: string;
      rsiEligible: boolean;
      currency: string;
      history: { rsi: number | null; high: number | null; low: number | null }[];
    };

    expect(body.rsiEligible).toBe(false);
    expect(body.currency).toBe('USD');
    expect(body.history).toHaveLength(20);
    expect(body.history.every((day) => day.rsi === null)).toBe(true);
    // Not seeded with high/low — un-backfilled days return null, not a crash.
    expect(body.history.every((day) => day.high === null && day.low === null)).toBe(true);
  });

  it('returns rsiEligible: true, currency: USD, and populates rsi once enough lookback exists for ^NDX', async () => {
    const cookie = await registerAndLogIn('history-ndx-full@example.com');
    // Exactly 30 (display) + 14 (lookback) closes — every displayed day has enough history for RSI.
    const closes = Array.from({ length: 44 }, (_, i) => 4000 + i);
    const highs = closes.map((c) => c + 10);
    const lows = closes.map((c) => c - 10);
    await seedPriceHistory('^NDX', closes, highs, lows);

    const response = await getHistory('^NDX', cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticker: string;
      rsiEligible: boolean;
      currency: string;
      history: { date: string; close: number; high: number | null; low: number | null; rsi: number | null }[];
    };

    expect(body.rsiEligible).toBe(true);
    expect(body.currency).toBe('USD');
    expect(body.history).toHaveLength(30);
    expect(body.history.every((day) => typeof day.rsi === 'number')).toBe(true);
    // Oldest → newest, matching the seeded date sequence.
    expect(body.history[0].date < body.history[body.history.length - 1].date).toBe(true);
    // High/low pass through from price_history for every displayed day.
    expect(body.history.every((day) => typeof day.high === 'number' && typeof day.low === 'number')).toBe(true);
    const lastDay = body.history[body.history.length - 1];
    expect(lastDay.high).toBe(lastDay.close + 10);
    expect(lastDay.low).toBe(lastDay.close - 10);
  });

  it('caps history at 30 entries even when more than 44 rows of price_history exist', async () => {
    const cookie = await registerAndLogIn('history-ndx-overflow@example.com');
    await seedPriceHistory('^NDX', Array.from({ length: 60 }, (_, i) => 4000 + i));

    const response = await getHistory('^NDX', cookie);
    const body = (await response.json()) as { history: unknown[] };
    expect(body.history).toHaveLength(30);
  });

  it('returns fewer than 30 entries with a partial rsi ramp-up when less history exists', async () => {
    const cookie = await registerAndLogIn('history-ndx-partial@example.com');
    // Mirrors current production reality: ~22 days of history, well short of the 44-day full lookback.
    await seedPriceHistory('^NDX', Array.from({ length: 22 }, (_, i) => 4000 + i));

    const response = await getHistory('^NDX', cookie);
    const body = (await response.json()) as { rsiEligible: boolean; history: { rsi: number | null }[] };

    expect(body.rsiEligible).toBe(true);
    expect(body.history).toHaveLength(22);
    // First 14 days (period) can't have enough lookback yet; the remaining 8 can.
    expect(body.history.slice(0, 14).every((day) => day.rsi === null)).toBe(true);
    expect(body.history.slice(14).every((day) => typeof day.rsi === 'number')).toBe(true);
  });
});
