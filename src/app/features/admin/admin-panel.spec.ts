import { HttpErrorResponse } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
import { Instrument, InstrumentsService } from '../instruments/instruments.service';
import { AdminPanel } from './admin-panel';
import { AdminService, MarketDataFetchResult } from './admin-panel.service';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'index', rsiEligible: true, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'pl_stock', rsiEligible: true, currency: 'PLN' },
];

const RESULT: MarketDataFetchResult = {
  ticker: '^NDX',
  from: '2026-01-01',
  to: '2026-01-31',
  daysWritten: 21,
};

async function renderAdminPanel(
  impl: () => ReturnType<AdminService['fetchMarketData']> = () => of(RESULT),
) {
  const fetchMarketData = vi.fn(impl);
  const result = await render(AdminPanel, {
    providers: [
      provideNativeDateAdapter(),
      {
        provide: InstrumentsService,
        useValue: {
          instruments: () => INSTRUMENTS,
          types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
          ensureLoaded: () => of(INSTRUMENTS),
        },
      },
      { provide: AdminService, useValue: { fetchMarketData } },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    onTypeChange: (type: string) => void;
    onFromDateChange: (date: Date | null) => void;
    onToDateChange: (date: Date | null) => void;
    onSubmit: () => void;
  };
  return { ...result, component, fetchMarketData };
}

describe('AdminPanel', () => {
  it('narrows the instrument picker to the selected type and auto-selects the first match', async () => {
    const { fixture, component } = await renderAdminPanel();

    component.onTypeChange('pl_stock');
    fixture.detectChanges();

    expect(await screen.findByText('CD Projekt')).toBeTruthy();
  });

  it('disables submit until both from and to dates are set', async () => {
    const { fixture, component } = await renderAdminPanel();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Fetch market data' }) as HTMLButtonElement;

    expect(submitButton().disabled).toBe(true);

    component.onFromDateChange(new Date('2026-01-01'));
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);

    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(false);
  });

  it('shows the success message with the interpolated result on submit', async () => {
    const { fixture, component } = await renderAdminPanel(() => of(RESULT));

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    expect(
      await screen.findByText('Saved 21 day(s) for ^NDX (2026-01-01 – 2026-01-31).'),
    ).toBeTruthy();
  });

  it('sends the selected ticker and the datepicker dates formatted as zero-padded ISO strings', async () => {
    const { fixture, component, fetchMarketData } = await renderAdminPanel(() => of(RESULT));

    component.onFromDateChange(new Date(2026, 2, 5));
    component.onToDateChange(new Date(2026, 10, 9));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    expect(fetchMarketData).toHaveBeenCalledWith('^NDX', '2026-03-05', '2026-11-09');
  });

  it('shows the mapped message for a known error code', async () => {
    const { fixture, component } = await renderAdminPanel(() =>
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'range_too_large' } })),
    );

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    expect(await screen.findByText('The selected range is too large (max 730 days).')).toBeTruthy();
  });

  it('falls back to the generic message for an unrecognized error code', async () => {
    const { fixture, component } = await renderAdminPanel(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'totally_unknown' } })),
    );

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('keeps the submit button disabled and ignores a second submit while a fetch is in flight', async () => {
    const pending = new Subject<MarketDataFetchResult>();
    const { fixture, component, fetchMarketData } = await renderAdminPanel(() => pending);
    const submitButton = () =>
      screen.getByRole('button', { name: 'Fetch market data' }) as HTMLButtonElement;

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();

    component.onSubmit();
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(fetchMarketData).toHaveBeenCalledTimes(1);
  });

  it('re-enables the submit button after a failed fetch', async () => {
    const pending = new Subject<MarketDataFetchResult>();
    const { fixture, component } = await renderAdminPanel(() => pending);
    const submitButton = () =>
      screen.getByRole('button', { name: 'Fetch market data' }) as HTMLButtonElement;

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    pending.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });

  it('re-enables the submit button after a successful fetch (the date range is not reset)', async () => {
    const pending = new Subject<MarketDataFetchResult>();
    const { fixture, component } = await renderAdminPanel(() => pending);
    const submitButton = () =>
      screen.getByRole('button', { name: 'Fetch market data' }) as HTMLButtonElement;

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    component.onSubmit();
    fixture.detectChanges();

    pending.next(RESULT);
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });

  it('keeps submit disabled and onSubmit inert when only one of the two dates is set', async () => {
    const { fixture, component, fetchMarketData } = await renderAdminPanel();
    const submitButton = () =>
      screen.getByRole('button', { name: 'Fetch market data' }) as HTMLButtonElement;

    component.onFromDateChange(new Date('2026-01-01'));
    component.onToDateChange(null);
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    component.onSubmit();

    component.onFromDateChange(null);
    component.onToDateChange(new Date('2026-01-31'));
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
    component.onSubmit();

    expect(fetchMarketData).not.toHaveBeenCalled();
  });
});
