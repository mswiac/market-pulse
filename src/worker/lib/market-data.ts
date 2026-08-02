export interface DailyClose {
  date: string;
  close: number;
  high: number | null;
  low: number | null;
}

export class MarketDataFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketDataFetchError';
  }
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{ close?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null> }>;
  };
}

interface YahooChartResponse {
  chart: {
    result?: YahooChartResult[] | null;
    error?: unknown;
  };
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// UTC midnight for the given YYYY-MM-DD, in whole seconds — matches Yahoo's
// period1/period2 units and keeps the conversion independent of the host's
// local timezone.
function toUnixSeconds(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / 1000;
}

export async function fetchDailyCloses(symbol: string, from: string, to: string): Promise<DailyClose[]> {
  const period1 = toUnixSeconds(from);
  const period2 = toUnixSeconds(to);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new MarketDataFetchError(`Yahoo request failed for ${symbol}: HTTP ${response.status}`);
  }

  let body: YahooChartResponse;
  try {
    body = (await response.json()) as YahooChartResponse;
  } catch {
    throw new MarketDataFetchError(`Yahoo response for ${symbol} is not valid JSON`);
  }

  if (body.chart?.error) {
    throw new MarketDataFetchError(`Yahoo chart error for ${symbol}: ${JSON.stringify(body.chart.error)}`);
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close;
  const highs = quote?.high;
  const lows = quote?.low;

  if (!timestamps || !closes || timestamps.length !== closes.length) {
    throw new MarketDataFetchError(`Yahoo response for ${symbol} has an unexpected shape`);
  }

  // A date range with no trading days (e.g. a weekend-only admin backfill
  // request) is a valid "zero results" outcome, not a fetch failure — Yahoo
  // returns an empty timestamp array rather than an error for this case.
  // This is distinct from the "every close is null" case below, where
  // timestamps exist but the data itself looks broken — that still throws.
  if (timestamps.length === 0) {
    return [];
  }

  // calculateRSI() and "latest price" both assume ascending order — Yahoo's
  // endpoint is unofficial, so fail loudly instead of silently trusting it.
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] <= timestamps[i - 1]) {
      throw new MarketDataFetchError(`Yahoo response for ${symbol} has non-ascending timestamps`);
    }
  }

  const dailyCloses: DailyClose[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined) continue;
    // A day with a valid close but missing high/low is kept (nulls for
    // high/low), unlike a missing close which drops the whole day — Yahoo
    // omitting high/low doesn't mean the close itself is untrustworthy.
    const high = highs?.[i] ?? null;
    const low = lows?.[i] ?? null;
    dailyCloses.push({ date: toIsoDate(timestamps[i]), close, high, low });
  }

  if (dailyCloses.length === 0) {
    throw new MarketDataFetchError(`Yahoo response for ${symbol} contained no valid closes`);
  }

  return dailyCloses;
}

// Pure statement-building — no db.batch() call here, so this stays testable
// without a live D1 round-trip and lets each caller decide how to batch
// (the cron bundles its own market_data statement into the same batch; the
// admin endpoint batches only these).
export function upsertPriceHistory(db: D1Database, ticker: string, closes: DailyClose[]): D1PreparedStatement[] {
  return closes.map(({ date, close, high, low }) =>
    db
      .prepare(
        `INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (ticker, date) DO UPDATE SET close = excluded.close, high = excluded.high, low = excluded.low`,
      )
      .bind(ticker, date, close, high, low),
  );
}
