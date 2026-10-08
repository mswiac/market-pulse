import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface LatestInstrument {
  ticker: string;
  name: string;
  type: string;
  currency: string;
  rsiEligible: boolean;
  date: string | null;
  close: number | null;
  high: number | null;
  low: number | null;
  rsi: number | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getLatest(): Observable<LatestInstrument[]> {
    return this.http.get<LatestInstrument[]>('/api/instruments/latest');
  }
}
