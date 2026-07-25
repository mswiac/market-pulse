import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';

export interface Instrument {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: number;
}

@Injectable({ providedIn: 'root' })
export class InstrumentsService {
  private readonly http = inject(HttpClient);

  private readonly _instruments = signal<Instrument[]>([]);
  readonly instruments = this._instruments.asReadonly();
  readonly types = computed(() => [...new Set(this._instruments().map((i) => i.type))]);

  private loaded = false;

  ensureLoaded(): Observable<Instrument[]> {
    if (this.loaded) return of(this._instruments());
    return this.http.get<Instrument[]>('/api/instruments').pipe(
      tap((instruments) => {
        this._instruments.set(instruments);
        this.loaded = true;
      }),
    );
  }
}
