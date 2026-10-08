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
// The exported `scheduled` handler discards handleScheduled's return value
// (see src/worker/index.ts) — the summary tests below call handleScheduled
// directly instead of going through worker.scheduled(...).
import { refreshInstruments } from '../../src/worker/lib/market-refresh';
import { EVALUATE_CRON, FETCH_CRON, handleCron, handleScheduled } from '../../src/worker/scheduled';
import { calculateRSI } from '../../src/worker/lib/rsi';
import wranglerToml from '../../wrangler.toml?raw';

function yahooBody(
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
  const controller = createScheduledController({ cron: FETCH_CRON });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

// The cron only fetches instruments that have at least one alert, so every
// test that expects a ticker to be fetched must seed one for it first.
let seededUserId: number;

async function seedAlert(ticker: string, armed = 1): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email, direction, armed) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(seededUserId, ticker, 'PRICE', 1_000_000 + Math.floor(Math.random() * 1_000_000), 'verified@example.com', 'up', armed)
    .run();
}

async function insertSuffixInstrument(currency = 'PLN'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind('TEST', 'Test SA', 'pl_stock', 0, 'yahoo', currency, '.WA')
    .run();
  await seedAlert('TEST');
}

beforeEach(async () => {
  // This project's D1 test binding isn't isolated per test (see other suites'
  // use of unique emails for the same reason) — clear both tables explicitly
  // so one test's writes can't leak into the next.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM market_data'),
    env.DB.prepare('DELETE FROM price_history'),
    env.DB.prepare('DELETE FROM alerts'),
  ]);
  const email = `cron-${crypto.randomUUID()}@example.com`;
  const user = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(email, 'irrelevant-hash').run();
  seededUserId = user.meta.last_row_id as number;
  await seedAlert('^VIX');
  await seedAlert('^NDX');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // The cron now fetches every instrument (no more `provider='yahoo'`
  // filter) — a leftover test-added row would otherwise leak into the next
  // test's fetch-call/result-count assertions.
  await env.DB.prepare("DELETE FROM instruments WHERE ticker = 'TEST' OR ticker LIKE 'CAP%'").run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(seededUserId).run();
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
      // statement below must stay on a single line. `currency`/`suffix`
      // mirror migrations/0010_instrument_currency.sql and
      // migrations/0015_instruments_suffix.sql respectively (both DEFAULT,
      // so the seeded ^VIX/^NDX rows below need no explicit value) — this
      // table isn't reset per test (D1 test binding is shared across the
      // whole file), so every column any later test in this file might
      // touch must be present here too, not just the ones this test itself
      // needs.
      await env.DB.exec(
        "CREATE TABLE instruments (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('index', 'pl_stock', 'us_stock')), rsi_eligible INTEGER NOT NULL, provider TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', suffix TEXT NOT NULL DEFAULT '');\n" +
          "INSERT INTO instruments (ticker, name, type, rsi_eligible, provider) VALUES ('^VIX', 'VIX', 'index', 0, 'yahoo'), ('^NDX', 'NASDAQ-100', 'index', 1, 'yahoo');",
      );
    }
  });

  it('fetches a suffix-bearing instrument via ticker+suffix, writing DB rows under the bare ticker', async () => {
    await insertSuffixInstrument();

    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS))),
      );
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const calledUrls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(calledUrls.some((url) => url.includes(encodeURIComponent('TEST.WA')))).toBe(true);

    const marketDataRow = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind('TEST').first<MarketDataRow>();
    expect(marketDataRow).not.toBeNull();

    const priceHistoryCount = await env.DB.prepare('SELECT COUNT(*) as count FROM price_history WHERE ticker = ?')
      .bind('TEST')
      .first<{ count: number }>();
    expect(priceHistoryCount?.count).toBe(15);

    // Never wrote a row keyed on the provider symbol itself.
    const wrongTicker = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind('TEST.WA').first();
    expect(wrongTicker).toBeNull();
  });

  it('writes a bare and a suffixed ticker side-by-side, both keyed on their bare ticker', async () => {
    await insertSuffixInstrument();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS))),
        ),
    );

    await runScheduled();

    const barePriceHistoryRow = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind('^NDX').first();
    const suffixedPriceHistoryRow = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind('TEST').first();
    expect(barePriceHistoryRow).not.toBeNull();
    expect(suffixedPriceHistoryRow).not.toBeNull();

    const bareMarketDataRow = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind('^NDX').first();
    const suffixedMarketDataRow = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind('TEST').first();
    expect(bareMarketDataRow).not.toBeNull();
    expect(suffixedMarketDataRow).not.toBeNull();

    // Never a row keyed on the provider symbol itself, checked alongside the bare rows above.
    const wrongKeyRow = await env.DB.prepare('SELECT 1 FROM price_history WHERE ticker = ?').bind('TEST.WA').first();
    expect(wrongKeyRow).toBeNull();
  });

  it('requests a short lookback window ending tomorrow (UTC midnight), so today\'s own close is included', async () => {
    // Yahoo's period2 bound is the START of that UTC day, while a daily bar
    // is stamped later in the day — period2 must be tomorrow's midnight for
    // today's bar to fall inside the range at all. Confirmed empirically
    // against the live Yahoo endpoint.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const vixCall = fetchMock.mock.calls.find((call) => (call[0] as string).includes(encodeURIComponent('^VIX')));
    const calledUrl = new URL(vixCall?.[0] as string);
    const period1 = Number(calledUrl.searchParams.get('period1'));
    const period2 = Number(calledUrl.searchParams.get('period2'));

    expect(Number.isFinite(period1)).toBe(true);
    expect(Number.isFinite(period2)).toBe(true);
    // 7-day lookback (`from`) plus the one extra day pushed onto `to`.
    // ^VIX is not RSI-eligible, so it never needs the long window.
    expect(period2 - period1).toBe(8 * 24 * 60 * 60);

    const tomorrowUtcMidnight = Math.floor(Date.now() / 1000 / 86400) * 86400 + 24 * 60 * 60;
    expect(period2).toBe(tomorrowUtcMidnight);
  });

  it('retries a failing fetch exactly 3 times before giving up on that ticker', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes(encodeURIComponent('^VIX'))) {
        return Promise.resolve(jsonResponse(500, {}));
      }
      return Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)));
    });
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const vixCalls = fetchMock.mock.calls.filter((call) => (call[0] as string).includes(encodeURIComponent('^VIX')));
    expect(vixCalls).toHaveLength(3);
  });

  it('auto-corrects instruments.currency when the fetched currency disagrees with the stored value', async () => {
    await insertSuffixInstrument('USD');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes(encodeURIComponent('TEST.WA'))) {
          return Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS, 'PLN')));
        }
        return Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS)));
      }),
    );

    await runScheduled();

    const row = await env.DB.prepare('SELECT currency FROM instruments WHERE ticker = ?').bind('TEST').first<{ currency: string }>();
    expect(row?.currency).toBe('PLN');
  });
});

describe('handleScheduled summary', () => {
  it('marks every ticker ok and reports no errors when the whole run succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS))),
        ),
    );

    const summary = await handleScheduled(env);

    expect(summary.errors).toEqual([]);
    expect(summary.tickers).toEqual(
      expect.arrayContaining([
        { ticker: '^VIX', status: 'ok' },
        { ticker: '^NDX', status: 'ok' },
      ]),
    );
    expect(summary.tickers).toHaveLength(2);
    expect(typeof summary.alertsEvaluated).toBe('number');
    expect(summary.emails).toEqual([]);
  });

  it('marks a failing ticker as status error with a message, without affecting the other ticker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes(encodeURIComponent('^VIX'))) {
          return Promise.resolve(jsonResponse(500, {}));
        }
        return Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)));
      }),
    );

    const summary = await handleScheduled(env);

    const vixResult = summary.tickers.find((t) => t.ticker === '^VIX');
    expect(vixResult?.status).toBe('error');
    expect(typeof vixResult?.error).toBe('string');
    const ndxResult = summary.tickers.find((t) => t.ticker === '^NDX');
    expect(ndxResult?.status).toBe('ok');
  });

  it('returns zero tickers and a populated errors array when the instruments registry query fails', async () => {
    await env.DB.exec('DROP TABLE instruments');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const summary = await handleScheduled(env);
      expect(summary.tickers).toEqual([]);
      expect(summary.alertsEvaluated).toBe(0);
      expect(summary.emails).toEqual([]);
      expect(summary.errors).toHaveLength(1);
    } finally {
      consoleErrorSpy.mockRestore();
      // Same restore snippet as the "logs and returns" test above — this
      // table isn't reset per test, so it must come back before later tests run.
      await env.DB.exec(
        "CREATE TABLE instruments (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('index', 'pl_stock', 'us_stock')), rsi_eligible INTEGER NOT NULL, provider TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', suffix TEXT NOT NULL DEFAULT '');\n" +
          "INSERT INTO instruments (ticker, name, type, rsi_eligible, provider) VALUES ('^VIX', 'VIX', 'index', 0, 'yahoo'), ('^NDX', 'NASDAQ-100', 'index', 1, 'yahoo');",
      );
    }
  });
});

const DAY = 24 * 60 * 60;

function utcDaysAgo(days: number): number {
  return Math.floor(Date.now() / 1000 / DAY) * DAY - days * DAY + 13 * 60 * 60;
}

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

describe('alert-scoped, history-backed fetch phase', () => {
  it('does not fetch an instrument that has no alert', async () => {
    await insertSuffixInstrument();
    await env.DB.prepare("DELETE FROM alerts WHERE ticker = 'TEST'").run();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const calledUrls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(calledUrls.some((url) => url.includes(encodeURIComponent('TEST.WA')))).toBe(false);
    const row = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind('TEST').first();
    expect(row).toBeNull();
  });

  it('still fetches an instrument whose only alert is disarmed, so it can re-arm', async () => {
    await insertSuffixInstrument();
    await env.DB.prepare("UPDATE alerts SET armed = 0 WHERE ticker = 'TEST'").run();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const calledUrls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(calledUrls.some((url) => url.includes(encodeURIComponent('TEST.WA')))).toBe(true);
  });

  it('computes RSI from stored history plus a short Yahoo window', async () => {
    // 15 stored days (enough that no long-window fallback is needed) + 1 fresh day.
    const storedCloses = Array.from({ length: 15 }, (_, i) => 100 + (i % 3 === 0 ? -2 : 3) + i);
    await env.DB.batch(
      storedCloses.map((close, i) =>
        env.DB.prepare('INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, NULL, NULL)').bind(
          '^NDX',
          isoDate(utcDaysAgo(16 - i)),
          close,
        ),
      ),
    );
    const freshClose = 140;
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(200, yahooBody([utcDaysAgo(1)], [freshClose], [freshClose + 1], [freshClose - 1]))),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const row = await env.DB.prepare('SELECT rsi, price FROM market_data WHERE ticker = ?')
      .bind('^NDX')
      .first<{ rsi: number; price: number }>();
    expect(row?.price).toBe(freshClose);
    expect(row?.rsi).toBeCloseTo(calculateRSI([...storedCloses, freshClose]) as number, 10);

    const ndxCall = fetchMock.mock.calls.find((call) => (call[0] as string).includes(encodeURIComponent('^NDX')));
    const url = new URL(ndxCall?.[0] as string);
    expect(Number(url.searchParams.get('period2')) - Number(url.searchParams.get('period1'))).toBe(8 * DAY);
  });

  it('falls back to the long window for an RSI-eligible ticker with thin stored history', async () => {
    await env.DB.prepare('INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, NULL, NULL)')
      .bind('^NDX', isoDate(utcDaysAgo(5)), 100)
      .run();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);

    await runScheduled();

    const ndxCall = fetchMock.mock.calls.find((call) => (call[0] as string).includes(encodeURIComponent('^NDX')));
    const url = new URL(ndxCall?.[0] as string);
    expect(Number(url.searchParams.get('period2')) - Number(url.searchParams.get('period1'))).toBe(31 * DAY);
  });

  it('writes every row when a run produces more rows than fit in one statement', async () => {
    const timestamps = Array.from({ length: 40 }, (_, i) => utcDaysAgo(40 - i));
    const closes = timestamps.map((_, i) => 100 + i);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(timestamps, closes)))));

    await runScheduled();

    const count = await env.DB.prepare('SELECT COUNT(*) as count FROM price_history WHERE ticker = ?')
      .bind('^NDX')
      .first<{ count: number }>();
    expect(count?.count).toBe(40);
  });

  it('stops fetching once the per-run attempt cap is reached, reporting the rest as errors', async () => {
    const extra = Array.from({ length: 15 }, (_, i) => `CAP${i + 1}`);
    for (const ticker of extra) {
      await env.DB.prepare(
        `INSERT INTO instruments (ticker, name, type, rsi_eligible, provider, currency, suffix) VALUES (?, ?, 'us_stock', 0, 'yahoo', 'USD', '')`,
      )
        .bind(ticker, ticker)
        .run();
      await seedAlert(ticker);
    }
    // Skip the real retry delay: 17 failing tickers would otherwise sleep for seconds.
    vi.stubGlobal('setTimeout', (fn: () => void) => {
      fn();
      return 0;
    });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(500, {})));
    vi.stubGlobal('fetch', fetchMock);

    const summary = await handleScheduled(env);

    expect(fetchMock).toHaveBeenCalledTimes(40);
    expect(summary.tickers).toHaveLength(17);
    expect(summary.tickers.every((t) => t.status === 'error')).toBe(true);
    expect(summary.tickers.some((t) => t.error?.includes('budget exhausted'))).toBe(true);
    // The ticker that was cut off mid-retry keeps the provider's own error.
    expect(summary.tickers.some((t) => t.error?.includes('budget exhausted') && t.error.includes('last error:'))).toBe(true);
  });
});

describe('fetch phase failure handling', () => {
  it('marks every fetched ticker as error when the bulk write is rejected, storing nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS)))),
    );
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('batch boom'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const summary = await handleScheduled(env);

      expect(summary.tickers).toHaveLength(2);
      for (const result of summary.tickers) {
        expect(result.status).toBe('error');
        expect(result.error).toContain('batch boom');
      }
      const marketData = await env.DB.prepare('SELECT * FROM market_data').all();
      expect(marketData.results).toHaveLength(0);
    } finally {
      batchSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('falls back to the long Yahoo window when stored history cannot be read', async () => {
    // 15 stored closes would normally allow the short window.
    await env.DB.batch(
      Array.from({ length: 15 }, (_, i) =>
        env.DB.prepare('INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, NULL, NULL)').bind(
          '^NDX',
          isoDate(utcDaysAgo(16 - i)),
          100 + i,
        ),
      ),
    );
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);
    const originalPrepare = env.DB.prepare.bind(env.DB);
    const prepareSpy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('FROM price_history') && sql.includes('IN (')) throw new Error('history read failed');
      return originalPrepare(sql);
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await handleScheduled(env);

      const ndxCall = fetchMock.mock.calls.find((call) => (call[0] as string).includes(encodeURIComponent('^NDX')));
      const url = new URL(ndxCall?.[0] as string);
      expect(Number(url.searchParams.get('period2')) - Number(url.searchParams.get('period1'))).toBe(31 * DAY);
      const row = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind('^NDX').first();
      expect(row).not.toBeNull();
    } finally {
      prepareSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('currency correction logging', () => {
  it('logs the correction only after the write succeeded', async () => {
    await insertSuffixInstrument('USD');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          jsonResponse(
            200,
            url.includes(encodeURIComponent('TEST.WA'))
              ? yahooBody(TIMESTAMPS, RISING_CLOSES, RISING_HIGHS, RISING_LOWS, 'PLN')
              : yahooBody(TIMESTAMPS, RISING_CLOSES),
          ),
        ),
      ),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const batchSpy = vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('batch boom'));

    try {
      await handleScheduled(env);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('corrected currency'));

      batchSpy.mockRestore();
      await handleScheduled(env);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('corrected currency for TEST: USD -> PLN'));
    } finally {
      batchSpy.mockRestore();
      logSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('refreshInstruments timeout', () => {
  it('abandons a fetch that does not answer within timeoutMs, reporting the ticker as an error', async () => {
    // A fetch that only ever settles when its abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await refreshInstruments(
        env,
        [{ ticker: '^VIX', rsi_eligible: 0, currency: 'USD', suffix: '' }],
        { retryAttempts: 1, timeoutMs: 20 },
      );

      expect(result.tickers).toEqual([{ ticker: '^VIX', status: 'error', error: expect.any(String) }]);
      const row = await env.DB.prepare('SELECT 1 FROM market_data WHERE ticker = ?').bind('^VIX').first();
      expect(row).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('cron expressions', () => {
  it('match the schedules declared in wrangler.toml', () => {
    const declared = [...(/crons\s*=\s*\[([^\]]*)\]/.exec(wranglerToml)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    expect(declared).toEqual([FETCH_CRON, EVALUATE_CRON]);
  });
});

describe('cron routing', () => {
  it('runs only the fetch phase for the fetch expression', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES))));
    vi.stubGlobal('fetch', fetchMock);

    await handleCron(FETCH_CRON, env);

    expect(fetchMock.mock.calls.some((call) => (call[0] as string).includes('finance/chart'))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => (call[0] as string).includes('api.resend.com'))).toBe(false);
  });

  it('runs only the evaluation phase for the evaluation expression', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await handleCron(EVALUATE_CRON, env);

    // No Yahoo fetch and nothing to email: evaluation alone never hits the network without a firing alert.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores and logs an unknown cron expression', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await handleCron('* * * * *', env);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('* * * * *'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('runs both phases, fetch first, for the manual full run', async () => {
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        order.push(url.includes('api.resend.com') ? 'resend' : 'yahoo');
        return Promise.resolve(
          url.includes('api.resend.com') ? jsonResponse(200, { data: [] }) : jsonResponse(200, yahooBody(TIMESTAMPS, RISING_CLOSES)),
        );
      }),
    );
    // Rising closes end at 114; an alert with threshold 100 fires once the fetch has written market_data.
    await env.DB.prepare("UPDATE alerts SET threshold = 100 WHERE ticker = '^NDX'").run();

    const summary = await handleScheduled(env);

    expect(order.indexOf('yahoo')).toBeLessThan(order.indexOf('resend'));
    expect(summary.emails).toEqual([expect.objectContaining({ ticker: '^NDX', status: 'sent' })]);
  });
});
