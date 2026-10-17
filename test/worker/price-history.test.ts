import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHistory, HISTORY_DAYS, latestRsi, loadRecentPriceRows, RSI_INPUT_SESSIONS } from '../../src/worker/lib/price-history';

// Reference values were computed independently in Python (Wilder's RSI, seeded
// with the simple mean of the first 14 changes, then smoothed) over this exact
// deterministic series — not derived from this implementation's own output.
const CLOSES_180 = Array.from({ length: RSI_INPUT_SESSIONS }, (_, i) => 100 + ((i * 37) % 23) + i * 0.5);
const RSI_AT_LAST = 55.834341222940296;

function newestFirstRows(closes: number[]) {
  return closes.map((close, i) => ({ date: `d${String(i).padStart(4, '0')}`, close, high: null, low: null })).reverse();
}

describe('latestRsi', () => {
  it('matches the independent reference value over a full 180-close input', () => {
    expect(latestRsi(CLOSES_180)).toBeCloseTo(RSI_AT_LAST, 9);
  });

  it('returns null when fewer than period + 1 closes are provided', () => {
    expect(latestRsi(CLOSES_180.slice(0, 14))).toBeNull();
  });
});

describe('buildHistory over the full input window', () => {
  it('returns the last HISTORY_DAYS entries, each with an RSI converged over the full input', () => {
    const history = buildHistory(newestFirstRows(CLOSES_180), true);

    expect(history).toHaveLength(HISTORY_DAYS);
    expect(history.every((entry) => typeof entry.rsi === 'number')).toBe(true);
    expect(history.at(-1)!.rsi).toBeCloseTo(RSI_AT_LAST, 9);
  });

  it('agrees with latestRsi on the same closes', () => {
    const history = buildHistory(newestFirstRows(CLOSES_180), true);
    expect(history.at(-1)!.rsi).toBe(latestRsi(CLOSES_180));
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
        return env.DB.prepare('INSERT INTO price_history (ticker, date, close) VALUES (?, ?, ?)').bind(
          ticker,
          date.toISOString().slice(0, 10),
          100 + i,
        );
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

  it('returns an empty map for an empty ticker list', async () => {
    await seed('^NDX', 5);
    expect((await loadRecentPriceRows(env.DB, [])).size).toBe(0);
  });
});
