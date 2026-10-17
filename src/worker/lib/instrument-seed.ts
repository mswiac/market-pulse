import type { Env } from '../index';
import {
  MarketDataFetchError,
  buildMarketDataUpserts,
  buildPriceHistoryUpserts,
  fetchDailyCloses,
  resolveCurrency,
} from './market-data';
import { RSI_INPUT_MAX_AGE_DAYS, rsiFromCloses } from './price-history';

// A slow Yahoo must not hold up the admin request for long (same idea as
// REFRESH_TIMEOUT_MS in routes/alerts.ts); one attempt, no retry.
const SEED_TIMEOUT_MS = 6000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface NewInstrument {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: boolean;
  provider: string;
  currency: string;
  suffix: string;
}

export type SeedResult =
  | { ok: true; instrument: NewInstrument; currencyCorrectedFrom: string | null }
  | { ok: false; reason: 'symbol_not_found' | 'provider_unavailable' };

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Creates the instrument together with its history and market_data in one
// batch, after proving Yahoo knows the symbol. A rejected add writes nothing.
// DB errors (for example a concurrent duplicate) propagate to the caller.
export async function seedInstrument(env: Env, instrument: NewInstrument): Promise<SeedResult> {
  const now = Date.now();
  // `to` is tomorrow: Yahoo's period2 is the start of that date, so today's own
  // close would be excluded otherwise (see fetchWithRetry in market-refresh.ts).
  const from = isoDate(now - RSI_INPUT_MAX_AGE_DAYS * MS_PER_DAY);
  const to = isoDate(now + MS_PER_DAY);

  let closes;
  let fetchedCurrency: string | null;
  try {
    ({ closes, currency: fetchedCurrency } = await fetchDailyCloses(
      instrument.ticker + instrument.suffix,
      from,
      to,
      AbortSignal.timeout(SEED_TIMEOUT_MS),
    ));
  } catch (err) {
    if (err instanceof MarketDataFetchError) {
      return { ok: false, reason: err.kind === 'not_found' ? 'symbol_not_found' : 'provider_unavailable' };
    }
    throw err;
  }
  if (closes.length === 0) return { ok: false, reason: 'symbol_not_found' };

  const currency = resolveCurrency(instrument.currency, fetchedCurrency);
  const created: NewInstrument = { ...instrument, currency };

  const latest = closes[closes.length - 1];
  const rsi = instrument.rsiEligible ? rsiFromCloses(new Map(closes.map((c) => [c.date, c.close]))) : null;

  // The instrument INSERT goes first: the RSI-eligibility trigger on
  // market_data looks the instrument up.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      created.ticker,
      created.name,
      created.type,
      created.rsiEligible ? 1 : 0,
      created.provider,
      created.currency,
      created.suffix,
    ),
    ...buildPriceHistoryUpserts(
      env.DB,
      closes.map((c) => ({ ticker: created.ticker, ...c })),
    ),
    ...buildMarketDataUpserts(env.DB, [{ ticker: created.ticker, price: latest.close, rsi, high: latest.high, low: latest.low }]),
  ]);

  const currencyCorrectedFrom = currency === instrument.currency ? null : instrument.currency;
  if (currencyCorrectedFrom) {
    console.log(`instrument-seed: corrected currency for ${created.ticker}: ${currencyCorrectedFrom} -> ${currency}`);
  }
  return { ok: true, instrument: created, currencyCorrectedFrom };
}
