import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../../core/auth/auth.service';
import { Alert, AlertsService } from '../alerts.service';

export interface AlertFormData {
  alert?: Alert;
}

const VIX_RSI_ERROR = 'RSI is not available for VIX';

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
  private readonly data = inject<AlertFormData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly isEditMode = !!this.data?.alert;

  // Initial values (including the threshold validators matching the edited
  // alert's alertType) are set here, in the group initializer — this runs
  // before the constructor wires the reset-on-change subscriptions below, so
  // pre-filling an edit never triggers them and never wipes the values.
  protected readonly form = this.fb.nonNullable.group({
    instrument: [this.data?.alert?.instrument ?? 'VIX', Validators.required],
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
    this.form.controls.instrument.valueChanges.subscribe((instrument) => {
      if (instrument === 'VIX' && this.form.controls.alertType.value === 'RSI') {
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
  }

  protected showRsiOption(): boolean {
    return this.form.controls.instrument.value !== 'VIX';
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
    if (this.form.invalid || this.submitting()) return;

    this.formError.set(null);
    this.submitting.set(true);
    const { instrument, alertType, threshold, notificationEmail } = this.form.getRawValue();
    const payload = { instrument, alertType, threshold: threshold as number, notificationEmail };

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
