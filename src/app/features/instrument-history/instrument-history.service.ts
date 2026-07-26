import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface InstrumentHistoryEntry {
  date: string;
  close: number;
  rsi: number | null;
}

export interface InstrumentHistoryResponse {
  ticker: string;
  rsiEligible: boolean;
  history: InstrumentHistoryEntry[];
}

@Injectable({ providedIn: 'root' })
export class InstrumentHistoryService {
  private readonly http = inject(HttpClient);

  getHistory(ticker: string): Observable<InstrumentHistoryResponse> {
    return this.http.get<InstrumentHistoryResponse>(`/api/instruments/${encodeURIComponent(ticker)}/history`);
  }
}
