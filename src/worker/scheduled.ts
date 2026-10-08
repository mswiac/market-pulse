import type { Env } from './index';
import { evaluateAlerts, type AlertEvaluationSummary } from './lib/alert-evaluation';
import { ALL_INSTRUMENT_TYPES, selectAlertInstruments } from './lib/instruments';
import {
  buildCurrencyCorrection,
  buildMarketDataUpserts,
  buildPriceHistoryUpserts,
  chunk,
  fetchDailyCloses,
  type DailyClosesResult,
  type MarketDataUpsertRow,
  type PriceHistoryRow,
} from './lib/market-data';
import { calculateRSI } from './lib/rsi';

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
// toward it. Fetch attempts are capped below that so the fixed D1 calls (and
// the alert evaluation that still shares this invocation) always fit, and a
// few flaky tickers retrying cannot exhaust the budget mid-run.
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

async function fetchWithRetry(symbol: string, lookbackDays: number, budget: FetchBudget): Promise<DailyClosesResult> {
  // `to` must be TOMORROW's date, not today's. Yahoo's period2 bound is UTC
  // midnight of that date (the START of it), while a daily bar is stamped
  // later in the day (e.g. GPW closes are stamped ~07:00 UTC) — using
  // today's date here excludes today's own close from every single run,
  // no matter what time the cron actually fires. Confirmed empirically
  // against the live Yahoo endpoint (see plan.md history for this fix).
  const to = dateToIsoDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const from = daysAgo(lookbackDays);

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (budget.attempts >= MAX_FETCH_ATTEMPTS_PER_RUN) {
      throw new Error('fetch attempt budget exhausted for this run');
    }
    budget.attempts++;
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

export interface CronRunSummary {
  tickers: Array<{ ticker: string; status: 'ok' | 'error'; error?: string }>;
  alertsEvaluated: number;
  emails: AlertEvaluationSummary['emails'];
  errors: string[];
}

export interface FetchPhaseResult {
  tickers: CronRunSummary['tickers'];
  loadError: string | null;
}

export async function runFetchPhase(env: Env, types: string[] = ALL_INSTRUMENT_TYPES): Promise<FetchPhaseResult> {
  let instruments;
  try {
    instruments = await selectAlertInstruments(env.DB, types);
  } catch (err) {
    console.error('market-data-pipeline: failed to load instruments registry', err);
    return { tickers: [], loadError: String(err) };
  }

  const tickers: CronRunSummary['tickers'] = [];
  const budget: FetchBudget = { attempts: 0 };
  const stored = await loadStoredCloses(
    env.DB,
    instruments.filter((i) => i.rsi_eligible).map((i) => i.ticker),
  );

  const priceRows: PriceHistoryRow[] = [];
  const marketRows: MarketDataUpsertRow[] = [];
  const corrections: D1PreparedStatement[] = [];
  const pending: string[] = [];

  for (const { ticker, rsi_eligible, suffix, currency } of instruments) {
    try {
      const storedCloses = stored.get(ticker);
      // A ticker with too little stored history cannot seed RSI from a short
      // window, so it gets the long window once and fills its own history.
      const lookbackDays =
        rsi_eligible && (storedCloses?.size ?? 0) < MIN_CLOSES_FOR_RSI ? LONG_LOOKBACK_DAYS : SHORT_LOOKBACK_DAYS;

      // `ticker + suffix` is the Yahoo query symbol only — every DB write
      // below stays keyed on the bare `ticker` (see market-data.ts).
      const { closes, currency: fetchedCurrency } = await fetchWithRetry(ticker + suffix, lookbackDays, budget);
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
        console.log(`market-data-pipeline: correcting currency for ${ticker}: ${currency} -> ${fetchedCurrency}`);
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

export async function handleScheduled(env: Env): Promise<CronRunSummary> {
  const { tickers, loadError } = await runFetchPhase(env);
  if (loadError) {
    return { tickers: [], alertsEvaluated: 0, emails: [], errors: [loadError] };
  }

  const alertSummary = await evaluateAlerts(env);

  return {
    tickers,
    alertsEvaluated: alertSummary.alertsEvaluated,
    emails: alertSummary.emails,
    errors: alertSummary.errors,
  };
}
