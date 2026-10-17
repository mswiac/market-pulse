// Shared data helpers for the admin management specs. Instruments and users are
// global tables, so every helper works on ids that are unique to one call and
// cleanup deletes only the exact row a test created.
//
// Users are registered through a *fresh* request context: POST /api/register
// sets a session cookie, which would otherwise replace the admin session in the
// page's own context.

import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Playwright } from '@playwright/test';

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export function uniqueTicker(): string {
  return `E2E${uniqueSuffix()}`;
}

export function instrumentName(ticker: string): string {
  return `E2E Instrument ${ticker}`;
}

// Seeds straight into the local D1 file the e2e worker serves, because POST
// /api/admin/instruments asks Yahoo about the symbol and the made-up E2E…
// tickers would be rejected (and e2e must not call Yahoo). The ticker comes
// from uniqueTicker(), so it is plain A-Z0-9 and safe to inline into SQL.
export function createInstrument(ticker: string): void {
  const sql =
    `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix) ` +
    `VALUES ('${ticker}', '${instrumentName(ticker)}', 'us_stock', 0, 'yahoo', 'USD', '')`;
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'marketpulse-db', '--local', '--command', sql], {
    stdio: 'pipe',
  });
}

export async function deleteInstrument(request: APIRequestContext, ticker: string): Promise<void> {
  // 404 when the test already removed it — that is the success path. Anything
  // else would silently leave rows behind, so fail loudly.
  const res = await request.delete(`/api/admin/instruments/${encodeURIComponent(ticker)}`);
  expect([200, 404]).toContain(res.status());
}

export async function listInstrumentTickers(request: APIRequestContext): Promise<string[]> {
  const res = await request.get('/api/instruments');
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { ticker: string }[]).map((i) => i.ticker);
}

export interface RegisteredUser {
  id: number;
  email: string;
  password: string;
}

export async function registerUser(
  playwright: Playwright,
  baseURL: string,
): Promise<RegisteredUser> {
  const email = `e2e-${uniqueSuffix().toLowerCase()}@e2e.market-pulse.test`;
  const password = `E2e-${uniqueSuffix()}-pw`;
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    const res = await anonymous.post('/api/register', { data: { email, password } });
    expect(res.status()).toBe(201);
    const { id } = (await res.json()) as { id: number };
    return { id, email, password };
  } finally {
    await anonymous.dispose();
  }
}

export async function loginStatus(
  playwright: Playwright,
  baseURL: string,
  user: RegisteredUser,
): Promise<number> {
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    const res = await anonymous.post('/api/login', {
      data: { email: user.email, password: user.password },
    });
    return res.status();
  } finally {
    await anonymous.dispose();
  }
}

export async function deleteUser(request: APIRequestContext, id: number): Promise<void> {
  // 404 when the test already removed the user — that is the success path.
  // Anything else would silently leave rows behind, so fail loudly.
  const res = await request.delete(`/api/admin/users/${id}`);
  expect([200, 404]).toContain(res.status());
}
