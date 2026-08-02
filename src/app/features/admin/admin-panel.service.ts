import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface MarketDataFetchResult {
  ticker: string;
  from: string;
  to: string;
  daysWritten: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  fetchMarketData(ticker: string, from: string, to: string): Observable<MarketDataFetchResult> {
    return this.http.post<MarketDataFetchResult>('/api/admin/market-data', { ticker, from, to });
  }
}
