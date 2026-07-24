import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataFetchError, fetchDailyCloses } from '../../src/worker/lib/market-data';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function validChartBody(timestamps: number[], closes: Array<number | null>) {
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
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
    // 2026-01-05 and 2026-01-06, 13:30 UTC (market open) — only the date matters.
    const body = validChartBody([1767620200, 1767706600], [100.5, 101.25]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^VIX');

    expect(result).toEqual([
      { date: '2026-01-05', close: 100.5 },
      { date: '2026-01-06', close: 101.25 },
    ]);
  });

  it('throws MarketDataFetchError on an HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(fetchDailyCloses('^VIX')).rejects.toThrow(MarketDataFetchError);
  });

  it('throws MarketDataFetchError when chart.error is non-null', async () => {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(fetchDailyCloses('^BADSYMBOL')).rejects.toThrow(MarketDataFetchError);
  });

  it('filters out a trailing null close without throwing', async () => {
    const body = validChartBody([1767620200, 1767706600], [100.5, null]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchDailyCloses('^NDX');

    expect(result).toEqual([{ date: '2026-01-05', close: 100.5 }]);
  });

  it('throws MarketDataFetchError when the body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { chart: { result: [{}], error: null } })));

    await expect(fetchDailyCloses('^VIX')).rejects.toThrow(MarketDataFetchError);
  });

  it('throws MarketDataFetchError when every close is null', async () => {
    const body = validChartBody([1767620200], [null]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(fetchDailyCloses('^VIX')).rejects.toThrow(MarketDataFetchError);
  });
});
