import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Instrument, InstrumentsService } from '../instruments/instruments.service';
import { AdminService, MarketDataFetchResult } from './admin-panel.service';

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  index: $localize`:@@instrumentHistory.instrumentType.index:Index`,
};

// Backend returns a fixed set of machine-readable codes for validation and
// fetch failures (src/worker/routes/admin.ts) — mapped here to localized
// text rather than displaying the (English, code-facing) server message.
const ERROR_MESSAGES: Record<string, string> = {
  ticker_required: $localize`:@@adminPanel.error.tickerRequired:Please select an instrument.`,
  invalid_dates: $localize`:@@adminPanel.error.invalidDates:Please select valid from/to dates.`,
  invalid_range_order: $localize`:@@adminPanel.error.invalidRangeOrder:The start date must not be after the end date.`,
  future_to_date: $localize`:@@adminPanel.error.futureToDate:The end date must not be in the future.`,
  range_too_large: $localize`:@@adminPanel.error.rangeTooLarge:The selected range is too large (max 730 days).`,
  unknown_instrument: $localize`:@@adminPanel.error.unknownInstrument:Unknown instrument.`,
  fetch_failed: $localize`:@@adminPanel.error.fetchFailed:Fetching market data failed. Please try again.`,
  write_failed: $localize`:@@adminPanel.error.writeFailed:Saving market data failed. Please try again.`,
  forbidden: $localize`:@@adminPanel.error.forbidden:You don't have permission to do this.`,
};

const GENERIC_ERROR = $localize`:@@adminPanel.result.errorGeneric:Something went wrong. Please try again.`;
const SNACKBAR_DURATION_MS = 5000;

@Component({
  selector: 'app-admin-panel',
  imports: [MatFormFieldModule, MatSelectModule, MatInputModule, MatDatepickerModule, MatButtonModule, MatCardModule, MatSnackBarModule],
  templateUrl: './admin-panel.html',
  styleUrl: './admin-panel.scss',
})
export class AdminPanel {
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly adminService = inject(AdminService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly instrumentTypes = computed(() =>
    [...this.instrumentsService.types()].sort((a, b) => this.instrumentTypeLabel(a).localeCompare(this.instrumentTypeLabel(b))),
  );
  protected readonly selectedInstrumentType = signal('');
  protected readonly instrumentOptions = computed(() =>
    this.instrumentsService
      .instruments()
      .filter((i: Instrument) => i.type === this.selectedInstrumentType())
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  protected readonly selectedTicker = signal('');

  protected readonly fromDate = signal<Date | null>(null);
  protected readonly toDate = signal<Date | null>(null);

  protected readonly submitting = signal(false);

  protected readonly loadError = signal(false);

  protected readonly canSubmit = computed(
    () => !!this.selectedTicker() && this.fromDate() !== null && this.toDate() !== null && !this.submitting(),
  );

  constructor() {
    this.instrumentsService.ensureLoaded().subscribe({
      error: () => this.loadError.set(true),
      next: () => {
        const firstType = this.instrumentTypes()[0];
        if (firstType) this.onTypeChange(firstType);
      },
    });
  }

  protected instrumentTypeLabel(type: string): string {
    return INSTRUMENT_TYPE_LABELS[type] ?? type;
  }

  protected onTypeChange(type: string): void {
    this.selectedInstrumentType.set(type);
    const firstMatch = this.instrumentOptions()[0];
    this.selectedTicker.set(firstMatch ? firstMatch.ticker : '');
  }

  protected onTickerChange(ticker: string): void {
    this.selectedTicker.set(ticker);
  }

  protected onFromDateChange(date: Date | null): void {
    this.fromDate.set(date);
  }

  protected onToDateChange(date: Date | null): void {
    this.toDate.set(date);
  }

  protected onSubmit(): void {
    const from = this.fromDate();
    const to = this.toDate();
    if (!this.canSubmit() || !from || !to) return;

    this.submitting.set(true);

    this.adminService.fetchMarketData(this.selectedTicker(), toIsoDate(from), toIsoDate(to)).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.showResult(result);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private showResult(result: MarketDataFetchResult): void {
    const message = $localize`:@@adminPanel.result.success:Saved ${result.daysWritten}:INTERPOLATION: day(s) for ${result.ticker}:INTERPOLATION_1: (${result.from}:INTERPOLATION_2: – ${result.to}:INTERPOLATION_3:).`;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }

  private showError(err: unknown): void {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    const message = (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }
}
