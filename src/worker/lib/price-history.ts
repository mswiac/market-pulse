import { chunk } from './market-data';
import { calculateRSISeries } from './rsi';

// The single definition of how RSI is calculated in this system: every
// RSI the app stores, evaluates or shows is `latestRsi`/`buildHistory` over the
// newest RSI_INPUT_SESSIONS closes of a ticker. Wilder smoothing is recursive,
// so the result depends on how many closes feed it; ~100+ closes are needed
// for it to match charting tools, which use the full history.
export const HISTORY_DAYS = 30;
export const RSI_PERIOD = 14;
// Closes before the first displayed day, so the earliest displayed RSI is
// already converged.
export const RSI_WARMUP_SESSIONS = 150;
export const RSI_INPUT_SESSIONS = HISTORY_DAYS + RSI_WARMUP_SESSIONS;
// Calendar-day floor (relative to the newest stored date) that keeps the
// window query from scanning the whole table. 180 sessions fit well inside it
// even across long holiday gaps; a ticker whose last close is older than the
// floor shows no data.
const RSI_INPUT_MAX_AGE_DAYS = 300;
// One IN (...) list per chunk stays far below D1's 100-parameter cap.
const TICKERS_PER_QUERY = 90;

export interface PriceRow {
  date: string;
  close: number;
  high: number | null;
  low: number | null;
}

export interface HistoryEntry extends PriceRow {
  rsi: number | null;
}

export function latestRsi(closesAscending: number[]): number | null {
  return calculateRSISeries(closesAscending, RSI_PERIOD).at(-1) ?? null;
}

// Newest RSI_INPUT_SESSIONS rows per ticker, newest first, in one query per
// ticker chunk (a per-ticker loop would burn the Workers Free subrequest
// budget). `null` loads every ticker.
export async function loadRecentPriceRows(db: D1Database, tickers: string[] | null): Promise<Map<string, PriceRow[]>> {
  const byTicker = new Map<string, PriceRow[]>();
  const groups = tickers === null ? [null] : chunk(tickers, TICKERS_PER_QUERY);
  for (const group of groups) {
    const tickerFilter = group === null ? '' : `AND ticker IN (${group.map(() => '?').join(', ')})`;
    const { results } = await db
      .prepare(
        `SELECT ticker, date, close, high, low FROM (
           SELECT ticker, date, close, high, low,
                  ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
           FROM price_history
           WHERE date >= (SELECT date(MAX(date), '-${RSI_INPUT_MAX_AGE_DAYS} days') FROM price_history) ${tickerFilter}
         ) WHERE rn <= ?
         ORDER BY ticker, date DESC`,
      )
      .bind(...(group ?? []), RSI_INPUT_SESSIONS)
      .all<PriceRow & { ticker: string }>();
    for (const { ticker, ...row } of results) {
      const list = byTicker.get(ticker);
      if (list) list.push(row);
      else byTicker.set(ticker, [row]);
    }
  }
  return byTicker;
}

// Rows arrive newest-first (so a LIMIT keeps the most recent days); RSI
// smoothing must run oldest-to-newest, so reverse before computing.
export function buildHistory(newestFirst: PriceRow[], rsiEligible: boolean): HistoryEntry[] {
  const chronological = [...newestFirst].reverse();
  const rsiSeries = rsiEligible
    ? calculateRSISeries(chronological.map((row) => row.close), RSI_PERIOD)
    : chronological.map(() => null);

  return chronological
    .map((row, i) => ({ date: row.date, close: row.close, high: row.high, low: row.low, rsi: rsiSeries[i] }))
    .slice(-HISTORY_DAYS);
}
