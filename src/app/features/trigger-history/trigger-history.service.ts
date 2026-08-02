import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface TriggerEvent {
  id: number;
  ticker: string;
  instrumentName: string;
  currency: string | null;
  alertType: string;
  direction: string;
  threshold: number;
  valueAtTrigger: number;
  highAtTrigger: number | null;
  lowAtTrigger: number | null;
  emailStatus: 'sent' | 'failed';
  emailError: string | null;
  triggeredAt: number;
}

export interface TriggerEventsResponse {
  events: TriggerEvent[];
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class TriggerHistoryService {
  private readonly http = inject(HttpClient);

  // `limit` is deliberately omitted — the backend's default/clamp is the
  // single source of truth for page size (see plan.md Phase 2 Contract).
  list(offset: number): Observable<TriggerEventsResponse> {
    return this.http.get<TriggerEventsResponse>('/api/trigger-events', { params: { offset } });
  }
}
