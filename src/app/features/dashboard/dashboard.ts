import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { AuthService } from '../../core/auth/auth.service';
import { InstrumentPicker } from '../instruments/instrument-picker/instrument-picker';
import { InstrumentsService } from '../instruments/instruments.service';
import { filterLatest } from './dashboard-filter';
import { DashboardService, LatestInstrument } from './dashboard.service';

type SortableColumn = 'name' | 'date' | 'close' | 'high' | 'low' | 'rsi';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-dashboard',
  imports: [InstrumentPicker, MatTableModule, MatCardModule, MatButtonModule, MatIconModule, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly dashboardService = inject(DashboardService);
  private readonly instrumentsService = inject(InstrumentsService);

  protected readonly user = inject(AuthService).currentUser;
  protected readonly displayedColumns: SortableColumn[] = ['name', 'date', 'close', 'high', 'low', 'rsi'];

  protected readonly rows = signal<LatestInstrument[]>([]);
  protected readonly loadError = signal(false);

  protected readonly filterType = signal('');
  protected readonly filterTicker = signal('');
  protected readonly hasActiveFilters = computed(() => !!(this.filterType() || this.filterTicker()));

  protected readonly sortBy = signal<SortableColumn>('name');
  protected readonly sortDirection = signal<SortDirection>('asc');

  protected readonly sortedRows = computed(() => {
    const rows = filterLatest(this.rows(), { type: this.filterType(), ticker: this.filterTicker() });
    const sortBy = this.sortBy();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      // Missing values sort last in both directions.
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (typeof aValue === 'number' && typeof bValue === 'number') return direction * (aValue - bValue);
      return direction * String(aValue).localeCompare(String(bValue));
    });
  });

  constructor() {
    // A catalogue load failure only leaves the picker without options; the table still works.
    this.instrumentsService.ensureLoaded().subscribe({ error: () => undefined });
    this.dashboardService.getLatest().subscribe({
      next: (rows) => this.rows.set(rows),
      error: () => this.loadError.set(true),
    });
  }

  protected clearFilters(): void {
    this.filterType.set('');
    this.filterTicker.set('');
  }

  protected toggleSort(column: SortableColumn): void {
    if (this.sortBy() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(column);
      this.sortDirection.set('asc');
    }
  }
}
