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
  // A new alert starts with no instrument selected; most tests are about
  // something else, so they begin with ^NDX picked. Pass '' to keep it empty.
  initialTicker?: string;
  // Defaults to a signed-in user; pass null for a session without one.
  currentUser?: { id: number; email: string; isAdmin: boolean } | null;
}

async function renderAlertForm(options: RenderOptions = {}) {
  const {
    serviceImpl = () => of(ALERT),
    dialogData = null,
    ensureLoaded = () => of(INSTRUMENTS),
    initialTicker = '^NDX',
    currentUser = { id: 1, email: 'user@example.com', isAdmin: false },
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
        useValue: { currentUser: () => currentUser },
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
    showRsiOption: () => boolean;
    selectedInstrumentCurrency: () => string;
  };
  if (!dialogData?.alert && initialTicker) {
    component.form.controls.ticker.setValue(initialTicker);
    result.fixture.detectChanges();
  }
  return { ...result, form: component.form, component, create, update, close };
}

describe('AlertForm', () => {
  it('rejects a non-numeric price threshold', async () => {
    const { form } = await renderAlertForm();

    form.controls.threshold.setValue('5' as unknown as number);

    expect(form.controls.threshold.hasError('positive')).toBe(true);
  });

  it('opens a new alert with defaults when the dialog data carries no alert', async () => {
    const { form, component } = await renderAlertForm({ dialogData: {}, initialTicker: '' });

    expect(form.getRawValue()).toEqual({
      ticker: '',
      alertType: 'PRICE',
      threshold: null,
      direction: 'up',
      notificationEmail: 'user@example.com',
    });
    expect((component as unknown as { isEditMode: boolean }).isEditMode).toBe(false);
  });

  it('leaves the notification email empty when nobody is signed in', async () => {
    const { form } = await renderAlertForm({ currentUser: null, initialTicker: '' });

    expect(form.controls.notificationEmail.value).toBe('');
  });

  it('accepts a pre-filled RSI threshold of 0, which the price rule would reject', async () => {
    const { form } = await renderAlertForm({ dialogData: { alert: { ...ALERT, alertType: 'RSI', threshold: 0 } } });

    expect(form.controls.threshold.valid).toBe(true);
  });

  it('rejects a pre-filled RSI threshold above 100', async () => {
    const { form } = await renderAlertForm({ dialogData: { alert: { ...ALERT, alertType: 'RSI', threshold: 150 } } });

    expect(form.controls.threshold.hasError('max')).toBe(true);
  });

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

    // ^NDX (rsiEligible) is pre-selected by the render helper, so switching to RSI is valid.
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

  it('starts a new alert with no instrument selected, which keeps the form invalid', async () => {
    const { form } = await renderAlertForm({ initialTicker: '' });

    expect(form.controls.ticker.value).toBe('');
    expect(form.controls.ticker.hasError('required')).toBe(true);
    expect(form.invalid).toBe(true);
  });

  it('selects the instrument chosen in the picker into the ticker control', async () => {
    const { fixture, form } = await renderAlertForm({ initialTicker: '' });
    const input = screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement;

    input.focus();
    fireEvent.input(input, { target: { value: 'cdr' } });
    fixture.detectChanges();
    fireEvent.click(await screen.findByRole('option', { name: 'CDR — CD Projekt' }));
    fixture.detectChanges();

    expect(form.controls.ticker.value).toBe('CDR');
  });

  it('shows the edited alert instrument in the picker', async () => {
    const { fixture } = await renderAlertForm({ dialogData: { alert: ALERT } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((screen.getByRole('combobox', { name: 'Instrument' }) as HTMLInputElement).value).toBe(
      '^NDX — NASDAQ-100',
    );
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

    // Every required control is filled except the threshold.
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

    // The load-error branch replaces the instrument picker with a notice —
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

  it('shows the selected instrument currency as a threshold suffix and updates it with the ticker', async () => {
    const { fixture, form } = await renderAlertForm();

    expect(screen.getByText('USD')).toBeTruthy();

    form.controls.ticker.setValue('CDR');
    fixture.detectChanges();

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

  it('keeps the pre-filled instrument in edit mode after instruments load', async () => {
    const stockAlert: Alert = {
      ...ALERT,
      ticker: 'CDR',
      instrumentName: 'CD Projekt',
      instrumentType: 'STOCK',
      currency: 'PLN',
    };
    const { form } = await renderAlertForm({ dialogData: { alert: stockAlert } });

    // Instrument lookup goes through the whole catalogue, so CDR resolves
    // (proven via the PLN currency suffix) without any type being selected.
    expect(form.controls.ticker.value).toBe('CDR');
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

    form.controls.ticker.setValue('UNKNOWN');
    fixture.detectChanges();

    // The lookup must yield the empty string, not a placeholder, so the currency
    // suffix simply disappears.
    expect(component.selectedInstrumentCurrency()).toBe('');
  });
});
