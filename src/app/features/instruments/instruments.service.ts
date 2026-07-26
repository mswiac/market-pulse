import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';

export interface Instrument {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: boolean;
}

@Injectable({ providedIn: 'root' })
export class InstrumentsService {
  private readonly http = inject(HttpClient);

  private readonly _instruments = signal<Instrument[]>([]);
  readonly instruments = this._instruments.asReadonly();
  readonly types = computed(() => [...new Set(this._instruments().map((i) => i.type))]);

  private loaded = false;
  // Dedupes concurrent callers (e.g. two dialogs opened back to back) onto a
  // single in-flight request instead of firing one GET each. Reset on error
  // so a transient failure doesn't permanently poison future attempts.
  private inFlight: Observable<Instrument[]> | null = null;

  ensureLoaded(): Observable<Instrument[]> {
    if (this.loaded) return of(this._instruments());
    if (!this.inFlight) {
      this.inFlight = this.http.get<Instrument[]>('/api/instruments').pipe(
        tap({
          next: (instruments) => {
            this._instruments.set(instruments);
            this.loaded = true;
          },
          error: () => {
            this.inFlight = null;
          },
        }),
        shareReplay(1),
      );
    }
    return this.inFlight;
  }
}
