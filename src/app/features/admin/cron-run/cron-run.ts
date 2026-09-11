import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { InstrumentsService } from '../../instruments/instruments.service';
import { AdminService, CronRunSummary } from '../admin-panel.service';
import { CronRunConfirm } from '../cron-run-confirm/cron-run-confirm';

// This endpoint has no request body, so the only realistic non-2xx codes are
// the shared 401/403 (401 is handled globally by sessionExpiredInterceptor's
// redirect) — no request-specific validation codes exist here.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: $localize`:@@cronRun.error.forbidden:You don't have permission to do this.`,
};

const GENERIC_ERROR = $localize`:@@cronRun.error.generic:Something went wrong. Please try again.`;
const SNACKBAR_DURATION_MS = 5000;

const TICKER_COLUMNS = ['instrument', 'status', 'error'];
const EMAIL_COLUMNS = ['instrument', 'alertId', 'status', 'error'];

@Component({
  selector: 'app-cron-run',
  imports: [MatButtonModule, MatCardModule, MatDialogModule, MatProgressSpinnerModule, MatSnackBarModule, MatTableModule],
  templateUrl: './cron-run.html',
  styleUrl: './cron-run.scss',
})
export class CronRun {
  private readonly adminService = inject(AdminService);
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly tickerColumns = TICKER_COLUMNS;
  protected readonly emailColumns = EMAIL_COLUMNS;

  protected readonly submitting = signal(false);
  protected readonly result = signal<CronRunSummary | null>(null);

  constructor() {
    // Enrichment only (ticker -> instrument name in the results panel) —
    // does not gate the trigger button, which needs no instrument data.
    // Falls back to the raw ticker in `instrumentName()` if this never loads.
    this.instrumentsService.ensureLoaded().subscribe({ error: () => undefined });
  }

  protected instrumentName(ticker: string): string {
    return this.instrumentsService.instruments().find((i) => i.ticker === ticker)?.name ?? ticker;
  }

  protected tickerStatusLabel(status: 'ok' | 'error'): string {
    return status === 'ok' ? $localize`:@@cronRun.result.statusOk:OK` : $localize`:@@cronRun.result.statusError:Error`;
  }

  protected emailStatusLabel(status: 'sent' | 'failed'): string {
    return status === 'sent' ? $localize`:@@cronRun.result.statusSent:Sent` : $localize`:@@cronRun.result.statusFailed:Failed`;
  }

  protected alertsEvaluatedLabel(count: number): string {
    return $localize`:@@cronRun.result.alertsEvaluated:Alerts evaluated: ${count}:INTERPOLATION:`;
  }

  protected onTriggerClick(): void {
    this.dialog
      .open(CronRunConfirm)
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) this.run();
      });
  }

  private run(): void {
    this.submitting.set(true);
    this.result.set(null);

    this.adminService.triggerCronRun().subscribe({
      next: (summary) => {
        this.submitting.set(false);
        this.result.set(summary);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showError(err);
      },
    });
  }

  private showError(err: unknown): void {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    const message = (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
    this.snackBar.open(message, undefined, { duration: SNACKBAR_DURATION_MS });
  }
}
