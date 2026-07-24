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

function yahooBody(timestamps: number[], closes: Array<number | null>) {
  return {
    chart: {
      result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }],
      error: null,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

interface MarketDataRow {
  instrument: string;
  price: number;
  rsi: number | null;
  updated_at: number;
}

// 15 ascending trading-day timestamps (13:30 UTC), enough to seed RSI(14).
const TIMESTAMPS = Array.from({ length: 15 }, (_, i) => 1767620200 + i * 86400);
const RISING_CLOSES = Array.from({ length: 15 }, (_, i) => 100 + i);

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
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)))),
    );

    await runScheduled();

    const marketData = await env.DB.prepare('SELECT * FROM market_data ORDER BY instrument').all<MarketDataRow>();
    expect(marketData.results).toHaveLength(2);

    const vix = marketData.results.find((r) => r.instrument === 'VIX');
    const nasdaq = marketData.results.find((r) => r.instrument === 'NASDAQ100');
    expect(vix?.rsi).toBeNull();
    expect(typeof nasdaq?.rsi).toBe('number');
    expect(nasdaq?.rsi).toBe(100); // strictly rising closes -> avgLoss 0 -> RSI 100

    const priceHistory = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM price_history WHERE instrument = ?',
    )
      .bind('NASDAQ100')
      .first<{ count: number }>();
    expect(priceHistory?.count).toBe(15);
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

    const marketData = await env.DB.prepare('SELECT * FROM market_data ORDER BY instrument').all<MarketDataRow>();
    expect(marketData.results).toHaveLength(1);
    expect(marketData.results[0]?.instrument).toBe('NASDAQ100');
  });

  it('does not create duplicate price_history rows on overlapping re-runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)))),
    );

    await runScheduled();
    await runScheduled();

    const priceHistory = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM price_history WHERE instrument = ?',
    )
      .bind('NASDAQ100')
      .first<{ count: number }>();
    expect(priceHistory?.count).toBe(15);
  });
});
