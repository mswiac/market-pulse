import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Subject, of, throwError } from 'rxjs';
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
  impl: () => ReturnType<AdminService['addInstrument']> = () => of(CREATED),
  reload = vi.fn(() => of([])),
) {
  const addInstrument = vi.fn(impl);
  const result = await render(AddInstrument, {
    providers: [
      { provide: InstrumentsService, useValue: { reload } },
      { provide: AdminService, useValue: { addInstrument } },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    onTypeChange: (type: string) => void;
    onSubmit: () => void;
    type: () => string;
    ticker: () => string;
    currency: () => string;
    rsiEligible: () => boolean;
  };
  return { ...result, component, addInstrument, reload };
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
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

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

  it('submits the current form values as a trimmed payload, with the default type/currency/RSI flag', async () => {
    const { fixture, addInstrument } = await renderAddInstrument();
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: '  ABC  ' } });
    fireEvent.input(nameInput(), { target: { value: '  Foo Corp  ' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(addInstrument).toHaveBeenCalledWith(
      CREATABLE_INSTRUMENT_TYPES[0],
      'ABC',
      'Foo Corp',
      'EUR',
      true,
      '',
    );
  });

  it('shows the mapped message for a known error code', async () => {
    const { fixture } = await renderAddInstrument(() =>
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { code: 'instrument_duplicate_ticker' } }),
      ),
    );
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

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
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('keeps the submit button disabled and ignores a second submit while the create is in flight', async () => {
    const pending = new Subject<CreatedInstrument>();
    const { fixture, component, addInstrument } = await renderAddInstrument(() => pending);
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(addInstrument).toHaveBeenCalledTimes(1);
  });

  it('re-enables the submit button after a failed create', async () => {
    const pending = new Subject<CreatedInstrument>();
    const { fixture } = await renderAddInstrument(() => pending);
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    pending.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });

  it('re-enables the submit button for a second instrument after a successful create', async () => {
    const pending = new Subject<CreatedInstrument>();
    const { fixture } = await renderAddInstrument(() => pending);
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    fireEvent.click(submitButton());
    fixture.detectChanges();

    pending.next(CREATED);
    fixture.detectChanges();

    // resetForm() clears the fields — the button is disabled until the next instrument is entered.
    expect(submitButton().disabled).toBe(true);

    fireEvent.input(tickerInput(), { target: { value: 'XYZ' } });
    fireEvent.input(nameInput(), { target: { value: 'Bar Corp' } });
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(false);
  });

  it('keeps submit disabled when the ticker or the name is blank or whitespace-only', async () => {
    const { fixture } = await renderAddInstrument();
    const tickerInput = () => screen.getByLabelText('Ticker') as HTMLInputElement;
    const nameInput = () => screen.getByLabelText('Company name') as HTMLInputElement;
    const submitButton = () =>
      screen.getByRole('button', { name: 'Add instrument' }) as HTMLButtonElement;

    fireEvent.input(tickerInput(), { target: { value: 'ABC' } });
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);

    fireEvent.input(nameInput(), { target: { value: '   ' } });
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);

    fireEvent.input(tickerInput(), { target: { value: '   ' } });
    fireEvent.input(nameInput(), { target: { value: 'Foo Corp' } });
    fixture.detectChanges();
    expect(submitButton().disabled).toBe(true);
  });
});
