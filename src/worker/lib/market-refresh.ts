import type { Env } from '../index';
import type { InstrumentRow } from './instruments';
import {
  buildCurrencyCorrection,
  buildMarketDataUpserts,
  buildPriceHistoryUpserts,
  chunk,
  fetchDailyCloses,
  type DailyClosesResult,
  type MarketDataUpsertRow,
  type PriceHistoryRow,
} from './market-data';
import { calculateRSI } from './rsi';

export interface TickerResult {
  ticker: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface FetchPhaseResult {
  tickers: TickerResult[];
  loadError: string | null;
}

const RETRY_ATTEMPTS = 3;
// Fixed delay, no backoff — deliberate simplification: the per-run attempt
// cap below, not the delay, is what bounds a flaky provider's cost.
const RETRY_DELAY_MS = 300;
// Routine runs only need the last few days from Yahoo: older closes are
// already in price_history, and the overlap backfills recent gaps and
// self-corrects a not-yet-final daily bar (the upsert is idempotent). Seven
// days spans a long holiday weekend, so the window is never empty.
const SHORT_LOOKBACK_DAYS = 7;
// Used for RSI history and as the Yahoo window for a ticker whose stored
// history is too thin to seed RSI.
const LONG_LOOKBACK_DAYS = 30;
// calculateRSI needs period + 1 closes (see rsi.ts).
const MIN_CLOSES_FOR_RSI = 15;
// Workers Free allows 50 subrequests per invocation and D1 queries count
// toward it. Fetch attempts are capped below that so the fixed D1 calls always
// fit, and a few flaky tickers retrying cannot exhaust the budget mid-run.
// Each cron fetch trigger and each admin per-market fetch request gets this
// budget on its own.
const MAX_FETCH_ATTEMPTS_PER_RUN = 40;
// A bound-parameter budget: one IN (...) list per chunk stays far below D1's
// 100-parameter cap.
const TICKERS_PER_HISTORY_QUERY = 90;

function dateToIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return dateToIsoDateString(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

interface FetchBudget {
  attempts: number;
}

async function fetchWithRetry(
  symbol: string,
  lookbackDays: number,
  budget: FetchBudget,
  retryAttempts: number,
  timeoutMs?: number,
): Promise<DailyClosesResult> {
  // `to` must be TOMORROW's date, not today's. Yahoo's period2 bound is UTC
  // midnight of that date (the START of it), while a daily bar is stamped
  // later in the day (e.g. GPW closes are stamped ~07:00 UTC) — using
  // today's date here excludes today's own close from every single run,
  // no matter what time the cron actually fires. Confirmed empirically
  // against the live Yahoo endpoint (see plan.md history for this fix).
  const to = dateToIsoDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const from = daysAgo(lookbackDays);

  let lastError: unknown;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    if (budget.attempts >= MAX_FETCH_ATTEMPTS_PER_RUN) {
      // Keep the provider's own error when this ticker already failed at
      // least once, so the run summary shows the real cause.
      throw new Error(
        lastError === undefined
          ? 'fetch attempt budget exhausted for this run'
          : `fetch attempt budget exhausted for this run (last error: ${String(lastError)})`,
      );
    }
    budget.attempts++;
    try {
      return await fetchDailyCloses(symbol, from, to, timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs));
    } catch (err) {
      lastError = err;
      if (attempt < retryAttempts) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

// One query per chunk of tickers instead of one per ticker. A failure here
// is not fatal: callers treat a missing history as "thin" and fall back to
// the long Yahoo window, which is slower but yields the same RSI.
async function loadStoredCloses(db: D1Database, tickers: string[]): Promise<Map<string, Map<string, number>>> {
  const byTicker = new Map<string, Map<string, number>>();
  if (tickers.length === 0) return byTicker;
  try {
    const since = daysAgo(LONG_LOOKBACK_DAYS);
    for (const group of chunk(tickers, TICKERS_PER_HISTORY_QUERY)) {
      const { results } = await db
        .prepare(
          `SELECT ticker, date, close FROM price_history
           WHERE date >= ? AND ticker IN (${group.map(() => '?').join(', ')})`,
        )
        .bind(since, ...group)
        .all<{ ticker: string; date: string; close: number }>();
      for (const { ticker, date, close } of results) {
        let closes = byTicker.get(ticker);
        if (!closes) {
          closes = new Map();
          byTicker.set(ticker, closes);
        }
        closes.set(date, close);
      }
    }
  } catch (err) {
    console.error('market-data-pipeline: failed to read stored closes, falling back to long fetch window', err);
    byTicker.clear();
  }
  return byTicker;
}

// Shared by the cron fetch phase and, on demand, by alert create/edit (which
// refreshes a stale ticker), where a single attempt and a `timeoutMs` keep the user's request
// from hanging on a slow provider, and `fullWindow` fetches the whole 30
// days: a ticker that was not refreshed for weeks has a gap in its stored
// history that the short window would not fill.
export async function refreshInstruments(
  env: Env,
  instruments: InstrumentRow[],
  {
    retryAttempts = RETRY_ATTEMPTS,
    fullWindow = false,
    timeoutMs,
  }: { retryAttempts?: number; fullWindow?: boolean; timeoutMs?: number } = {},
): Promise<FetchPhaseResult> {
  const tickers: TickerResult[] = [];
  const budget: FetchBudget = { attempts: 0 };
  const stored = fullWindow
    ? new Map<string, Map<string, number>>()
    : await loadStoredCloses(
        env.DB,
        instruments.filter((i) => i.rsi_eligible).map((i) => i.ticker),
      );

  const priceRows: PriceHistoryRow[] = [];
  const marketRows: MarketDataUpsertRow[] = [];
  const corrections: D1PreparedStatement[] = [];
  const correctionLogs: string[] = [];
  const pending: string[] = [];

  for (const { ticker, rsi_eligible, suffix, currency } of instruments) {
    try {
      const storedCloses = stored.get(ticker);
      // A ticker with too little stored history cannot seed RSI from a short
      // window, so it gets the long window once and fills its own history.
      const lookbackDays =
        fullWindow || (rsi_eligible && (storedCloses?.size ?? 0) < MIN_CLOSES_FOR_RSI) ? LONG_LOOKBACK_DAYS : SHORT_LOOKBACK_DAYS;

      // `ticker + suffix` is the Yahoo query symbol only — every DB write
      // below stays keyed on the bare `ticker` (see market-data.ts).
      const { closes, currency: fetchedCurrency } = await fetchWithRetry(ticker + suffix, lookbackDays, budget, retryAttempts, timeoutMs);
      if (closes.length === 0) {
        // Unreachable in practice — the window always spans trading days —
        // but fetchDailyCloses's contract allows an empty result (see
        // market-data.ts), so guard rather than write undefined fields
        // from a missing `latest`.
        tickers.push({ ticker, status: 'ok' });
        continue;
      }

      let rsi: number | null = null;
      if (rsi_eligible) {
        // Fetched closes win over stored ones for the same date, so a
        // revised bar is reflected in this run's RSI.
        const merged = new Map(storedCloses ?? []);
        for (const c of closes) merged.set(c.date, c.close);
        rsi = calculateRSI([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, close]) => close));
      }
      const latest = closes[closes.length - 1];

      for (const c of closes) priceRows.push({ ticker, ...c });
      marketRows.push({ ticker, price: latest.close, rsi, high: latest.high, low: latest.low });

      const correction = buildCurrencyCorrection(env.DB, ticker, currency, fetchedCurrency);
      if (correction) {
        corrections.push(correction);
        correctionLogs.push(`market-data-pipeline: corrected currency for ${ticker}: ${currency} -> ${fetchedCurrency}`);
      }
      pending.push(ticker);
    } catch (err) {
      console.error(`market-data-pipeline: failed to process ${ticker}`, err);
      tickers.push({ ticker, status: 'error', error: String(err) });
    }
  }

  const statements = [
    ...buildPriceHistoryUpserts(env.DB, priceRows),
    ...buildMarketDataUpserts(env.DB, marketRows),
    ...corrections,
  ];
  if (statements.length > 0) {
    try {
      await env.DB.batch(statements);
      for (const message of correctionLogs) console.log(message);
      for (const ticker of pending) tickers.push({ ticker, status: 'ok' });
    } catch (err) {
      // D1 batches are transactional, so a failed write means none of the
      // fetched tickers landed.
      console.error('market-data-pipeline: failed to write fetched market data', err);
      for (const ticker of pending) tickers.push({ ticker, status: 'error', error: String(err) });
    }
  }

  return { tickers, loadError: null };
}
