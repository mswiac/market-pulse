import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface MarketDataFetchResult {
  ticker: string;
  from: string;
  to: string;
  daysWritten: number;
}

export interface CreatedInstrument {
  ticker: string;
  name: string;
  type: string;
  rsiEligible: boolean;
  provider: string;
  currency: string;
  suffix: string;
}

export interface InstrumentImpact {
  ticker: string;
  alertsCount: number;
}

export interface RemovedInstrument {
  ticker: string;
  alertsDeleted: number;
}

export interface AdminUser {
  id: number;
  email: string;
}

export interface UserImpact {
  id: number;
  email: string;
  alertsCount: number;
  triggerEventsCount: number;
}

export interface RemovedUser {
  id: number;
  email: string;
  alertsDeleted: number;
  triggerEventsDeleted: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  fetchMarketData(ticker: string, from: string, to: string): Observable<MarketDataFetchResult> {
    return this.http.post<MarketDataFetchResult>('/api/admin/market-data', { ticker, from, to });
  }

  addInstrument(
    type: string,
    ticker: string,
    name: string,
    currency: string,
    rsiEligible: boolean,
    suffix: string,
  ): Observable<CreatedInstrument> {
    return this.http.post<CreatedInstrument>('/api/admin/instruments', { type, ticker, name, currency, rsiEligible, suffix });
  }

  getInstrumentImpact(ticker: string): Observable<InstrumentImpact> {
    return this.http.get<InstrumentImpact>(`/api/admin/instruments/${encodeURIComponent(ticker)}/impact`);
  }

  removeInstrument(ticker: string): Observable<RemovedInstrument> {
    return this.http.delete<RemovedInstrument>(`/api/admin/instruments/${encodeURIComponent(ticker)}`);
  }

  listUsers(): Observable<AdminUser[]> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users').pipe(map((response) => response.users));
  }

  getUserImpact(id: number): Observable<UserImpact> {
    return this.http.get<UserImpact>(`/api/admin/users/${id}/impact`);
  }

  removeUser(id: number): Observable<RemovedUser> {
    return this.http.delete<RemovedUser>(`/api/admin/users/${id}`);
  }
}
