import { Hono } from 'hono';
import type { Env } from '../index';
import { adminMiddleware } from '../lib/admin';
import { MarketDataFetchError, fetchDailyCloses, upsertPriceHistory } from '../lib/market-data';
import { sessionMiddleware } from '../lib/session';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 730;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Variables = { userId: number };

const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRoutes.use('*', sessionMiddleware, adminMiddleware);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

async function parseAdminBody(c: { req: { json: () => Promise<unknown> } }): Promise<{
  ticker?: unknown;
  from?: unknown;
  to?: unknown;
} | null> {
  try {
    return (await c.req.json()) as { ticker?: unknown; from?: unknown; to?: unknown };
  } catch {
    return null;
  }
}

adminRoutes.post('/market-data', async (c) => {
  const body = await parseAdminBody(c);
  const ticker = body && typeof body.ticker === 'string' ? body.ticker : null;
  const from = body ? parseDate(body.from) : null;
  const to = body ? parseDate(body.to) : null;

  if (!ticker) {
    return c.json({ error: 'ticker is required' }, 400);
  }
  if (!from || !to) {
    return c.json({ error: 'from and to must be valid YYYY-MM-DD dates' }, 400);
  }
  if (from.getTime() > to.getTime()) {
    return c.json({ error: 'from must not be after to' }, 400);
  }
  if (to.getTime() > Date.now()) {
    return c.json({ error: 'to must not be in the future' }, 400);
  }
  if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
    return c.json({ error: `range must not exceed ${MAX_RANGE_DAYS} days` }, 400);
  }

  const instrument = await c.env.DB.prepare('SELECT ticker FROM instruments WHERE ticker = ?').bind(ticker).first();
  if (!instrument) {
    return c.json({ error: 'unknown instrument' }, 400);
  }

  const fromIso = body!.from as string;
  const toIso = body!.to as string;

  let closes;
  try {
    closes = await fetchDailyCloses(ticker, fromIso, toIso);
  } catch (err) {
    if (err instanceof MarketDataFetchError) {
      return c.json({ error: 'market data fetch failed' }, 502);
    }
    throw err;
  }

  if (closes.length > 0) {
    await c.env.DB.batch(upsertPriceHistory(c.env.DB, ticker, closes));
  }

  return c.json({ ticker, from: fromIso, to: toIso, daysWritten: closes.length }, 200);
});

export default adminRoutes;
