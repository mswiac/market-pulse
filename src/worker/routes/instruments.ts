import { Hono } from 'hono';
import type { Env } from '../index';
import type { InstrumentRow } from '../lib/instruments';
import { sessionMiddleware } from '../lib/session';
import { calculateRSISeries } from '../lib/rsi';

type Variables = { userId: number };

const instrumentsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const HISTORY_DAYS = 30;
const RSI_PERIOD = 14;
// Extra days beyond the display window so the earliest displayed day can
// still have an RSI value — RSI at any index needs `period` prior closes.
const LOOKBACK_DAYS = HISTORY_DAYS + RSI_PERIOD;

instrumentsRoutes.use('*', sessionMiddleware);

instrumentsRoutes.get('/', async (c) => {
  const type = c.req.query('type');

  const { results } = type
    ? await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible FROM instruments WHERE type = ?')
        .bind(type)
        .all<{ ticker: string; name: string; type: string; rsiEligible: number }>()
    : await c.env.DB.prepare('SELECT ticker, name, type, rsi_eligible AS rsiEligible FROM instruments').all<{
        ticker: string;
        name: string;
        type: string;
        rsiEligible: number;
      }>();

  // Coerced to a real boolean so `rsiEligible` has the same JSON type here as
  // on GET /:ticker/history, rather than leaking SQLite's raw 0/1 integer.
  const instruments = results.map((row) => ({ ...row, rsiEligible: !!row.rsiEligible }));

  return c.json(instruments, 200);
});

instrumentsRoutes.get('/:ticker/history', async (c) => {
  const ticker = c.req.param('ticker');

  const instrument = await c.env.DB.prepare('SELECT ticker, rsi_eligible FROM instruments WHERE ticker = ?')
    .bind(ticker)
    .first<InstrumentRow>();

  if (!instrument) {
    return c.json({ error: 'unknown instrument' }, 404);
  }

  const { results } = await c.env.DB.prepare('SELECT date, close FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?')
    .bind(ticker, LOOKBACK_DAYS)
    .all<{ date: string; close: number }>();

  // Rows come back newest-first (for the LIMIT to keep the most recent days);
  // RSI smoothing must run oldest-to-newest, so reverse before computing.
  const chronological = [...results].reverse();
  const rsiEligible = !!instrument.rsi_eligible;
  const rsiSeries = rsiEligible
    ? calculateRSISeries(chronological.map((row) => row.close), RSI_PERIOD)
    : chronological.map(() => null);

  const history = chronological
    .map((row, i) => ({ date: row.date, close: row.close, rsi: rsiSeries[i] }))
    .slice(-HISTORY_DAYS);

  return c.json({ ticker, rsiEligible, history }, 200);
});

export default instrumentsRoutes;
