import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Unlike other test files (which call exports.default.fetch(...) from
// 'cloudflare:workers'), this one imports the worker module directly:
// exports.default.scheduled(...) throws `DataCloneError: Could not
// serialize object of type "ScheduledController"` — that type isn't
// structured-cloneable across the exports RPC boundary. Do not "fix" this
// back to the exports.default pattern.
import worker from '../../src/worker/index';

function yahooBody(
  timestamps: number[],
  closes: Array<number | null>,
  highs?: Array<number | null>,
  lows?: Array<number | null>,
) {
  return {
    chart: {
      result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes, high: highs, low: lows }] } }],
      error: null,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

interface MarketDataRow {
  ticker: string;
  price: number;
  rsi: number | null;
  high: number | null;
  low: number | null;
  updated_at: number;
}

// 15 ascending trading-day timestamps (13:30 UTC), enough to seed RSI(14).
const TIMESTAMPS = Array.from({ length: 15 }, (_, i) => 1767620200 + i * 86400);
const RISING_CLOSES = Array.from({ length: 15 }, (_, i) => 100 + i);
const RISING_HIGHS = RISING_CLOSES.map((c) => c + 1);
const RISING_LOWS = RISING_CLOSES.map((c) => c - 1);

async function runScheduled(): Promise<void> {
  const controller = createScheduledController();
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

beforeEach(async () => {
  // This project's D1 test binding isn't isolated per test (see other suites'
  // use of unique emails for the same reason) — clear both tables explicitly
  // so one test's writes can't leak into the next.
  await env.DB.batch([env.DB.prepare('DELETE FROM market_data'), env.DB.prepare('DELETE FROM price_history')]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scheduled handler', () => {
  it('writes price_history and market_data for both instruments on success', async () => {
    // A Response body can only be read once, so each fetch() call needs a
    // fresh Response instance — mockResolvedValue would reuse (and exhaust)
    // the same one across the two instrument fetches.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS))),
        ),
    );

    await runScheduled();

    const marketData = await env.DB.prepare('SELECT * FROM market_data ORDER BY ticker').all<MarketDataRow>();
    expect(marketData.results).toHaveLength(2);

    const vix = marketData.results.find((r) => r.ticker === '^VIX');
    const nasdaq = marketData.results.find((r) => r.ticker === '^NDX');
    expect(vix?.rsi).toBeNull();
    expect(typeof nasdaq?.rsi).toBe('number');
    expect(nasdaq?.rsi).toBe(100); // strictly rising closes -> avgLoss 0 -> RSI 100

    const latestHigh = RISING_HIGHS[RISING_HIGHS.length - 1];
    const latestLow = RISING_LOWS[RISING_LOWS.length - 1];
    expect(nasdaq?.high).toBe(latestHigh);
    expect(nasdaq?.low).toBe(latestLow);

    const priceHistory = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM price_history WHERE ticker = ?',
    )
      .bind('^NDX')
      .first<{ count: number }>();
    expect(priceHistory?.count).toBe(15);

    const latestPriceHistoryRow = await env.DB.prepare(
      'SELECT high, low FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1',
    )
      .bind('^NDX')
      .first<{ high: number; low: number }>();
    expect(latestPriceHistoryRow?.high).toBe(latestHigh);
    expect(latestPriceHistoryRow?.low).toBe(latestLow);
  });

  it('still writes the other instrument when one fetch fails after retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes(encodeURIComponent('^VIX'))) {
          return Promise.resolve(jsonResponse(500, {}));
        }
        return Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)));
      }),
    );

    await runScheduled();

    const marketData = await env.DB.prepare('SELECT * FROM market_data ORDER BY ticker').all<MarketDataRow>();
    expect(marketData.results).toHaveLength(1);
    expect(marketData.results[0]?.ticker).toBe('^NDX');
  });

  it('does not create duplicate price_history rows on overlapping re-runs, and overwrites high/low', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS))),
      );
    vi.stubGlobal('fetch', fetchMock);
    await runScheduled();

    // Second run returns revised high/low for the same days — the upsert
    // must overwrite, not just dedupe on (ticker, date).
    const revisedHighs = RISING_HIGHS.map((h) => h + 5);
    const revisedLows = RISING_LOWS.map((l) => l - 5);
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, revisedHighs, revisedLows))),
    );
    await runScheduled();

    const priceHistory = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM price_history WHERE ticker = ?',
    )
      .bind('^NDX')
      .first<{ count: number }>();
    expect(priceHistory?.count).toBe(15);

    const latestRow = await env.DB.prepare('SELECT high, low FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1')
      .bind('^NDX')
      .first<{ high: number; low: number }>();
    expect(latestRow?.high).toBe(revisedHighs[revisedHighs.length - 1]);
    expect(latestRow?.low).toBe(revisedLows[revisedLows.length - 1]);

    const marketData = await env.DB.prepare('SELECT high, low FROM market_data WHERE ticker = ?')
      .bind('^NDX')
      .first<{ high: number; low: number }>();
    expect(marketData?.high).toBe(revisedHighs[revisedHighs.length - 1]);
    expect(marketData?.low).toBe(revisedLows[revisedLows.length - 1]);
  });

  it('logs and returns without writing anything when the instruments registry query fails', async () => {
    await env.DB.exec('DROP TABLE instruments');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(runScheduled()).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'market-data-pipeline: failed to load instruments registry',
        expect.anything(),
      );

      const marketData = await env.DB.prepare('SELECT * FROM market_data').all();
      expect(marketData.results).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
      // D1's exec() splits statements on newlines, not on semicolons — each
      // statement below must stay on a single line.
      await env.DB.exec(
        "CREATE TABLE instruments (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('index')), rsi_eligible INTEGER NOT NULL, provider TEXT NOT NULL);\n" +
          "INSERT INTO instruments (ticker, name, type, rsi_eligible, provider) VALUES ('^VIX', 'VIX', 'index', 0, 'yahoo'), ('^NDX', 'NASDAQ-100', 'index', 1, 'yahoo');",
      );
    }
  });
});
