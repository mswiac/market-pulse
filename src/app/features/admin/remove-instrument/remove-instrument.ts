import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService, RemovedInstrument } from '../admin-panel.service';
import { InstrumentPicker } from '../../instruments/instrument-picker/instrument-picker';
import { InstrumentsService } from '../../instruments/instruments.service';
import { RemoveInstrumentConfirm, RemoveInstrumentConfirmData } from '../remove-instrument-confirm/remove-instrument-confirm';

// Backend returns a fixed set of machine-readable codes shared by both the
// impact-preview and delete calls (src/worker/routes/admin.ts) — mapped here
// to localized text rather than displaying the (English, code-facing) server message.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: $localize`:@@removeInstrument.error.forbidden:You don't have permission to do this.`,
  unknown_instrument: $localize`:@@removeInstrument.error.unknownInstrument:Unknown instrument.`,
};

const GENERIC_ERROR = $localize`:@@removeInstrument.error.generic:Something went wrong. Please try again.`;
const SNACKBAR_DURATION_MS = 5000;

@Component({
  selector: 'app-remove-instrument',
  imports: [
    InstrumentPicker,
    MatButtonModule,
    MatCardModule,
    MatSnackBarModule,
    MatDialogModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './remove-instrument.html',
  styleUrl: './remove-instrument.scss',
})
export class RemoveInstrument {
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly adminService = inject(AdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  protected readonly selectedTicker = signal('');

  protected readonly submitting = signal(false);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly noInstruments = computed(() => this.instrumentsService.instruments().length === 0);

  protected readonly canSubmit = computed(() => !!this.selectedTicker() && !this.submitting());

  constructor() {
    this.instrumentsService.ensureLoaded().subscribe({
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
      next: () => {
        this.selectedTicker.set('');
        this.loading.set(false);
      },
    });
  }

  protected onTickerChange(ticker: string): void {
    this.selectedTicker.set(ticker);
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;

    const ticker = this.selectedTicker();
    this.submitting.set(true);

    this.adminService.getInstrumentImpact(ticker).subscribe({
      next: (impact) => this.openConfirmDialog(ticker, impact.alertsCount),
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private openConfirmDialog(ticker: string, alertsCount: number): void {
    const data: RemoveInstrumentConfirmData = { ticker, alertsCount };

    this.dialog
      .open(RemoveInstrumentConfirm, { data })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.removeInstrument(ticker);
        } else {
          this.submitting.set(false);
        }
      });
  }

  private removeInstrument(ticker: string): void {
    this.adminService.removeInstrument(ticker).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.loading.set(true);
        this.instrumentsService.reload().subscribe({
          next: () => {
            this.selectedTicker.set('');
            this.loading.set(false);
          },
          error: () => this.loading.set(false),
        });
        this.showResult(result);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private showResult(result: RemovedInstrument): void {
    const message = $localize`:@@removeInstrument.result.success:Removed ${result.ticker}:INTERPOLATION: (${result.alertsDeleted}:INTERPOLATION_1: alert(s) deleted).`;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }

  private showError(err: unknown): void {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    const message = (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }
}
