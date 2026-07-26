import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../../core/auth/auth.service';
import { InstrumentsService } from '../../instruments/instruments.service';
import { Alert, AlertsService } from '../alerts.service';

export interface AlertFormData {
  alert?: Alert;
}

const VIX_RSI_ERROR = 'RSI is not available for VIX';

const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  index: $localize`:@@alertForm.instrumentType.index:Index`,
};

function positiveNumberValidator(): ValidatorFn {
  return (control) => (typeof control.value === 'number' && control.value > 0 ? null : { positive: true });
}

function rsiRangeValidators(): ValidatorFn[] {
  return [Validators.min(0), Validators.max(100)];
}

function priceValidators(): ValidatorFn[] {
  return [positiveNumberValidator()];
}

@Component({
  selector: 'app-alert-form',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule],
  templateUrl: './alert-form.html',
  styleUrl: './alert-form.scss',
})
export class AlertForm {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<AlertForm>);
  private readonly alertsService = inject(AlertsService);
  private readonly authService = inject(AuthService);
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly data = inject<AlertFormData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly isEditMode = !!this.data?.alert;

  // Tracks the type select's current value reactively — a computed() can't
  // read a FormControl directly. Initialized synchronously (same as the
  // instrumentType control below), so it's already correct in edit mode
  // before the instruments cache has even loaded.
  protected readonly selectedInstrumentType = signal(this.data?.alert?.instrumentType ?? '');
  protected readonly instrumentTypes = this.instrumentsService.types;
  protected readonly instrumentOptions = computed(() =>
    this.instrumentsService.instruments().filter((i) => i.type === this.selectedInstrumentType()),
  );
  protected readonly loadError = signal(false);

  // Initial values (including the threshold validators matching the edited
  // alert's alertType) are set here, in the group initializer — this runs
  // before the constructor wires the reset-on-change subscriptions below, so
  // pre-filling an edit never triggers them and never wipes the values.
  protected readonly form = this.fb.nonNullable.group({
    instrumentType: [this.data?.alert?.instrumentType ?? '', Validators.required],
    ticker: [this.data?.alert?.ticker ?? '', Validators.required],
    alertType: [this.data?.alert?.alertType ?? 'PRICE', Validators.required],
    threshold: this.fb.control<number | null>(this.data?.alert?.threshold ?? null, [
      Validators.required,
      ...(this.data?.alert?.alertType === 'RSI' ? rsiRangeValidators() : priceValidators()),
    ]),
    notificationEmail: [
      this.data?.alert?.notificationEmail ?? this.authService.currentUser()?.email ?? '',
      [Validators.required, Validators.email],
    ],
  });

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  constructor() {
    // These valueChanges subscriptions must be wired up before calling
    // ensureLoaded() below: once the instruments cache is warm (any dialog
    // open after the first), ensureLoaded() emits synchronously, and a
    // setValue() triggered before a listener exists is silently dropped —
    // the type→ticker cascade would never fire and the ticker control
    // would stay empty (and invalid) on every subsequent form open.
    this.form.controls.instrumentType.valueChanges.subscribe((type) => {
      this.selectedInstrumentType.set(type);
      const firstMatch = this.instrumentOptions()[0];
      if (firstMatch) {
        this.form.controls.ticker.setValue(firstMatch.ticker);
      }
    });

    this.form.controls.ticker.valueChanges.subscribe((ticker) => {
      const instrument = this.instrumentOptions().find((i) => i.ticker === ticker);
      if (instrument && !instrument.rsiEligible && this.form.controls.alertType.value === 'RSI') {
        this.form.controls.alertType.setValue('PRICE');
      }
    });

    this.form.controls.alertType.valueChanges.subscribe((alertType) => {
      const thresholdControl = this.form.controls.threshold;
      thresholdControl.setValidators([
        Validators.required,
        ...(alertType === 'RSI' ? rsiRangeValidators() : priceValidators()),
      ]);
      // A price threshold and an RSI threshold mean different things (and have
      // different valid ranges) — clear the old value rather than silently
      // carrying it over to a type it was never entered for.
      thresholdControl.reset(null);
    });

    this.instrumentsService.ensureLoaded().subscribe({
      error: () => this.loadError.set(true),
      next: () => {
        if (!this.isEditMode && !this.form.controls.instrumentType.value) {
          this.form.controls.instrumentType.setValue(this.instrumentTypes()[0]);
        }
      },
    });
  }

  protected instrumentTypeLabel(type: string): string {
    return INSTRUMENT_TYPE_LABELS[type] ?? type;
  }

  protected showRsiOption(): boolean {
    return !!this.instrumentOptions().find((i) => i.ticker === this.form.controls.ticker.value)?.rsiEligible;
  }

  // Read-only, informational only — not part of the threshold control's value
  // and never submitted as part of the form payload.
  protected selectedInstrumentCurrency(): string {
    return this.instrumentOptions().find((i) => i.ticker === this.form.controls.ticker.value)?.currency ?? '';
  }

  protected onThresholdBlur(event: FocusEvent): void {
    const value = this.form.controls.threshold.value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Display-only: reformats the visible text to 2 decimals without
      // changing the control's underlying numeric value.
      (event.target as HTMLInputElement).value = value.toFixed(2);
    }
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting() || this.loadError()) return;

    this.formError.set(null);
    this.submitting.set(true);
    const { ticker, alertType, threshold, notificationEmail } = this.form.getRawValue();
    const payload = { ticker, alertType, threshold: threshold as number, notificationEmail };

    const request$ = this.isEditMode
      ? this.alertsService.update(this.data!.alert!.id, payload)
      : this.alertsService.create(payload);

    request$.subscribe({
      next: () => this.dialogRef.close(true),
      error: (err: unknown) => {
        this.submitting.set(false);
        this.formError.set(this.messageFor(err));
      },
    });
  }

  private messageFor(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409) {
        return $localize`:@@alertForm.error.duplicateAlert:An alert like this already exists.`;
      }
      if (err.status === 404) {
        return $localize`:@@alertForm.error.notFound:This alert no longer exists.`;
      }
      const serverError = (err.error as { error?: string } | null)?.error;
      if (err.status === 400 && serverError === VIX_RSI_ERROR) {
        return $localize`:@@alertForm.error.rsiUnavailableForVix:RSI is not available for VIX.`;
      }
    }
    return $localize`:@@alertForm.error.generic:Something went wrong. Please try again.`;
  }
}
