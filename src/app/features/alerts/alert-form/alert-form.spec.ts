import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { render, screen } from '@testing-library/angular/zoneless';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { Instrument, InstrumentsService } from '../../instruments/instruments.service';
import { AlertsService } from '../alerts.service';
import { AlertForm } from './alert-form';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'INDEX', rsiEligible: true, currency: 'USD' },
  { ticker: '^VIX', name: 'VIX', type: 'INDEX', rsiEligible: false, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'STOCK', rsiEligible: true, currency: 'PLN' },
];

async function renderAlertForm() {
  const result = await render(AlertForm, {
    providers: [
      { provide: MatDialogRef, useValue: { close: () => {} } },
      { provide: MAT_DIALOG_DATA, useValue: null },
      {
        provide: AuthService,
        useValue: { currentUser: () => ({ id: 1, email: 'user@example.com', isAdmin: false }) },
      },
      {
        provide: InstrumentsService,
        useValue: {
          instruments: () => INSTRUMENTS,
          types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
          ensureLoaded: () => of(INSTRUMENTS),
        },
      },
      { provide: AlertsService, useValue: { create: () => of(null), update: () => of(null) } },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    form: AlertForm['form'];
  };
  return { ...result, form: component.form };
}

describe('AlertForm', () => {
  it('rejects a zero or negative price threshold via positiveNumberValidator', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.threshold.setValue(-5);
    form.controls.threshold.markAsTouched();
    fixture.detectChanges();

    expect(form.controls.threshold.hasError('positive')).toBe(true);
    expect(await screen.findByText('Value must be greater than 0.')).toBeTruthy();
  });

  it('rejects an out-of-range RSI threshold and resets the threshold when alertType switches to RSI', async () => {
    const { fixture, form } = await renderAlertForm();

    // Default ticker after render is ^NDX (rsiEligible), so switching to RSI is valid.
    form.controls.threshold.setValue(42);
    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();

    // Threshold must reset to null on alertType change, not carry over the old price value.
    expect(form.controls.threshold.value).toBeNull();

    form.controls.threshold.setValue(150);
    form.controls.threshold.markAsTouched();
    fixture.detectChanges();

    expect(form.controls.threshold.hasError('max')).toBe(true);
    expect(await screen.findByText('Value must be between 0 and 100.')).toBeTruthy();
  });

  it('auto-fills the ticker to the first matching instrument when instrumentType changes', async () => {
    const { fixture, form } = await renderAlertForm();

    expect(form.controls.ticker.value).toBe('^NDX');

    form.controls.instrumentType.setValue('STOCK');
    fixture.detectChanges();

    expect(form.controls.ticker.value).toBe('CDR');
  });

  it('resets alertType to PRICE when the ticker switches to a non-RSI-eligible instrument', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();
    expect(form.controls.alertType.value).toBe('RSI');

    form.controls.ticker.setValue('^VIX');
    fixture.detectChanges();

    expect(form.controls.alertType.value).toBe('PRICE');
  });
});
