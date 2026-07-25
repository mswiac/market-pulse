import { exports } from 'cloudflare:workers';
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

async function getInstruments(cookie?: string, type?: string): Promise<Response> {
  const url = type ? `${BASE_URL}/api/instruments?type=${type}` : `${BASE_URL}/api/instruments`;
  return exports.default.fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe('instruments endpoint', () => {
  it('rejects a request without a session cookie', async () => {
    const response = await getInstruments();
    expect(response.status).toBe(401);
  });

  it('returns the seeded instruments with only ticker/name/type when authenticated', async () => {
    const cookie = await registerAndLogIn('instruments-list@example.com');

    const response = await getInstruments(cookie);
    expect(response.status).toBe(200);
    const instruments = (await response.json()) as Record<string, unknown>[];

    expect(instruments).toHaveLength(2);
    expect(instruments).toEqual(
      expect.arrayContaining([
        { ticker: '^VIX', name: 'VIX', type: 'index' },
        { ticker: '^NDX', name: 'NASDAQ-100', type: 'index' },
      ]),
    );
    for (const instrument of instruments) {
      expect(Object.keys(instrument).sort()).toEqual(['name', 'ticker', 'type']);
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
