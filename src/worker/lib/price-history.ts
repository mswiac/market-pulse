import { calculateRSISeries } from './rsi';

export const HISTORY_DAYS = 30;
export const RSI_PERIOD = 14;
// Extra days beyond the display window so the earliest displayed day can
// still have an RSI value — RSI at any index needs `period` prior closes.
export const LOOKBACK_DAYS = HISTORY_DAYS + RSI_PERIOD;

export interface PriceRow {
  date: string;
  close: number;
  high: number | null;
  low: number | null;
}

export interface HistoryEntry extends PriceRow {
  rsi: number | null;
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
