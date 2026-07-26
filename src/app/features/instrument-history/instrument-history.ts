import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Instrument, InstrumentsService } from '../instruments/instruments.service';
import { InstrumentHistoryEntry, InstrumentHistoryService } from './instrument-history.service';

const HISTORY_DAYS = 30;

const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  index: $localize`:@@instrumentHistory.instrumentType.index:Index`,
};

@Component({
  selector: 'app-instrument-history',
  imports: [MatFormFieldModule, MatSelectModule, MatTableModule, MatCardModule, DecimalPipe],
  templateUrl: './instrument-history.html',
  styleUrl: './instrument-history.scss',
})
export class InstrumentHistory {
  private readonly instrumentsService = inject(InstrumentsService);
  private readonly instrumentHistoryService = inject(InstrumentHistoryService);

  // Sorted alphabetically by what's actually shown to the user — the type's
  // display label, and each instrument's name — not raw insertion order.
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
  // Endpoint returns oldest→newest (required for correct RSI smoothing order);
  // the table displays newest-first, so reverse purely for presentation.
  protected readonly history = signal<InstrumentHistoryEntry[]>([]);
  protected readonly sortedHistory = computed(() => [...this.history()].reverse());
  protected readonly rsiEligible = signal(false);
  protected readonly displayedColumns = computed(() => (this.rsiEligible() ? ['date', 'close', 'rsi'] : ['date', 'close']));
  protected readonly showPartialNotice = computed(() => {
    const count = this.history().length;
    return count > 0 && count < HISTORY_DAYS;
  });

  protected readonly loadError = signal(false);
  protected readonly historyError = signal(false);

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
    if (firstMatch) {
      this.onTickerChange(firstMatch.ticker);
    } else {
      this.selectedTicker.set('');
      this.history.set([]);
      this.historyError.set(false);
    }
  }

  protected onTickerChange(ticker: string): void {
    this.selectedTicker.set(ticker);
    this.historyError.set(false);

    this.instrumentHistoryService.getHistory(ticker).subscribe({
      // Rapid switching can let responses arrive out of order — only apply
      // this one if its ticker is still the one currently selected.
      next: (response) => {
        if (this.selectedTicker() !== ticker) return;
        this.rsiEligible.set(response.rsiEligible);
        this.history.set(response.history);
      },
      error: () => {
        if (this.selectedTicker() !== ticker) return;
        this.historyError.set(true);
      },
    });
  }
}
