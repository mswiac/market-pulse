import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TriggerEvent, TriggerHistoryService } from './trigger-history.service';

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: $localize`:@@triggerHistory.type.price:Price threshold`,
  RSI: $localize`:@@triggerHistory.type.rsi:RSI threshold`,
};

const DISPLAYED_COLUMNS = ['triggeredAt', 'instrumentName', 'alertType', 'direction', 'threshold', 'valueAtTrigger', 'emailStatus'];

@Component({
  selector: 'app-trigger-history',
  imports: [MatTableModule, MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, DatePipe, DecimalPipe],
  templateUrl: './trigger-history.html',
  styleUrl: './trigger-history.scss',
})
export class TriggerHistory {
  private readonly triggerHistoryService = inject(TriggerHistoryService);

  protected readonly displayedColumns = DISPLAYED_COLUMNS;
  protected readonly events = signal<TriggerEvent[]>([]);
  protected readonly hasMore = signal(false);
  protected readonly loadError = signal(false);
  protected readonly loadMoreError = signal(false);

  constructor() {
    this.triggerHistoryService.list(0).subscribe({
      next: (response) => {
        this.events.set(response.events);
        this.hasMore.set(response.hasMore);
      },
      error: () => this.loadError.set(true),
    });
  }

  protected loadMore(): void {
    this.loadMoreError.set(false);
    // Next page starts where the accumulated list currently ends.
    this.triggerHistoryService.list(this.events().length).subscribe({
      next: (response) => {
        this.events.update((events) => [...events, ...response.events]);
        this.hasMore.set(response.hasMore);
      },
      error: () => this.loadMoreError.set(true),
    });
  }

  protected alertTypeLabel(alertType: string): string {
    return ALERT_TYPE_LABELS[alertType] ?? alertType;
  }

  protected showCurrency(alertType: string): boolean {
    return alertType !== 'RSI';
  }
}
