import { MatDialog } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { of } from 'rxjs';
import { Instrument, InstrumentsService } from '../../instruments/instruments.service';
import { Alert, AlertsService } from '../alerts.service';
import { AlertList } from './alert-list';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
  { ticker: '^VIX', name: 'VIX', type: 'index', rsiEligible: false, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
];

const make = (id: number, ticker: string, alertType: string, current: Partial<Alert> = {}): Alert => {
  const instrument = INSTRUMENTS.find((i) => i.ticker === ticker)!;
  return {
    id,
    ticker,
    instrumentName: instrument.name,
    instrumentType: instrument.type,
    currency: instrument.currency,
    alertType,
    threshold: id * 10,
    direction: 'up',
    active: true,
    notificationEmail: 'user@example.com',
    createdAt: 0,
    updatedAt: 0,
    currentPrice: null,
    currentRsi: null,
    currentHigh: null,
    currentLow: null,
    ...current,
  };
};

const ALERTS: Alert[] = [make(1, '^NDX', 'PRICE'), make(2, '^NDX', 'RSI'), make(3, 'CDR', 'PRICE')];

async function renderList(alerts: Alert[] = ALERTS) {
  const result = await render(AlertList, {
    providers: [
      { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: AlertsService, useValue: { alerts: () => alerts, list: () => of(alerts), delete: vi.fn() } },
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
  return { ...result, settle };
}

type Settle = () => Promise<void>;

const rowCount = () => screen.queryAllByRole('button', { name: /NASDAQ-100|VIX|CD Projekt/ }).length;

async function chooseAlertType(settle: Settle, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Alert type' }));
  fireEvent.click(await screen.findByRole('option', { name }));
  await settle();
}

async function chooseInstrument(settle: Settle, text: string, optionName: RegExp) {
  const input = screen.getByRole('combobox', { name: 'Instrument' });
  input.focus();
  fireEvent.input(input, { target: { value: text } });
  await settle();
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
  await settle();
}

describe('AlertList filters', () => {
  it('hides the filter bar when there are no alerts', async () => {
    await renderList([]);
    expect(screen.queryByRole('combobox', { name: 'Alert type' })).toBeNull();
    expect(screen.getByText(/No alerts yet/)).toBeTruthy();
  });

  it('shows every alert and no clear button by default', async () => {
    await renderList();
    expect(rowCount()).toBe(3);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('narrows by alert type', async () => {
    const { settle } = await renderList();
    await chooseAlertType(settle, 'RSI threshold');
    expect(rowCount()).toBe(1);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('combines the instrument and the alert type with AND', async () => {
    const { settle } = await renderList();
    await chooseInstrument(settle, 'NASDAQ', /NASDAQ-100/);
    expect(rowCount()).toBe(2);
    await chooseAlertType(settle, 'Price threshold');
    expect(rowCount()).toBe(1);
  });

  it('shows a no-match message and restores the list on clear', async () => {
    const { settle } = await renderList();
    await chooseInstrument(settle, 'CDR', /CD Projekt/);
    await chooseAlertType(settle, 'RSI threshold');
    expect(rowCount()).toBe(0);
    expect(screen.getByText('No alerts match the selected filters.')).toBeTruthy();
    expect(screen.queryByText(/No alerts yet/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await settle();
    expect(rowCount()).toBe(3);
  });

  it('sorts the filtered set', async () => {
    const { settle } = await renderList();
    await chooseInstrument(settle, 'NASDAQ', /NASDAQ-100/);
    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    await settle();
    const rows = screen.getAllByRole('button', { name: /NASDAQ-100/ });
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('20.00');
  });
});

describe('AlertList current value', () => {
  it('labels the column in the list header', async () => {
    await renderList();
    expect(screen.getByText('Current value')).toBeTruthy();
  });

  it('shows the price with currency for price alerts', async () => {
    await renderList([make(1, 'CDR', 'PRICE', { currentPrice: 123.456 })]);
    expect(screen.getByRole('button', { name: /CD Projekt/ }).textContent).toContain('123.46 PLN');
  });

  it('shows the RSI without currency for RSI alerts', async () => {
    await renderList([make(1, '^NDX', 'RSI', { currentRsi: 45.2 })]);
    const row = screen.getByRole('button', { name: /NASDAQ-100/ }).textContent!;
    expect(row).toContain('45.20');
    expect(row).not.toContain('45.20 USD');
  });

  it('shows a dash when there is no data', async () => {
    await renderList([make(1, 'CDR', 'PRICE'), make(2, '^NDX', 'RSI')]);
    for (const name of [/CD Projekt/, /NASDAQ-100/]) {
      expect(screen.getByRole('button', { name }).textContent).toContain('—');
    }
  });
});
