import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { of, throwError } from 'rxjs';
import { InstrumentsService } from '../../instruments/instruments.service';
import { CREATABLE_INSTRUMENT_TYPES } from '../../instruments/instrument-types';
import { AdminService, CreatedInstrument } from '../admin-panel.service';
import { AddInstrument } from './add-instrument';

const CREATED: CreatedInstrument = {
  ticker: 'ABC',
  name: 'Foo Corp',
  type: 'us_stock',
  rsiEligible: true,
  provider: 'yahoo',
  currency: 'USD',
  suffix: '',
};

async function renderAddInstrument(
  addInstrument: () => ReturnType<AdminService['addInstrument']> = () => of(CREATED),
  reload = vi.fn(() => of([])),
) {
  const result = await render(AddInstrument, {
    providers: [
      { provide: InstrumentsService, useValue: { reload } },
      { provide: AdminService, useValue: { addInstrument } },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    onTypeChange: (type: string) => void;
    type: () => string;
    ticker: () => string;
    currency: () => string;
    rsiEligible: () => boolean;
  };
  return { ...result, component, reload };
}

describe('AddInstrument', () => {
  it('prefills the suffix on type change, and a manual suffix edit survives unrelated field changes', async () => {
    const { fixture, component } = await renderAddInstrument();
    const suffixInput = () => screen.getByLabelText('Suffix (e.g. .WA)') as HTMLInputElement;
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;

    component.onTypeChange('pl_stock');
    fixture.detectChanges();
    expect(suffixInput().value).toBe('.WA');

    // A manual edit is only ever overwritten by a genuine mat-select
    // selectionChange (onTypeChange) — not by typing in an unrelated field.
    fireEvent.input(suffixInput(), { target: { value: '.CUSTOM' } });
    fixture.detectChanges();
    fireEvent.input(tickerInput(), { target: { value: 'CDR' } });
    fixture.detectChanges();
    expect(suffixInput().value).toBe('.CUSTOM');

    component.onTypeChange('us_stock');
    fixture.detectChanges();
    expect(suffixInput().value).toBe('');
  });

  it('uppercases the ticker on blur, in both the signal and the rendered input', async () => {
    const { fixture, component } = await renderAddInstrument();
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;

    fireEvent.input(tickerInput(), { target: { value: 'cdr' } });
    fixture.detectChanges();
    fireEvent.blur(tickerInput());
    fixture.detectChanges();

    expect(tickerInput().value).toBe('CDR');
    expect(component.ticker()).toBe('CDR');
  });

  it('resets the form and reloads the instrument list on a successful submit', async () => {
    const reload = vi.fn(() => of([]));
    const { fixture, component } = await renderAddInstrument(() => of(CREATED), reload);
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () => screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Added instrument ABC.')).toBeTruthy();
    expect(tickerInput().value).toBe('');
    expect(nameInput().value).toBe('');
    expect(component.type()).toBe(CREATABLE_INSTRUMENT_TYPES[0]);
    expect(component.currency()).toBe('EUR');
    expect(component.rsiEligible()).toBe(true);
    expect(reload).toHaveBeenCalled();
  });

  it('shows the mapped message for a known error code', async () => {
    const { fixture } = await renderAddInstrument(() =>
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'instrument_duplicate_ticker' } })),
    );
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () => screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('This ticker already exists.')).toBeTruthy();
  });

  it('falls back to the generic message for an unrecognized error code', async () => {
    const { fixture } = await renderAddInstrument(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'totally_unknown' } })),
    );
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () => screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});
