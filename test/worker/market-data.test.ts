import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataFetchError, buildCurrencyCorrection, fetchDailyCloses, upsertPriceHistory } from '../../src/worker/lib/market-data';

const FROM = '2026-01-01';
const TO = '2026-01-31';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function validChartBody(
  timestamps: number[],
  closes: Array<number | null>,
  highs?: Array<number | null>,
  lows?: Array<number | null>,
  currency?: string,
) {
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: { quote: [{ close: closes, high: highs, low: lows }] },
          meta: currency ? { currency } : undefined,
        },
      ],
      error: null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchDailyCloses', () => {
  it('returns closes parsed from a valid Yahoo response', async () => {
    const body = validChartBody([1767620200, 1767706600], [100.5, 101.25]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX', FROM, TO);

    expect(result.closes).toEqual([
      { date: '2026-01-05', close: 100.5, high: null, low: null },
      { date: '2026-01-06', close: 101.25, high: null, low: null },
    ]);
  });

  it('parses high/low alongside close from a valid Yahoo response', async () => {
    const body = validChartBody([1767620200, 1767706600], [100.5, 101.25], [101, 102], [99, 100.5]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX', FROM, TO);

    expect(result.closes).toEqual([
      { date: '2026-01-05', close: 100.5, high: 101, low: 99 },
      { date: '2026-01-06', close: 101.25, high: 102, low: 100.5 },
    ]);
  });

  it('keeps a day with a valid close but null high/low, instead of dropping it', async () => {
    const body = validChartBody([1767620200, 1767706600], [100.5, 101.25], [101, null], [99, null]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX', FROM, TO);

    expect(result.closes).toEqual([
      { date: '2026-01-05', close: 100.5, high: 101, low: 99 },
      { date: '2026-01-06', close: 101.25, high: null, low: null },
    ]);
  });

  it('throws MarketDataFetchError on an HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(fetchDailyCloses('^VIX', FROM, TO)).rejects.toThrow(MarketDataFetchError);
  });

  it('throws MarketDataFetchError when chart.error is non-null', async () => {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(fetchDailyCloses('^BADSYMBOL', FROM, TO)).rejects.toThrow(MarketDataFetchError);
  });

  it('filters out a trailing null close without throwing', async () => {
    const body = validChartBody([1767620200, 1767706600], [100.5, null]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^NDX', FROM, TO);

    expect(result.closes).toEqual([{ date: '2026-01-05', close: 100.5, high: null, low: null }]);
  });

  it('throws MarketDataFetchError when the body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { chart: { result: [{}], error: null } })));

    await expect(fetchDailyCloses('^VIX', FROM, TO)).rejects.toThrow(MarketDataFetchError);
  });

  it('throws MarketDataFetchError when every close is null', async () => {
    const body = validChartBody([1767620200], [null]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(fetchDailyCloses('^VIX', FROM, TO)).rejects.toThrow(MarketDataFetchError);
  });

  it('throws MarketDataFetchError when timestamps are not strictly ascending', async () => {
    const body = validChartBody([1767706600, 1767620200], [101.25, 100.5]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(fetchDailyCloses('^VIX', FROM, TO)).rejects.toThrow(MarketDataFetchError);
  });

  it('returns an empty closes array when the range has no trading days, instead of throwing', async () => {
    const body = validChartBody([], []);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX', '2026-01-03', '2026-01-04');

    expect(result.closes).toEqual([]);
  });

  it('builds the Yahoo request URL with period1/period2 derived from from/to', async () => {
    const body = validChartBody([1767620200], [100.5]);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await fetchDailyCloses('^VIX', '2026-01-01', '2026-01-31');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const period1 = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000);
    const period2 = Math.floor(Date.parse('2026-01-31T00:00:00Z') / 1000);
    expect(calledUrl).toContain(`period1=${period1}`);
    expect(calledUrl).toContain(`period2=${period2}`);
    expect(calledUrl).not.toContain('range=');
  });

  it('parses currency from meta.currency alongside closes', async () => {
    const body = validChartBody([1767620200], [100.5], undefined, undefined, 'PLN');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('CDR.WA', FROM, TO);

    expect(result.currency).toBe('PLN');
  });

  it('resolves currency to null when meta is absent, without throwing', async () => {
    const body = validChartBody([1767620200], [100.5]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX', FROM, TO);

    expect(result.currency).toBeNull();
  });
});

describe('upsertPriceHistory', () => {
  it('builds one price_history upsert statement per close', () => {
    const bound: Array<{ sql: string; args: unknown[] }> = [];
    const fakeDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          bound.push({ sql, args });
          return { sql, args };
        },
      }),
    } as unknown as D1Database;

    const closes = [
      { date: '2026-01-05', close: 100.5, high: 101, low: 99 },
      { date: '2026-01-06', close: 101.25, high: null, low: null },
    ];

    const statements = upsertPriceHistory(fakeDb, '^VIX', closes);

    expect(statements).toHaveLength(2);
    expect(bound[0].args).toEqual(['^VIX', '2026-01-05', 100.5, 101, 99]);
    expect(bound[1].args).toEqual(['^VIX', '2026-01-06', 101.25, null, null]);
    expect(bound[0].sql).toContain('INSERT INTO price_history');
    expect(bound[0].sql).toContain('ON CONFLICT (ticker, date) DO UPDATE');
  });

  it('returns an empty array for an empty closes list', () => {
    const fakeDb = { prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database;

    expect(upsertPriceHistory(fakeDb, '^VIX', [])).toEqual([]);
  });
});

describe('buildCurrencyCorrection', () => {
  function fakeDb(): { db: D1Database; bound: Array<{ sql: string; args: unknown[] }> } {
    const bound: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          bound.push({ sql, args });
          return { sql, args };
        },
      }),
    } as unknown as D1Database;
    return { db, bound };
  }

  it('returns null when the fetched currency matches the stored one', () => {
    const { db } = fakeDb();
    expect(buildCurrencyCorrection(db, 'CDR', 'PLN', 'PLN')).toBeNull();
  });

  it('returns null when the fetched currency is null', () => {
    const { db } = fakeDb();
    expect(buildCurrencyCorrection(db, 'CDR', 'PLN', null)).toBeNull();
  });

  it('returns a bound UPDATE statement when currencies differ', () => {
    const { db, bound } = fakeDb();
    const statement = buildCurrencyCorrection(db, 'CDR', 'USD', 'PLN');

    expect(statement).not.toBeNull();
    expect(bound[0].sql).toContain('UPDATE instruments SET currency = ?');
    expect(bound[0].args).toEqual(['PLN', 'CDR']);
  });

  it('returns null when the fetched currency is not a well-formed 3-letter code, even if it differs from stored', () => {
    const { db } = fakeDb();
    expect(buildCurrencyCorrection(db, 'CDR', 'USD', 'pln')).toBeNull();
    expect(buildCurrencyCorrection(db, 'CDR', 'USD', 'PLZLOTY')).toBeNull();
    expect(buildCurrencyCorrection(db, 'CDR', 'USD', '')).toBeNull();
  });
});
