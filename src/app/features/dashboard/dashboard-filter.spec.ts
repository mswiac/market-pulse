import { filterLatest } from './dashboard-filter';
import { LatestInstrument } from './dashboard.service';

const row = (ticker: string, type: string): LatestInstrument => ({
  ticker,
  name: ticker,
  type,
  currency: 'USD',
  rsiEligible: true,
  date: null,
  close: null,
  high: null,
  low: null,
  rsi: null,
});

const ROWS = [row('^NDX', 'index'), row('^VIX', 'index'), row('CDR', 'pl_stock')];

describe('filterLatest', () => {
  it('returns every row when no filter is set', () => {
    expect(filterLatest(ROWS, { type: '', ticker: '' })).toHaveLength(3);
  });

  it('narrows by type', () => {
    expect(filterLatest(ROWS, { type: 'index', ticker: '' }).map((r) => r.ticker)).toEqual(['^NDX', '^VIX']);
  });

  it('narrows by ticker', () => {
    expect(filterLatest(ROWS, { type: '', ticker: 'CDR' }).map((r) => r.ticker)).toEqual(['CDR']);
  });

  it('lets the ticker take precedence over the type', () => {
    expect(filterLatest(ROWS, { type: 'pl_stock', ticker: '^NDX' }).map((r) => r.ticker)).toEqual(['^NDX']);
  });
});
