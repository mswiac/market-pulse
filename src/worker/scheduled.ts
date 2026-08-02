import type { Env } from './index';
import { evaluateAlerts } from './lib/alert-evaluation';
import type { InstrumentRow } from './lib/instruments';
import { fetchDailyCloses, type DailyClose } from './lib/market-data';
import { calculateRSI } from './lib/rsi';

const RETRY_ATTEMPTS = 3;
// Fixed delay, no backoff — deliberate simplification at current volume (2 tickers/day).
const RETRY_DELAY_MS = 300;

async function fetchWithRetry(symbol: string): Promise<DailyClose[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchDailyCloses(symbol);
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export async function handleScheduled(env: Env): Promise<void> {
  let instruments: InstrumentRow[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT ticker, rsi_eligible FROM instruments WHERE provider = 'yahoo'`,
    ).all<InstrumentRow>();
    instruments = results;
  } catch (err) {
    console.error('market-data-pipeline: failed to load instruments registry', err);
    return;
  }

  for (const { ticker, rsi_eligible } of instruments) {
    try {
      const closes = await fetchWithRetry(ticker);
      const rsi = rsi_eligible ? calculateRSI(closes.map((c) => c.close)) : null;
      const latest = closes[closes.length - 1];

      const statements = closes.map(({ date, close, high, low }) =>
        env.DB.prepare(
          `INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (ticker, date) DO UPDATE SET close = excluded.close, high = excluded.high, low = excluded.low`,
        ).bind(ticker, date, close, high, low),
      );

      statements.push(
        env.DB.prepare(
          `INSERT INTO market_data (ticker, price, rsi, high, low, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, high = excluded.high, low = excluded.low, updated_at = excluded.updated_at`,
        ).bind(ticker, latest.close, rsi, latest.high, latest.low),
      );

      await env.DB.batch(statements);
    } catch (err) {
      console.error(`market-data-pipeline: failed to process ${ticker}`, err);
    }
  }

  await evaluateAlerts(env);
}
