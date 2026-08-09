import { Hono } from 'hono';
import type { Env } from '../index';
import { adminMiddleware } from '../lib/admin';
import { MarketDataFetchError, fetchDailyCloses, upsertPriceHistory } from '../lib/market-data';
import { sessionMiddleware } from '../lib/session';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 730;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VALID_INSTRUMENT_TYPES = ['index', 'pl_stock', 'us_stock'] as const;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

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
    return c.json({ error: 'ticker is required', code: 'ticker_required' }, 400);
  }
  if (!from || !to) {
    return c.json({ error: 'from and to must be valid YYYY-MM-DD dates', code: 'invalid_dates' }, 400);
  }
  if (from.getTime() > to.getTime()) {
    return c.json({ error: 'from must not be after to', code: 'invalid_range_order' }, 400);
  }
  if (to.getTime() > Date.now()) {
    return c.json({ error: 'to must not be in the future', code: 'future_to_date' }, 400);
  }
  if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
    return c.json({ error: `range must not exceed ${MAX_RANGE_DAYS} days`, code: 'range_too_large' }, 400);
  }

  const instrument = await c.env.DB.prepare('SELECT ticker FROM instruments WHERE ticker = ?').bind(ticker).first();
  if (!instrument) {
    return c.json({ error: 'unknown instrument', code: 'unknown_instrument' }, 400);
  }

  const fromIso = body!.from as string;
  const toIso = body!.to as string;

  let closes;
  try {
    closes = await fetchDailyCloses(ticker, fromIso, toIso);
  } catch (err) {
    if (err instanceof MarketDataFetchError) {
      return c.json({ error: 'market data fetch failed', code: 'fetch_failed' }, 502);
    }
    throw err;
  }

  if (closes.length > 0) {
    try {
      await c.env.DB.batch(upsertPriceHistory(c.env.DB, ticker, closes));
    } catch {
      return c.json({ error: 'failed to write price history', code: 'write_failed' }, 500);
    }
  }

  return c.json({ ticker, from: fromIso, to: toIso, daysWritten: closes.length }, 200);
});

async function parseInstrumentBody(c: { req: { json: () => Promise<unknown> } }): Promise<{
  type?: unknown;
  ticker?: unknown;
  name?: unknown;
  currency?: unknown;
  rsiEligible?: unknown;
} | null> {
  try {
    return (await c.req.json()) as {
      type?: unknown;
      ticker?: unknown;
      name?: unknown;
      currency?: unknown;
      rsiEligible?: unknown;
    };
  } catch {
    return null;
  }
}

// pl_stock is the only type fetched from Stooq (F-04) — everything else
// (index, us_stock) uses the existing Yahoo path, same as today's ^VIX/^NDX.
function deriveProvider(type: string): string {
  return type === 'pl_stock' ? 'stooq' : 'yahoo';
}

interface InsertedInstrumentRow {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: number;
  provider: string;
  currency: string;
}

adminRoutes.post('/instruments', async (c) => {
  const body = await parseInstrumentBody(c);
  if (!body) {
    return c.json({ error: 'invalid request body', code: 'invalid_body' }, 400);
  }

  const type =
    typeof body.type === 'string' && (VALID_INSTRUMENT_TYPES as readonly string[]).includes(body.type) ? body.type : null;
  if (!type) {
    return c.json({ error: 'type must be one of index, pl_stock, us_stock', code: 'instrument_type_invalid' }, 400);
  }

  // Tickers are conventionally uppercase for both Yahoo and Stooq — normalize
  // regardless of what the admin typed, same as currency below.
  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!ticker) {
    return c.json({ error: 'ticker is required', code: 'instrument_ticker_required' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return c.json({ error: 'name is required', code: 'instrument_name_required' }, 400);
  }

  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  if (!CURRENCY_PATTERN.test(currency)) {
    return c.json({ error: 'currency must be a 3-letter code', code: 'instrument_currency_invalid' }, 400);
  }

  const rsiEligible = body.rsiEligible === true;
  const provider = deriveProvider(type);

  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING ticker, name, type, rsi_eligible AS rsiEligible, provider, currency`,
    )
      .bind(ticker, name, type, rsiEligible ? 1 : 0, provider, currency)
      .first<InsertedInstrumentRow>();

    return c.json({ ...row, rsiEligible: !!row!.rsiEligible }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'instrument already exists', code: 'instrument_duplicate_ticker' }, 409);
    }
    throw err;
  }
});

export default adminRoutes;
