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
  const result = await render(AlertForm, {
    providers: [
      { provide: MatDialogRef, useValue: { close: () => {} } },
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
  };
  return { ...result, form: component.form, component, create, update };
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
});
