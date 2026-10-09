import { searchInstruments } from './instrument-search';
import { Instrument } from './instruments.service';

const make = (ticker: string, name: string, type: string): Instrument => ({
  ticker,
  name,
  type,
  rsiEligible: true,
  currency: 'PLN',
});

const INSTRUMENTS: Instrument[] = [
  make('^NDX', 'NASDAQ-100', 'index'),
  make('CDR', 'CD Projekt', 'pl_stock'),
  make('ZAB', 'Żabka', 'pl_stock'),
  make('ALE', 'Allegro CDR partner', 'pl_stock'),
  make('XCDR', 'Other', 'us_stock'),
  make('ZLW', 'Żółw', 'pl_stock'),
];

const tickers = (list: Instrument[]) => list.map((i) => i.ticker);

describe('searchInstruments', () => {
  it('returns all instruments sorted by name for an empty query', () => {
    expect(tickers(searchInstruments(INSTRUMENTS, '', ''))).toEqual(['ALE', 'CDR', '^NDX', 'XCDR', 'ZAB', 'ZLW']);
  });

  it('ranks ticker prefix before ticker substring before name substring', () => {
    expect(tickers(searchInstruments(INSTRUMENTS, 'cdr', ''))).toEqual(['CDR', 'XCDR', 'ALE']);
  });

  it('matches regardless of diacritics, including ł', () => {
    expect(tickers(searchInstruments(INSTRUMENTS, 'zabka', ''))).toEqual(['ZAB']);
    expect(tickers(searchInstruments(INSTRUMENTS, 'zolw', ''))).toEqual(['ZLW']);
  });

  it('restricts results to the given type', () => {
    expect(tickers(searchInstruments(INSTRUMENTS, 'cdr', 'pl_stock'))).toEqual(['CDR', 'ALE']);
  });

  it('ignores surrounding whitespace in the query, and treats a blank query as empty', () => {
    expect(tickers(searchInstruments(INSTRUMENTS, '  cdr  ', ''))).toEqual(['CDR', 'XCDR', 'ALE']);
    expect(tickers(searchInstruments(INSTRUMENTS, '   ', ''))).toEqual(['ALE', 'CDR', '^NDX', 'XCDR', 'ZAB', 'ZLW']);
  });

  it('puts a ticker that starts with the query ahead of one that only ends with it, and sorts each group by name', () => {
    const list = [
      make('XAB2', 'Zulu', 'pl_stock'),
      make('AB2', 'Zeta', 'pl_stock'),
      make('Q1', 'Zabra', 'pl_stock'),
      make('XAB1', 'Beta', 'pl_stock'),
      make('AB1', 'Alpha', 'pl_stock'),
      make('Q2', 'Alabama', 'pl_stock'),
    ];

    expect(tickers(searchInstruments(list, 'ab', ''))).toEqual(['AB1', 'AB2', 'XAB1', 'XAB2', 'Q2', 'Q1']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchInstruments(INSTRUMENTS, 'qqq', '')).toEqual([]);
  });
});
