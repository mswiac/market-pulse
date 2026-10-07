import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { InstrumentPicker } from '../instruments/instrument-picker/instrument-picker';
import { InstrumentsService } from '../instruments/instruments.service';
import { InstrumentHistoryEntry, InstrumentHistoryService } from './instrument-history.service';

const HISTORY_DAYS = 30;

@Component({
  selector: 'app-instrument-history',
  imports: [InstrumentPicker, MatTableModule, MatCardModule, DecimalPipe],
  templateUrl: './instrument-history.html',
  styleUrl: './instrument-history.scss',
})
export class InstrumentHistory {
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly instrumentHistoryService = inject(InstrumentHistoryService);

  protected readonly selectedTicker = signal('');
  // Endpoint returns oldest→newest (required for correct RSI smoothing order);
  // the table displays newest-first, so reverse purely for presentation.
  protected readonly history = signal<InstrumentHistoryEntry[]>([]);
  protected readonly sortedHistory = computed(() => [...this.history()].reverse());
  protected readonly rsiEligible = signal(false);
  protected readonly currency = signal('');
  protected readonly displayedColumns = computed(() =>
    this.rsiEligible() ? ['date', 'close', 'high', 'low', 'rsi'] : ['date', 'close', 'high', 'low'],
  );
  protected readonly showPartialNotice = computed(() => {
    const count = this.history().length;
    return count > 0 && count < HISTORY_DAYS;
  });

  protected readonly loadError = signal(false);
  protected readonly historyError = signal(false);

  constructor() {
    this.instrumentsService.ensureLoaded().subscribe({ error: () => this.loadError.set(true) });
  }

  protected onTickerChange(ticker: string): void {
    this.selectedTicker.set(ticker);
    this.historyError.set(false);

    if (!ticker) {
      this.history.set([]);
      return;
    }

    this.instrumentHistoryService.getHistory(ticker).subscribe({
      // Rapid switching can let responses arrive out of order — only apply
      // this one if its ticker is still the one currently selected.
      next: (response) => {
        if (this.selectedTicker() !== ticker) return;
        this.rsiEligible.set(response.rsiEligible);
        this.currency.set(response.currency);
        this.history.set(response.history);
      },
      error: () => {
        if (this.selectedTicker() !== ticker) return;
        this.historyError.set(true);
      },
    });
  }
}
