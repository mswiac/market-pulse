import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, CreatedInstrument } from '../admin-panel.service';
import { CREATABLE_INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS } from '../../instruments/instrument-types';
import { InstrumentsService } from '../../instruments/instruments.service';

const CURRENCIES: readonly string[] = ['EUR', 'PLN', 'USD'];

// Backend returns a fixed set of machine-readable codes for validation and
// duplicate-ticker failures (src/worker/routes/admin.ts) — mapped here to
// localized text rather than displaying the (English, code-facing) server message.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: $localize`:@@addInstrument.error.forbidden:You don't have permission to do this.`,
  invalid_body: $localize`:@@addInstrument.error.invalidBody:Invalid request. Please try again.`,
  instrument_type_invalid: $localize`:@@addInstrument.error.typeInvalid:Please select a valid type.`,
  instrument_ticker_required: $localize`:@@addInstrument.error.tickerRequired:Please enter a ticker.`,
  instrument_name_required: $localize`:@@addInstrument.error.nameRequired:Please enter a company name.`,
  instrument_currency_invalid: $localize`:@@addInstrument.error.currencyInvalid:Currency must be a 3-letter code (e.g. USD, PLN).`,
  instrument_duplicate_ticker: $localize`:@@addInstrument.error.duplicateTicker:This ticker already exists.`,
};

const GENERIC_ERROR = $localize`:@@addInstrument.error.generic:Something went wrong. Please try again.`;
const SNACKBAR_DURATION_MS = 5000;

@Component({
  selector: 'app-add-instrument',
  imports: [MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule, MatCardModule, MatSnackBarModule, MatCheckboxModule],
  templateUrl: './add-instrument.html',
  styleUrl: './add-instrument.scss',
})
export class AddInstrument {
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly adminService = inject(AdminService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly creatableInstrumentTypes = CREATABLE_INSTRUMENT_TYPES;
  protected readonly currencies = CURRENCIES;
  protected readonly type = signal(CREATABLE_INSTRUMENT_TYPES[0]);
  protected readonly ticker = signal('');
  protected readonly name = signal('');
  protected readonly currency = signal(CURRENCIES[0]);
  protected readonly rsiEligible = signal(true);
  protected readonly submitting = signal(false);

  protected readonly canSubmit = computed(() => !!this.ticker().trim() && !!this.name().trim() && !this.submitting());

  protected instrumentTypeLabel(type: string): string {
    return INSTRUMENT_TYPE_LABELS[type] ?? type;
  }

  protected onTypeChange(type: string): void {
    this.type.set(type);
  }

  protected onTickerChange(ticker: string): void {
    this.ticker.set(ticker);
  }

  // Uppercases the typed ticker in place on blur — tickers are conventionally
  // uppercase for both Yahoo and Stooq; the server normalizes too, but this
  // gives instant feedback instead of a silent case change only visible after submit.
  protected onTickerBlur(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    const uppercased = input.value.trim().toUpperCase();
    input.value = uppercased;
    this.ticker.set(uppercased);
  }

  protected onNameChange(name: string): void {
    this.name.set(name);
  }

  protected onCurrencyChange(currency: string): void {
    this.currency.set(currency);
  }

  protected onRsiEligibleChange(checked: boolean): void {
    this.rsiEligible.set(checked);
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);

    this.adminService.addInstrument(this.type(), this.ticker().trim(), this.name().trim(), this.currency().trim(), this.rsiEligible()).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.resetForm();
        this.instrumentsService.reload().subscribe();
        this.showResult(result);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private resetForm(): void {
    this.type.set(CREATABLE_INSTRUMENT_TYPES[0]);
    this.ticker.set('');
    this.name.set('');
    this.currency.set(CURRENCIES[0]);
    this.rsiEligible.set(true);
  }

  private showResult(result: CreatedInstrument): void {
    const message = $localize`:@@addInstrument.result.success:Added instrument ${result.ticker}:INTERPOLATION:.`;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }

  private showError(err: unknown): void {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    const message = (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }
}
