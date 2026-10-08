import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Instrument, InstrumentsService } from '../instruments/instruments.service';
import { DashboardService, LatestInstrument } from './dashboard.service';
import { Dashboard } from './dashboard';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
  { ticker: '^VIX', name: 'VIX', type: 'index', rsiEligible: false, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
];

const ROWS: LatestInstrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', currency: 'USD', rsiEligible: true, date: '2026-10-07', close: 20000, high: 20100, low: 19900, rsi: 55.5 },
  { ticker: '^VIX', name: 'VIX', type: 'index', currency: 'USD', rsiEligible: false, date: '2026-10-07', close: 15, high: 16, low: 14, rsi: null },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', currency: 'PLN', rsiEligible: true, date: null, close: null, high: null, low: null, rsi: null },
];

async function renderDashboard(getLatest = () => of(ROWS)) {
  const result = await render(Dashboard, {
    providers: [
      { provide: DashboardService, useValue: { getLatest } },
      { provide: AuthService, useValue: { currentUser: () => ({ email: 'user@example.com' }) } },
      {
        provide: InstrumentsService,
        useValue: {
          instruments: () => INSTRUMENTS,
          types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
          ensureLoaded: () => of(INSTRUMENTS),
        },
      },
    ],
  });
  const settle = async () => {
    result.fixture.detectChanges();
    await result.fixture.whenStable();
    result.fixture.detectChanges();
  };
  await settle();
  return { ...result, settle };
}

// Data rows only (the header row has no instrument name).
const dataRows = () => screen.getAllByRole('row').slice(1);
const rowNames = () => dataRows().map((r) => r.textContent ?? '');

describe('Dashboard', () => {
  it('shows one row per instrument, alphabetical by name by default', async () => {
    await renderDashboard();
    const rows = rowNames();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('CD Projekt');
    expect(rows[1]).toContain('NASDAQ-100');
    expect(rows[2]).toContain('VIX');
  });

  it('shows dashes for an instrument without data and for a missing RSI', async () => {
    await renderDashboard();
    const cdr = dataRows().find((r) => r.textContent?.includes('CD Projekt'))!;
    expect(cdr.textContent?.match(/—/g)).toHaveLength(5);
    const vix = dataRows().find((r) => r.textContent?.includes('VIX'))!;
    expect(vix.textContent).toContain('15.00 USD');
    expect(vix.textContent?.match(/—/g)).toHaveLength(1);
  });

  it('narrows by instrument and restores on clear', async () => {
    const { settle } = await renderDashboard();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    const input = screen.getByRole('combobox', { name: 'Instrument' });
    input.focus();
    fireEvent.input(input, { target: { value: 'NASDAQ' } });
    await settle();
    fireEvent.click(await screen.findByRole('option', { name: /NASDAQ-100/ }));
    await settle();
    expect(dataRows()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await settle();
    expect(dataRows()).toHaveLength(3);
  });

  it('narrows by type', async () => {
    const { settle } = await renderDashboard();
    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PL companies' }));
    await settle();
    expect(dataRows()).toHaveLength(1);
  });

  it('shows the no-match message when the filtered set is empty', async () => {
    const { settle } = await renderDashboard(() => of([ROWS[0], ROWS[1]]));
    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PL companies' }));
    await settle();
    expect(screen.getByText('No instruments match the selected filters.')).toBeTruthy();
    expect(screen.queryByText('No instruments in the system yet.')).toBeNull();
  });

  it('sorts by a clicked column and reverses on a second click, missing values last', async () => {
    const { settle } = await renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(rowNames().map((r) => r.slice(0, 3))).toEqual(['VIX', 'NAS', 'CD ']);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(rowNames().map((r) => r.slice(0, 3))).toEqual(['NAS', 'VIX', 'CD ']);
  });

  it('shows an error message when loading fails', async () => {
    await renderDashboard(() => throwError(() => new Error('boom')));
    expect(screen.getByText(/Failed to load the dashboard/)).toBeTruthy();
  });

  it('shows the empty-catalogue message with no instruments', async () => {
    await renderDashboard(() => of([]));
    expect(screen.getByText('No instruments in the system yet.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Instrument' })).toBeNull();
  });
});
