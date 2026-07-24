import type { Env } from './index';
import { YAHOO_SYMBOLS, fetchDailyCloses, type DailyClose } from './lib/market-data';
import { calculateRSI } from './lib/rsi';

const RETRY_ATTEMPTS = 3;
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
  const instruments = Object.keys(YAHOO_SYMBOLS) as Array<keyof typeof YAHOO_SYMBOLS>;

  for (const instrument of instruments) {
    try {
      const closes = await fetchWithRetry(YAHOO_SYMBOLS[instrument]);
      const rsi = instrument === 'NASDAQ100' ? calculateRSI(closes.map((c) => c.close)) : null;
      const latestPrice = closes[closes.length - 1].close;

      const statements = closes.map(({ date, close }) =>
        env.DB.prepare(
          `INSERT INTO price_history (instrument, date, close) VALUES (?, ?, ?)
           ON CONFLICT (instrument, date) DO UPDATE SET close = excluded.close`,
        ).bind(instrument, date, close),
      );

      statements.push(
        env.DB.prepare(
          `INSERT INTO market_data (instrument, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())
           ON CONFLICT (instrument) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, updated_at = excluded.updated_at`,
        ).bind(instrument, latestPrice, rsi),
      );

      await env.DB.batch(statements);
    } catch (err) {
      console.error(`market-data-pipeline: failed to process ${instrument}`, err);
    }
  }
}
