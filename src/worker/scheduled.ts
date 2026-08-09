import type { Env } from './index';
import { evaluateAlerts } from './lib/alert-evaluation';
import type { InstrumentRow } from './lib/instruments';
import { buildCurrencyCorrection, fetchDailyCloses, upsertPriceHistory, type DailyClosesResult } from './lib/market-data';
import { calculateRSI } from './lib/rsi';

const RETRY_ATTEMPTS = 3;
// Fixed delay, no backoff — deliberate simplification at current volume (2 tickers/day).
const RETRY_DELAY_MS = 300;
// Cron's fixed lookback window, expressed as explicit dates now that
// fetchDailyCloses takes a date range instead of an implicit default.
const CRON_LOOKBACK_DAYS = 30;

function dateToIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchWithRetry(symbol: string): Promise<DailyClosesResult> {
  const to = dateToIsoDateString(new Date());
  const from = dateToIsoDateString(new Date(Date.now() - CRON_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchDailyCloses(symbol, from, to);
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
    const { results } = await env.DB.prepare(`SELECT ticker, rsi_eligible, suffix, currency FROM instruments`).all<InstrumentRow>();
    instruments = results;
  } catch (err) {
    console.error('market-data-pipeline: failed to load instruments registry', err);
    return;
  }

  for (const { ticker, rsi_eligible, suffix, currency } of instruments) {
    try {
      // `ticker + suffix` is the Yahoo query symbol only — every DB write
      // below stays keyed on the bare `ticker` (see market-data.ts).
      const { closes, currency: fetchedCurrency } = await fetchWithRetry(ticker + suffix);
      if (closes.length === 0) {
        // Unreachable in practice — the cron's 30-day window always spans
        // trading days — but fetchDailyCloses's contract now allows an empty
        // result (see market-data.ts), so guard rather than write undefined
        // fields from a missing `latest`.
        continue;
      }
      const rsi = rsi_eligible ? calculateRSI(closes.map((c) => c.close)) : null;
      const latest = closes[closes.length - 1];

      const statements = upsertPriceHistory(env.DB, ticker, closes);

      statements.push(
        env.DB.prepare(
          `INSERT INTO market_data (ticker, price, rsi, high, low, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, high = excluded.high, low = excluded.low, updated_at = excluded.updated_at`,
        ).bind(ticker, latest.close, rsi, latest.high, latest.low),
      );

      const currencyCorrection = buildCurrencyCorrection(env.DB, ticker, currency, fetchedCurrency);
      if (currencyCorrection) {
        statements.push(currencyCorrection);
        console.log(`market-data-pipeline: corrected currency for ${ticker}: ${currency} -> ${fetchedCurrency}`);
      }

      await env.DB.batch(statements);
    } catch (err) {
      console.error(`market-data-pipeline: failed to process ${ticker}`, err);
    }
  }

  await evaluateAlerts(env);
}
