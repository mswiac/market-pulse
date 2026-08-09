import { Hono } from 'hono';
import type { Env } from '../index';
import { adminMiddleware } from '../lib/admin';
import { MarketDataFetchError, buildCurrencyCorrection, fetchDailyCloses, upsertPriceHistory } from '../lib/market-data';
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

  const instrument = await c.env.DB.prepare('SELECT ticker, suffix, currency FROM instruments WHERE ticker = ?')
    .bind(ticker)
    .first<{ ticker: string; suffix: string; currency: string }>();
  if (!instrument) {
    return c.json({ error: 'unknown instrument', code: 'unknown_instrument' }, 400);
  }

  const fromIso = body!.from as string;
  const toIso = body!.to as string;

  let closes;
  let fetchedCurrency: string | null;
  try {
    // `ticker + suffix` is the Yahoo query symbol only — every DB write
    // below stays keyed on the bare `ticker` (see market-data.ts).
    ({ closes, currency: fetchedCurrency } = await fetchDailyCloses(instrument.ticker + instrument.suffix, fromIso, toIso));
  } catch (err) {
    if (err instanceof MarketDataFetchError) {
      return c.json({ error: 'market data fetch failed', code: 'fetch_failed' }, 502);
    }
    throw err;
  }

  const statements = closes.length > 0 ? upsertPriceHistory(c.env.DB, ticker, closes) : [];
  const currencyCorrection = buildCurrencyCorrection(c.env.DB, ticker, instrument.currency, fetchedCurrency);
  if (currencyCorrection) {
    statements.push(currencyCorrection);
  }

  if (statements.length > 0) {
    try {
      await c.env.DB.batch(statements);
      if (currencyCorrection) {
        console.log(`admin-market-data: corrected currency for ${ticker}: ${instrument.currency} -> ${fetchedCurrency}`);
      }
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
  suffix?: unknown;
} | null> {
  try {
    return (await c.req.json()) as {
      type?: unknown;
      ticker?: unknown;
      name?: unknown;
      currency?: unknown;
      rsiEligible?: unknown;
      suffix?: unknown;
    };
  } catch {
    return null;
  }
}

// Yahoo is the only provider now (F-04 dropped a planned Stooq fetch path —
// Stooq's CSV endpoint is gated by a JS proof-of-work anti-bot challenge;
// Yahoo already covers GPW equities via a `.WA` ticker suffix instead).
const PROVIDER = 'yahoo';

interface InsertedInstrumentRow {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: number;
  provider: string;
  currency: string;
  suffix: string;
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

  if (typeof body.rsiEligible !== 'boolean') {
    return c.json({ error: 'rsiEligible must be a boolean', code: 'instrument_rsi_eligible_invalid' }, 400);
  }
  const rsiEligible = body.rsiEligible;

  // No format restriction, same "admin is trusted" contract as ticker —
  // empty is valid (index/us_stock tickers are already the exact Yahoo
  // symbol and need no suffix appended at fetch time).
  const suffix = typeof body.suffix === 'string' ? body.suffix.trim() : '';

  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ticker, name, type, rsi_eligible AS rsiEligible, provider, currency, suffix`,
    )
      .bind(ticker, name, type, rsiEligible ? 1 : 0, PROVIDER, currency, suffix)
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
