import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildHistory,
  HISTORY_DAYS,
  latestRsi,
  loadLatestSnapshots,
  loadRecentPriceRows,
  RSI_INPUT_SESSIONS,
  rsiFromCloses,
} from '../../src/worker/lib/price-history';

// Reference values were computed independently in Python (Wilder's RSI, seeded
// with the simple mean of the first 14 changes, then smoothed) over this exact
// deterministic series — not derived from this implementation's own output.
const CLOSES_180 = Array.from(
  { length: RSI_INPUT_SESSIONS },
  (_, i) => 100 + ((i * 37) % 23) + i * 0.5,
);
const RSI_AT_LAST = 55.834341222940296;

function newestFirstRows(closes: number[]) {
  return closes
    .map((close, i) => ({ date: `d${String(i).padStart(4, '0')}`, close, high: null, low: null }))
    .reverse();
}

describe('latestRsi', () => {
  it('matches the independent reference value over a full 180-close input', () => {
    expect(latestRsi(CLOSES_180)).toBeCloseTo(RSI_AT_LAST, 9);
  });

  it('returns null when fewer than period + 1 closes are provided', () => {
    expect(latestRsi(CLOSES_180.slice(0, 14))).toBeNull();
  });
});

describe('rsiFromCloses', () => {
  function byDate(closes: number[]): Map<string, number> {
    return new Map(closes.map((close, i) => [`d${String(i).padStart(4, '0')}`, close]));
  }

  it('equals latestRsi over the same closes in date order', () => {
    expect(rsiFromCloses(byDate(CLOSES_180))).toBe(latestRsi(CLOSES_180));
  });

  it('sorts by date regardless of insertion order', () => {
    const shuffled = new Map([...byDate(CLOSES_180)].reverse());

    expect(rsiFromCloses(shuffled)).toBe(latestRsi(CLOSES_180));
  });

  it('uses only the newest RSI_INPUT_SESSIONS closes', () => {
    const older = Array.from({ length: 40 }, (_, i) => 500 - i * 3);
    const all = byDate([...older, ...CLOSES_180]);

    expect(rsiFromCloses(all)).toBe(latestRsi(CLOSES_180));
  });

  it('returns null with too few closes', () => {
    expect(rsiFromCloses(byDate(CLOSES_180.slice(0, 14)))).toBeNull();
  });
});

describe('buildHistory over the full input window', () => {
  it('returns the last HISTORY_DAYS entries, each with an RSI converged over the full input', () => {
    const history = buildHistory(newestFirstRows(CLOSES_180), true);

    expect(history).toHaveLength(HISTORY_DAYS);
    expect(history.every((entry) => typeof entry.rsi === 'number')).toBe(true);
    expect(history.at(-1)!.rsi).toBeCloseTo(RSI_AT_LAST, 9);
  });

  it('gives null RSI everywhere for an RSI-ineligible instrument', () => {
    const history = buildHistory(newestFirstRows(CLOSES_180), false);
    expect(history.every((entry) => entry.rsi === null)).toBe(true);
  });
});

describe('loadRecentPriceRows', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM price_history').run();
  });

  async function seed(ticker: string, count: number): Promise<void> {
    const start = new Date('2020-01-01T00:00:00Z');
    await env.DB.batch(
      Array.from({ length: count }, (_, i) => {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + i);
        return env.DB.prepare(
          'INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)',
        ).bind(ticker, date.toISOString().slice(0, 10), 100 + i);
      }),
    );
  }

  it('returns at most RSI_INPUT_SESSIONS rows per ticker, newest first', async () => {
    await seed('^NDX', RSI_INPUT_SESSIONS + 20);

    const rows = (await loadRecentPriceRows(env.DB, null)).get('^NDX')!;

    expect(rows).toHaveLength(RSI_INPUT_SESSIONS);
    expect(rows[0].close).toBe(100 + RSI_INPUT_SESSIONS + 19);
    expect(rows[0].date > rows[1].date).toBe(true);
  });

  it('loads only the requested tickers', async () => {
    await seed('^NDX', 5);
    await seed('^VIX', 5);

    const byTicker = await loadRecentPriceRows(env.DB, ['^VIX']);

    expect([...byTicker.keys()]).toEqual(['^VIX']);
  });

  it('loads every ticker when the list spans several query chunks', async () => {
    const tickers = Array.from({ length: 95 }, (_, i) => `CHUNK${i}`);
    await env.DB.batch(
      tickers.flatMap((ticker, i) => [
        env.DB.prepare('INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)').bind(
          ticker,
          '2020-01-01',
          i,
        ),
        env.DB.prepare('INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)').bind(
          ticker,
          '2020-01-02',
          i + 1000,
        ),
      ]),
    );

    const byTicker = await loadRecentPriceRows(env.DB, tickers);

    expect(byTicker.size).toBe(95);
    expect(byTicker.get('CHUNK0')!.map((row) => row.close)).toEqual([1000, 0]);
    expect(byTicker.get('CHUNK94')!.map((row) => row.close)).toEqual([1094, 94]);
  });

  it('keeps a row exactly at the age floor and drops one a day older', async () => {
    const insert = (date: string) =>
      env.DB.prepare('INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)').bind(
        '^NDX',
        date,
        1,
      );
    // Floor = newest date minus RSI_INPUT_MAX_AGE_DAYS = 2020-12-26 for a newest date of 2021-10-22.
    await env.DB.batch([insert('2021-10-22'), insert('2020-12-26'), insert('2020-12-25')]);

    const dates = (await loadRecentPriceRows(env.DB, ['^NDX'])).get('^NDX')!.map((row) => row.date);

    expect(dates).toEqual(['2021-10-22', '2020-12-26']);
  });

  it('returns an empty map for an empty ticker list', async () => {
    await seed('^NDX', 5);
    expect((await loadRecentPriceRows(env.DB, [])).size).toBe(0);
  });
});

describe('loadLatestSnapshots', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM price_history').run();
  });

  async function seedCloses(ticker: string, closes: number[], withHighLow = false): Promise<void> {
    const start = new Date('2020-01-01T00:00:00Z');
    await env.DB.batch(
      closes.map((close, i) => {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + i);
        return env.DB.prepare(
          'INSERT INTO price_history (ticker, date, close, high, low) VALUES (?, ?, ?, ?, ?)',
        ).bind(ticker, date.toISOString().slice(0, 10), close, withHighLow ? close + 1 : null, withHighLow ? close - 1 : null);
      }),
    );
  }

  async function buildHistoryNewest(ticker: string, eligible: boolean) {
    const rows = (await loadRecentPriceRows(env.DB, [ticker])).get(ticker)!;
    return buildHistory(rows, eligible).at(-1)!;
  }

  it('equals the newest buildHistory entry for an RSI-eligible ticker', async () => {
    await seedCloses('^NDX', CLOSES_180, true);

    const snapshot = (await loadLatestSnapshots(env.DB, new Set(['^NDX']))).get('^NDX')!;

    expect(snapshot).toEqual(await buildHistoryNewest('^NDX', true));
    expect(snapshot.rsi).toBeCloseTo(RSI_AT_LAST, 10);
  });

  it('uses only the newest RSI_INPUT_SESSIONS closes, like the other readers', async () => {
    await seedCloses('^NDX', [500, 700, ...CLOSES_180]);

    const snapshot = (await loadLatestSnapshots(env.DB, new Set(['^NDX']))).get('^NDX')!;

    expect(snapshot.rsi).toBeCloseTo(RSI_AT_LAST, 10);
  });

  it('leaves rsi null for a ticker outside the eligible set but still returns its newest row', async () => {
    await seedCloses('^VIX', CLOSES_180, true);

    const snapshot = (await loadLatestSnapshots(env.DB, new Set())).get('^VIX')!;

    expect(snapshot).toEqual(await buildHistoryNewest('^VIX', false));
    expect(snapshot.rsi).toBeNull();
    expect(snapshot.close).toBe(CLOSES_180.at(-1));
  });

  it('returns rsi null when there are too few closes to seed it', async () => {
    await seedCloses('^NDX', CLOSES_180.slice(0, 10));

    const snapshot = (await loadLatestSnapshots(env.DB, new Set(['^NDX']))).get('^NDX')!;

    expect(snapshot.rsi).toBeNull();
    expect(snapshot.close).toBe(CLOSES_180[9]);
  });

  it('keeps tickers apart across mixed eligibility and omits a ticker without rows', async () => {
    // RSI is scale-invariant, so the series must differ in shape, not just level.
    const shifted = CLOSES_180.map((close, i) => close + (i % 7) * 3);
    // Rows come back ordered by ticker: eligible, ineligible, eligible.
    await seedCloses('AAA', CLOSES_180);
    await seedCloses('BBB', CLOSES_180.slice().reverse());
    await seedCloses('CCC', shifted);

    const snapshots = await loadLatestSnapshots(env.DB, new Set(['AAA', 'CCC', 'NOROWS']));

    expect([...snapshots.keys()]).toEqual(['AAA', 'BBB', 'CCC']);
    expect(snapshots.get('AAA')!.rsi).toBe(latestRsi(CLOSES_180));
    expect(snapshots.get('BBB')!.rsi).toBeNull();
    expect(snapshots.get('CCC')!.rsi).toBe(latestRsi(shifted));
    expect(latestRsi(CLOSES_180)).not.toBe(latestRsi(shifted));
  });

  it('returns an empty map when price_history is empty', async () => {
    expect((await loadLatestSnapshots(env.DB, new Set(['^NDX']))).size).toBe(0);
  });
});
