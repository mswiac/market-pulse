import { MatDialog } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { of, throwError } from 'rxjs';
import { Instrument, InstrumentsService } from '../../instruments/instruments.service';
import { Alert, AlertsService } from '../alerts.service';
import { AlertForm } from '../alert-form/alert-form';
import { DeleteAlertConfirm } from '../delete-alert-confirm/delete-alert-confirm';
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

interface ListOverrides {
  // What the confirm/edit dialog resolves to when closed.
  dialogResult?: boolean;
  alertsService?: Partial<Record<'list' | 'delete', unknown>>;
}

async function renderList(alerts: Alert[] = ALERTS, overrides: ListOverrides = {}) {
  const result = await render(AlertList, {
    providers: [
      {
        provide: AlertsService,
        useValue: { alerts: () => alerts, list: () => of(alerts), delete: vi.fn(), ...overrides.alertsService },
      },
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
  // MatDialogModule is imported by the standalone component, so a root-level MatDialog provider would not
  // be the instance it injects — spy on the component's own instance instead.
  const dialogOpen = vi
    .spyOn(result.fixture.debugElement.injector.get(MatDialog), 'open')
    .mockReturnValue({ afterClosed: () => of(overrides.dialogResult ?? false) } as never);
  const settle = async () => {
    result.fixture.detectChanges();
    await result.fixture.whenStable();
    result.fixture.detectChanges();
  };
  return { ...result, settle, dialogOpen };
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

describe('AlertList sorting', () => {
  const thresholds = () =>
    screen.getAllByRole('button', { name: /NASDAQ-100|VIX|CD Projekt/ }).map((row) => /\d+\.\d{2}/.exec(row.textContent!)![0]);
  const names = () =>
    screen.getAllByRole('button', { name: /NASDAQ-100|VIX|CD Projekt/ }).map((row) => /NASDAQ-100|VIX|CD Projekt/.exec(row.textContent!)![0]);

  it('keeps the server order until a column is chosen', async () => {
    await renderList();
    expect(thresholds()).toEqual(['10.00', '20.00', '30.00']);
  });

  it('sorts a numeric column ascending first and descending on the second click', async () => {
    const { settle } = await renderList([make(3, 'CDR', 'PRICE'), make(1, '^NDX', 'PRICE'), make(2, '^NDX', 'RSI')]);

    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    await settle();
    expect(thresholds()).toEqual(['10.00', '20.00', '30.00']);

    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    await settle();
    expect(thresholds()).toEqual(['30.00', '20.00', '10.00']);
  });

  it('sorts a text column alphabetically and reverses it on the second click', async () => {
    const { settle } = await renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Instrument' }));
    await settle();
    expect(names()).toEqual(['CD Projekt', 'NASDAQ-100', 'NASDAQ-100']);

    fireEvent.click(screen.getByRole('button', { name: 'Instrument' }));
    await settle();
    expect(names()).toEqual(['NASDAQ-100', 'NASDAQ-100', 'CD Projekt']);
  });

  it('starts ascending again when switching to another column', async () => {
    const { settle } = await renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Threshold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Instrument' }));
    await settle();

    expect(names()).toEqual(['CD Projekt', 'NASDAQ-100', 'NASDAQ-100']);
  });
});

describe('AlertList actions', () => {
  async function clickFirst(settle: Settle, label: string) {
    fireEvent.click(screen.getAllByRole('button', { name: /NASDAQ-100|VIX|CD Projekt/ })[0]);
    await settle();
    fireEvent.click(screen.getAllByRole('button', { name: label })[0]);
    await settle();
  }

  it('shows a load error instead of the list when the alerts cannot be loaded', async () => {
    await renderList(ALERTS, { alertsService: { list: () => throwError(() => new Error('offline')) } });

    expect(screen.getByText('Failed to load alerts.')).toBeTruthy();
    expect(rowCount()).toBe(0);
  });

  it('opens the edit dialog for the chosen alert', async () => {
    const { settle, dialogOpen } = await renderList(ALERTS);

    await clickFirst(settle, 'Edit alert');

    expect(dialogOpen).toHaveBeenCalledWith(AlertForm, { width: '32rem', data: { alert: ALERTS[0] } });
  });

  it('asks for confirmation with a summary of the alert, then deletes it once confirmed', async () => {
    const remove = vi.fn().mockReturnValue(of(undefined));
    const { settle, dialogOpen } = await renderList(ALERTS, { dialogResult: true, alertsService: { delete: remove } });

    await clickFirst(settle, 'Delete alert');

    expect(dialogOpen).toHaveBeenCalledWith(DeleteAlertConfirm, {
      data: { instrumentName: 'NASDAQ-100', alertType: 'Price', threshold: '10.00' },
    });
    expect(remove).toHaveBeenCalledWith(1);
  });

  it('summarises an RSI alert with the short RSI label', async () => {
    const { settle, dialogOpen } = await renderList([make(2, '^NDX', 'RSI')]);

    await clickFirst(settle, 'Delete alert');

    expect(dialogOpen).toHaveBeenCalledWith(DeleteAlertConfirm, {
      data: { instrumentName: 'NASDAQ-100', alertType: 'RSI', threshold: '20.00' },
    });
  });

  it('does not delete the alert when the confirmation is dismissed', async () => {
    const remove = vi.fn().mockReturnValue(of(undefined));
    const { settle } = await renderList(ALERTS, { dialogResult: false, alertsService: { delete: remove } });

    await clickFirst(settle, 'Delete alert');

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByText(/Failed to delete/)).toBeNull();
  });

  it('shows an error when deleting fails', async () => {
    const { settle } = await renderList(ALERTS, {
      dialogResult: true,
      alertsService: { delete: vi.fn().mockReturnValue(throwError(() => new Error('boom'))) },
    });

    await clickFirst(settle, 'Delete alert');

    expect(screen.getByText('Failed to delete the alert. Please try again.')).toBeTruthy();
  });
});

describe('AlertList details', () => {
  it('shows the day high and low only for price alerts and the RSI only for RSI alerts', async () => {
    await renderList([make(1, '^NDX', 'PRICE', { currentHigh: 5, currentLow: 4, currentPrice: 4.5 })]);
    expect(screen.queryByText("Today's high:")).toBeTruthy();
    expect(screen.queryByText("Today's low:")).toBeTruthy();
    expect(screen.queryByText('Current RSI:')).toBeNull();
  });

  it('shows the RSI detail and no high or low for an RSI alert', async () => {
    await renderList([make(2, '^NDX', 'RSI', { currentRsi: 44 })]);
    expect(screen.queryByText('Current RSI:')).toBeTruthy();
    expect(screen.queryByText("Today's high:")).toBeNull();
    expect(screen.queryByText("Today's low:")).toBeNull();
  });
});
