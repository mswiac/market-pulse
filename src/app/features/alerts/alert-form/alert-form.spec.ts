import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fireEvent, render, screen } from '@testing-library/angular/zoneless';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { Instrument, InstrumentsService } from '../../instruments/instruments.service';
import { Alert, AlertsService } from '../alerts.service';
import { AlertForm, AlertFormData } from './alert-form';

const INSTRUMENTS: Instrument[] = [
  { ticker: '^NDX', name: 'NASDAQ-100', type: 'INDEX', rsiEligible: true, currency: 'USD' },
  { ticker: '^VIX', name: 'VIX', type: 'INDEX', rsiEligible: false, currency: 'USD' },
  { ticker: 'CDR', name: 'CD Projekt', type: 'STOCK', rsiEligible: true, currency: 'PLN' },
];

const ALERT: Alert = {
  id: 42,
  ticker: '^NDX',
  instrumentName: 'NASDAQ-100',
  instrumentType: 'INDEX',
  currency: 'USD',
  alertType: 'PRICE',
  threshold: 100,
  direction: 'up',
  active: true,
  notificationEmail: 'user@example.com',
  createdAt: 0,
  updatedAt: 0,
  currentPrice: null,
  currentRsi: null,
  currentHigh: null,
  currentLow: null,
};

interface RenderOptions {
  // Caller-controlled create/update implementation. Default resolves synchronously
  // (of(ALERT)); pass `() => new Subject<Alert>()` to hold the request in flight.
  serviceImpl?: () => Observable<Alert>;
  dialogData?: AlertFormData | null;
  ensureLoaded?: () => Observable<Instrument[]>;
}

async function renderAlertForm(options: RenderOptions = {}) {
  const {
    serviceImpl = () => of(ALERT),
    dialogData = null,
    ensureLoaded = () => of(INSTRUMENTS),
  } = options;
  const create = vi.fn(serviceImpl);
  const update = vi.fn(serviceImpl);
  const close = vi.fn();
  const result = await render(AlertForm, {
    providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: dialogData },
      {
        provide: AuthService,
        useValue: { currentUser: () => ({ id: 1, email: 'user@example.com', isAdmin: false }) },
      },
      {
        // Plain functions, not signal()/computed() — non-reactive on purpose.
        // A test that mutates the instrument list mid-run would need real signals here.
        provide: InstrumentsService,
        useValue: {
          instruments: () => INSTRUMENTS,
          types: () => [...new Set(INSTRUMENTS.map((i) => i.type))],
          ensureLoaded,
        },
      },
      { provide: AlertsService, useValue: { create, update } },
    ],
  });
  const component = result.fixture.componentInstance as unknown as {
    form: AlertForm['form'];
    onSubmit: () => void;
    submitting: () => boolean;
    instrumentTypeLabel: (type: string) => string;
    showRsiOption: () => boolean;
    selectedInstrumentCurrency: () => string;
  };
  return { ...result, form: component.form, component, create, update, close };
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
    // The ticker mat-select's closed trigger renders the selected option's
    // label — proves the template reflects the cascade, not just the control.
    expect(await screen.findByText('CD Projekt')).toBeTruthy();
  });

  it('resets alertType to PRICE when the ticker switches to a non-RSI-eligible instrument', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();
    expect(form.controls.alertType.value).toBe('RSI');
    expect(screen.getByText('RSI')).toBeTruthy();

    form.controls.ticker.setValue('^VIX');
    fixture.detectChanges();

    expect(form.controls.alertType.value).toBe('PRICE');
    // showRsiOption() must re-evaluate to false — the @if removes the RSI
    // mat-option from the DOM entirely, not just deselect it.
    expect(screen.queryByText('RSI')).toBeNull();
  });

  // Submit-guard / submitting-flag / double-submit mutants (issue #114): the old
  // synchronous `of(null)` stub never let a test observe the in-flight state.

  const createSubmitButton = () =>
    screen.getByRole('button', { name: 'Create alert' }) as HTMLButtonElement;

  it('does not submit while the form is invalid', async () => {
    const { fixture, form, component, create } = await renderAlertForm();
    fixture.detectChanges();

    // The render cascade fills every required control except the threshold.
    expect(form.invalid).toBe(true);

    component.onSubmit();

    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled and ignores a second submit while the create is in flight', async () => {
    const pending = new Subject<Alert>();
    const { fixture, form, component, create } = await renderAlertForm({
      serviceImpl: () => pending,
    });

    form.controls.threshold.setValue(100);
    fixture.detectChanges();
    expect(createSubmitButton().disabled).toBe(false);

    fireEvent.click(createSubmitButton());
    fixture.detectChanges();

    expect(createSubmitButton().disabled).toBe(true);

    component.onSubmit();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('re-enables the submit button after a failed create', async () => {
    const pending = new Subject<Alert>();
    const { fixture, form } = await renderAlertForm({ serviceImpl: () => pending });

    form.controls.threshold.setValue(100);
    fixture.detectChanges();
    fireEvent.click(createSubmitButton());
    fixture.detectChanges();

    pending.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();

    expect(createSubmitButton().disabled).toBe(false);
  });

  it('does not submit while the instruments list failed to load', async () => {
    const { fixture, component, create } = await renderAlertForm({
      serviceImpl: () => new Subject<Alert>(),
      ensureLoaded: () => throwError(() => new Error('boom')),
    });
    fixture.detectChanges();

    // The load-error branch replaces the type/instrument fields with a notice —
    // its presence proves loadError() is genuinely true.
    expect(
      screen.getByText('Failed to load instruments. Please close this dialog and try again.'),
    ).toBeTruthy();

    component.onSubmit();

    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled while an edit is in flight', async () => {
    const pending = new Subject<Alert>();
    const { fixture, component, create, update } = await renderAlertForm({
      dialogData: { alert: ALERT },
      serviceImpl: () => pending,
    });
    const submitButton = () =>
      screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    fixture.detectChanges();

    // ALERT pre-fills every control, so the form is valid immediately.
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());
    fixture.detectChanges();

    expect(submitButton().disabled).toBe(true);

    component.onSubmit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  // messageFor() error map (issue #114): onSubmit's error path was uncovered —
  // one assertion per branch, against the rendered <p class="form-error"> text.

  async function submitValidCreate(errorResponse: HttpErrorResponse) {
    const rendered = await renderAlertForm({ serviceImpl: () => throwError(() => errorResponse) });
    rendered.form.controls.threshold.setValue(100);
    rendered.fixture.detectChanges();
    fireEvent.click(createSubmitButton());
    rendered.fixture.detectChanges();
    return rendered;
  }

  it('shows the duplicate-alert message on a 409', async () => {
    await submitValidCreate(new HttpErrorResponse({ status: 409 }));
    expect(await screen.findByText('An alert like this already exists.')).toBeTruthy();
  });

  it('shows the not-found message on a 404', async () => {
    await submitValidCreate(new HttpErrorResponse({ status: 404 }));
    expect(await screen.findByText('This alert no longer exists.')).toBeTruthy();
  });

  it('shows the RSI-unavailable message on a 400 with code rsi_not_eligible', async () => {
    await submitValidCreate(
      new HttpErrorResponse({ status: 400, error: { code: 'rsi_not_eligible' } }),
    );
    expect(await screen.findByText('RSI is not available for VIX.')).toBeTruthy();
  });

  it('falls back to the generic message for an unmapped error', async () => {
    await submitValidCreate(new HttpErrorResponse({ status: 500 }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('needs BOTH a 400 and the rsi_not_eligible code for the RSI message — 400 alone is generic', async () => {
    await submitValidCreate(
      new HttpErrorResponse({ status: 400, error: { code: 'something_else' } }),
    );
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('needs BOTH a 400 and the rsi_not_eligible code for the RSI message — the code alone is generic', async () => {
    await submitValidCreate(
      new HttpErrorResponse({ status: 500, error: { code: 'rsi_not_eligible' } }),
    );
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  // Broad Stryker sweep (issue #110): the submit-guard / messageFor class is
  // covered above; these close the success path, the error-reset facet, the
  // display helpers, and the negative branches of the valueChanges cascades.

  it('closes the dialog with true and submits the entered values on a successful create', async () => {
    const { fixture, form, create, update, close } = await renderAlertForm();

    form.controls.threshold.setValue(100);
    fixture.detectChanges();
    fireEvent.click(createSubmitButton());
    fixture.detectChanges();

    expect(create).toHaveBeenCalledWith({
      ticker: '^NDX',
      alertType: 'PRICE',
      threshold: 100,
      direction: 'up',
      notificationEmail: 'user@example.com',
    });
    expect(close).toHaveBeenCalledWith(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('routes a successful edit through update(id, payload) and closes with true', async () => {
    const { fixture, create, update, close } = await renderAlertForm({
      dialogData: { alert: ALERT },
    });
    const saveButton = () =>
      screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    fixture.detectChanges();

    fireEvent.click(saveButton());
    fixture.detectChanges();

    expect(update).toHaveBeenCalledWith(42, {
      ticker: '^NDX',
      alertType: 'PRICE',
      threshold: 100,
      direction: 'up',
      notificationEmail: 'user@example.com',
    });
    expect(close).toHaveBeenCalledWith(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('clears a stale error message when the user resubmits after a failure', async () => {
    let call = 0;
    const { fixture, form } = await renderAlertForm({
      serviceImpl: () =>
        call++ === 0 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(ALERT),
    });

    form.controls.threshold.setValue(100);
    fixture.detectChanges();
    fireEvent.click(createSubmitButton());
    fixture.detectChanges();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();

    fireEvent.click(createSubmitButton());
    fixture.detectChanges();

    // onSubmit's `formError.set(null)` is the only thing that clears it — the
    // success path never touches formError.
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  it('maps known instrument types to a human label and falls back to the raw type', async () => {
    const { component } = await renderAlertForm();

    expect(component.instrumentTypeLabel('index')).toBe('Index');
    expect(component.instrumentTypeLabel('us_stock')).toBe('US companies');
    expect(component.instrumentTypeLabel('crypto')).toBe('crypto');
  });

  it('shows the selected instrument currency as a threshold suffix and updates it with the ticker', async () => {
    const { fixture, form } = await renderAlertForm();

    expect(screen.getByText('USD')).toBeTruthy();

    form.controls.instrumentType.setValue('STOCK');
    fixture.detectChanges();

    expect(form.controls.ticker.value).toBe('CDR');
    expect(screen.getByText('PLN')).toBeTruthy();
    expect(screen.queryByText('USD')).toBeNull();
  });

  it('reformats a numeric threshold to two decimals on blur, ignoring empty and non-finite values', async () => {
    const { fixture, form } = await renderAlertForm();
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    form.controls.threshold.setValue(12.5);
    fixture.detectChanges();
    fireEvent.blur(input);
    expect(input.value).toBe('12.50');

    form.controls.threshold.reset(null);
    fixture.detectChanges();
    fireEvent.blur(input);
    expect(input.value).toBe('');

    form.controls.threshold.setValue(Infinity);
    fixture.detectChanges();
    fireEvent.blur(input);
    expect(input.value).not.toBe('Infinity');
  });

  it('rejects a threshold of exactly zero as a non-positive price', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.threshold.setValue(0);
    form.controls.threshold.markAsTouched();
    fixture.detectChanges();

    expect(form.controls.threshold.hasError('positive')).toBe(true);
  });

  it('accepts an in-range RSI threshold', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();
    form.controls.threshold.setValue(50);
    fixture.detectChanges();

    expect(form.controls.threshold.hasError('min')).toBe(false);
    expect(form.controls.threshold.hasError('max')).toBe(false);
    expect(form.controls.threshold.valid).toBe(true);
  });

  it('does not wipe the threshold when the ticker changes while alertType stays PRICE', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.threshold.setValue(250);
    fixture.detectChanges();

    // alertType is PRICE — switching instruments must not trip the alertType
    // reset cascade, which would clear the threshold.
    form.controls.ticker.setValue('^VIX');
    fixture.detectChanges();

    expect(form.controls.threshold.value).toBe(250);
  });

  it('swaps the threshold validators back to the price rules when alertType resets to PRICE', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();

    // ^VIX is not RSI-eligible → alertType auto-resets to PRICE → the cascade
    // must re-install the price validators, not keep the RSI range rules.
    form.controls.ticker.setValue('^VIX');
    fixture.detectChanges();
    expect(form.controls.alertType.value).toBe('PRICE');

    form.controls.threshold.setValue(-5);
    form.controls.threshold.markAsTouched();
    fixture.detectChanges();

    expect(form.controls.threshold.hasError('positive')).toBe(true);
  });

  it('keeps the pre-filled instrument type and options in edit mode after instruments load', async () => {
    const stockAlert: Alert = {
      ...ALERT,
      ticker: 'CDR',
      instrumentName: 'CD Projekt',
      instrumentType: 'STOCK',
      currency: 'PLN',
    };
    const { form } = await renderAlertForm({ dialogData: { alert: stockAlert } });

    // 'INDEX' is instrumentTypes()[0] — the load handler must not overwrite the
    // alert's own 'STOCK' type, and selectedInstrumentType must stay 'STOCK' so
    // instrumentOptions still resolves CDR (proven via the PLN currency suffix).
    expect(form.controls.instrumentType.value).toBe('STOCK');
    expect(await screen.findByText('PLN')).toBeTruthy();
  });

  it('keeps alertType RSI when the ticker switches to another RSI-eligible instrument', async () => {
    const { fixture, form } = await renderAlertForm();

    form.controls.alertType.setValue('RSI');
    fixture.detectChanges();
    expect(form.controls.alertType.value).toBe('RSI');

    // ^NDX is rsiEligible — the reset-to-PRICE cascade must NOT fire.
    form.controls.ticker.setValue('^NDX');
    fixture.detectChanges();

    expect(form.controls.alertType.value).toBe('RSI');
  });

  it('leaves the ticker untouched when the selected type has no matching instruments', async () => {
    const { fixture, form } = await renderAlertForm();
    expect(form.controls.ticker.value).toBe('^NDX');

    form.controls.instrumentType.setValue('NONEXISTENT');
    fixture.detectChanges();

    expect(form.controls.ticker.value).toBe('^NDX');
  });

  it('offers the RSI alert type only while the selected instrument is RSI-eligible', async () => {
    const { fixture, form, component } = await renderAlertForm();

    expect(component.showRsiOption()).toBe(true); // ^NDX is RSI-eligible

    form.controls.ticker.setValue('^VIX');
    fixture.detectChanges();

    expect(component.showRsiOption()).toBe(false); // ^VIX is not
  });

  it('reports no currency when the ticker matches no loaded instrument', async () => {
    const { fixture, form, component } = await renderAlertForm();

    expect(component.selectedInstrumentCurrency()).toBe('USD'); // ^NDX

    form.controls.instrumentType.setValue('NONEXISTENT');
    fixture.detectChanges();

    // Options are now empty and the ticker is stale — the lookup must yield the
    // empty string, not a placeholder, so the currency suffix simply disappears.
    expect(component.selectedInstrumentCurrency()).toBe('');
  });
});
