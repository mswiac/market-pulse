import { filterAlerts } from './alert-filter';
import { Alert } from './alerts.service';

const make = (id: number, ticker: string, instrumentType: string, alertType: string): Alert => ({
  id,
  ticker,
  instrumentName: ticker,
  instrumentType,
  currency: 'PLN',
  alertType,
  threshold: id,
  direction: 'up',
  active: true,
  notificationEmail: 'user@example.com',
  createdAt: 0,
  updatedAt: 0,
  currentPrice: null,
  currentRsi: null,
  currentHigh: null,
  currentLow: null,
});

const ALERTS: Alert[] = [
  make(1, '^NDX', 'index', 'PRICE'),
  make(2, '^NDX', 'index', 'RSI'),
  make(3, 'CDR', 'pl_stock', 'PRICE'),
  make(4, 'ZAB', 'pl_stock', 'RSI'),
];

const ids = (alerts: Alert[]) => alerts.map((a) => a.id);
const none = { type: '', ticker: '', alertType: '' };

describe('filterAlerts', () => {
  it('returns everything when no filter is set', () => {
    expect(ids(filterAlerts(ALERTS, none))).toEqual([1, 2, 3, 4]);
  });

  it('filters by instrument type', () => {
    expect(ids(filterAlerts(ALERTS, { ...none, type: 'pl_stock' }))).toEqual([3, 4]);
  });

  it('filters by ticker', () => {
    expect(ids(filterAlerts(ALERTS, { ...none, ticker: '^NDX' }))).toEqual([1, 2]);
  });

  it('filters by alert type', () => {
    expect(ids(filterAlerts(ALERTS, { ...none, alertType: 'RSI' }))).toEqual([2, 4]);
  });

  it('combines filters with AND', () => {
    expect(ids(filterAlerts(ALERTS, { type: 'pl_stock', ticker: '', alertType: 'RSI' }))).toEqual([4]);
    expect(ids(filterAlerts(ALERTS, { type: '', ticker: '^NDX', alertType: 'PRICE' }))).toEqual([1]);
  });

  it('lets the ticker take precedence over the type', () => {
    expect(ids(filterAlerts(ALERTS, { type: 'pl_stock', ticker: '^NDX', alertType: '' }))).toEqual([1, 2]);
  });

  it('returns nothing when no alert matches', () => {
    expect(filterAlerts(ALERTS, { type: 'index', ticker: '', alertType: 'FOO' })).toEqual([]);
  });
});
