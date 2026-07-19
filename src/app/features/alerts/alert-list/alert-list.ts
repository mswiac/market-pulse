import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { Alert, AlertsService } from '../alerts.service';

const INSTRUMENT_LABELS: Record<string, string> = {
  VIX: 'VIX',
  NASDAQ100: 'NASDAQ-100',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: 'Próg cenowy',
  RSI: 'Próg RSI',
};

type SortableColumn = 'instrument' | 'alertType' | 'threshold';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-alert-list',
  imports: [MatExpansionModule, MatIconModule, DatePipe, DecimalPipe],
  templateUrl: './alert-list.html',
  styleUrl: './alert-list.scss',
})
export class AlertList {
  private readonly alertsService = inject(AlertsService);

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
}
