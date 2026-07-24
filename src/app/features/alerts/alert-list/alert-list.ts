import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { AlertForm } from '../alert-form/alert-form';
import { Alert, AlertsService } from '../alerts.service';
import { DeleteAlertConfirm, DeleteAlertConfirmData } from '../delete-alert-confirm/delete-alert-confirm';

const INSTRUMENT_LABELS: Record<string, string> = {
  VIX: 'VIX',
  NASDAQ100: 'NASDAQ-100',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: $localize`:@@alertList.type.price:Price threshold`,
  RSI: $localize`:@@alertList.type.rsi:RSI threshold`,
};

// Short type words for the delete-confirm summary — deliberately distinct
// from ALERT_TYPE_LABELS above: those already bake "threshold" into the
// label text for the list's column context, which reads ambiguously once
// flattened into a single "instrument · type · value" line.
const ALERT_TYPE_SHORT_LABELS: Record<string, string> = {
  PRICE: $localize`:@@alertForm.alertType.price:Price`,
  RSI: 'RSI',
};

type SortableColumn = 'instrument' | 'alertType' | 'threshold';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-alert-list',
  imports: [MatExpansionModule, MatIconModule, MatButtonModule, MatDialogModule, DatePipe, DecimalPipe],
  templateUrl: './alert-list.html',
  styleUrl: './alert-list.scss',
})
export class AlertList {
  private readonly alertsService = inject(AlertsService);
  private readonly dialog = inject(MatDialog);

  protected readonly alerts = this.alertsService.alerts;
  protected readonly sortBy = signal<SortableColumn | null>(null);
  protected readonly sortDirection = signal<SortDirection>('asc');
  protected readonly loadError = signal(false);

  protected readonly sortedAlerts = computed(() => {
    const alerts = this.alerts();
    const sortBy = this.sortBy();
    if (!sortBy) return alerts;

    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return [...alerts].sort((a: Alert, b: Alert) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction * (aValue - bValue);
      }
      return direction * String(aValue).localeCompare(String(bValue));
    });
  });

  constructor() {
    this.alertsService.list().subscribe({ error: () => this.loadError.set(true) });
  }

  protected toggleSort(column: SortableColumn): void {
    if (this.sortBy() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected instrumentLabel(instrument: string): string {
    return INSTRUMENT_LABELS[instrument] ?? instrument;
  }

  protected alertTypeLabel(alertType: string): string {
    return ALERT_TYPE_LABELS[alertType] ?? alertType;
  }

  protected showCurrentRsi(instrument: string, alertType: string): boolean {
    return instrument === 'NASDAQ100' && alertType === 'RSI';
  }

  protected openEditDialog(alert: Alert): void {
    this.dialog.open(AlertForm, { width: '32rem', data: { alert } });
  }

  protected deleteAlert(alert: Alert): void {
    const data: DeleteAlertConfirmData = {
      instrument: this.instrumentLabel(alert.instrument),
      alertType: ALERT_TYPE_SHORT_LABELS[alert.alertType] ?? alert.alertType,
      threshold: alert.threshold.toFixed(2),
    };

    this.dialog
      .open(DeleteAlertConfirm, { data })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.alertsService.delete(alert.id).subscribe();
        }
      });
  }
}
