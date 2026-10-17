import { Hono } from 'hono';
import type { Env } from '../index';
import type { InstrumentRow } from '../lib/instruments';
import { sessionMiddleware } from '../lib/session';
import { buildHistory, loadRecentPriceRows, RSI_INPUT_SESSIONS, type PriceRow } from '../lib/price-history';

type Variables = { userId: number };

const instrumentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

instrumentsRoutes.use('*', sessionMiddleware);

instrumentsRoutes.get('/', async (c) => {
  const type = c.req.query('type');

  const { results } = type
    ? await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible, currency FROM instruments WHERE type = ?')
        .bind(type)
        .all<{ ticker: string; name: string; type: string; rsiEligible: number; currency: string }>()
    : await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible, currency FROM instruments').all<{
        ticker: string;
        name: string;
        type: string;
        rsiEligible: number;
        currency: string;
      }>();

  // Coerced to a real boolean so `rsiEligible` has the same JSON type here as
  // on GET /:ticker/history, rather than leaking SQLite's raw 0/1 integer.
  const instruments = results.map((row) => ({ ...row, rsiEligible: !!row.rsiEligible }));

  return c.json(instruments, 200);
});

instrumentsRoutes.get('/latest', async (c) => {
  const { results: instruments } = await c.env.DB.prepare(
    'SELECT ticker, name, type, currency, rsi_eligible AS rsiEligible FROM instruments',
  ).all<{ ticker: string; name: string; type: string; currency: string; rsiEligible: number }>();

  const byTicker = await loadRecentPriceRows(c.env.DB, null);

  const latest = instruments.map((instrument) => {
    const rsiEligible = !!instrument.rsiEligible;
    const newest = buildHistory(byTicker.get(instrument.ticker) ?? [], rsiEligible).at(-1);
    return {
      ticker: instrument.ticker,
      name: instrument.name,
      type: instrument.type,
      currency: instrument.currency,
      rsiEligible,
      date: newest?.date ?? null,
      close: newest?.close ?? null,
      high: newest?.high ?? null,
      low: newest?.low ?? null,
      rsi: newest?.rsi ?? null,
    };
  });

  return c.json(latest, 200);
});

instrumentsRoutes.get('/:ticker/history', async (c) => {
  const ticker = c.req.param('ticker');

  const instrument = await c.env.DB.prepare('SELECT ticker, rsi_eligible, currency, suffix FROM instruments WHERE ticker = ?')
    .bind(ticker)
    .first<InstrumentRow>();

  if (!instrument) {
    return c.json({ error: 'unknown instrument' }, 404);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT date, close, high, low FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?',
  )
    .bind(ticker, RSI_INPUT_SESSIONS)
    .all<PriceRow>();

  const rsiEligible = !!instrument.rsi_eligible;
  const history = buildHistory(results, rsiEligible);

  return c.json({ ticker, rsiEligible, currency: instrument.currency, history }, 200);
});

export default instrumentsRoutes;
