export const YAHOO_SYMBOLS: Record<'VIX' | 'NASDAQ100', string> = {
  VIX: '^VIX',
  NASDAQ100: '^NDX',
};

export interface DailyClose {
  date: string;
  close: number;
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
    quote?: Array<{ close?: Array<number | null> }>;
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

export async function fetchDailyCloses(symbol: string): Promise<DailyClose[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;

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
  const closes = result?.indicators?.quote?.[0]?.close;

  if (!timestamps || !closes || timestamps.length !== closes.length) {
    throw new MarketDataFetchError(`Yahoo response for ${symbol} has an unexpected shape`);
  }

  const dailyCloses: DailyClose[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined) continue;
    dailyCloses.push({ date: toIsoDate(timestamps[i]), close });
  }

  if (dailyCloses.length === 0) {
    throw new MarketDataFetchError(`Yahoo response for ${symbol} contained no valid closes`);
  }

  return dailyCloses;
}
