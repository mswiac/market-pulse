import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { InstrumentsService } from '../../instruments/instruments.service';
import { AdminService, CronRunMarket, CronRunSummary } from '../admin-panel.service';
import { CronRunConfirm } from '../cron-run-confirm/cron-run-confirm';

// The page sends fixed, valid bodies, so the only realistic non-2xx codes are
// the shared 401/403 (401 is handled globally by sessionExpiredInterceptor's
// redirect) — no request-specific validation codes are reachable from here.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: $localize`:@@cronRun.error.forbidden:You don't have permission to do this.`,
};

const GENERIC_ERROR = $localize`:@@cronRun.error.generic:Something went wrong. Please try again.`;
const MARKETS: CronRunMarket[] = ['pl', 'other'];

const TICKER_COLUMNS = ['instrument', 'status', 'error'];
const EMAIL_COLUMNS = ['instrument', 'alertId', 'status', 'error'];

@Component({
  selector: 'app-cron-run',
  imports: [MatButtonModule, MatCardModule, MatDialogModule, MatProgressSpinnerModule, MatTableModule],
  templateUrl: './cron-run.html',
  styleUrl: './cron-run.scss',
})
export class CronRun {
  private readonly adminService = inject(AdminService);
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly dialog = inject(MatDialog);

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

  // Three requests, each with its own subrequest budget: both markets fetch
  // in parallel, then one evaluation. A failed request becomes an entry in
  // `errors` instead of aborting, so the later stages still run (evaluation
  // guards against stale market data itself).
  private run(): void {
    this.submitting.set(true);
    this.result.set(null);

    forkJoin(MARKETS.map((market) => this.settle(this.adminService.fetchCronMarket(market))))
      .pipe(
        switchMap((fetches) =>
          this.settle(this.adminService.evaluateCronAlerts()).pipe(map((evaluation) => mergeSummaries([...fetches, evaluation]))),
        ),
      )
      .subscribe((summary) => {
        this.submitting.set(false);
        this.result.set(summary);
      });
  }

  private settle(request: Observable<CronRunSummary>): Observable<CronRunSummary> {
    return request.pipe(
      catchError((err: unknown) => of({ tickers: [], alertsEvaluated: 0, emails: [], errors: [this.errorMessage(err)] })),
    );
  }

  private errorMessage(err: unknown): string {
    const code = err instanceof HttpErrorResponse && typeof err.error?.code === 'string' ? err.error.code : null;
    return (code && ERROR_MESSAGES[code]) || GENERIC_ERROR;
  }
}

function mergeSummaries(summaries: CronRunSummary[]): CronRunSummary {
  return {
    tickers: summaries.flatMap((s) => s.tickers),
    alertsEvaluated: summaries.reduce((sum, s) => sum + s.alertsEvaluated, 0),
    emails: summaries.flatMap((s) => s.emails),
    errors: summaries.flatMap((s) => s.errors),
  };
}
