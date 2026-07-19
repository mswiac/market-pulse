import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

export interface Alert {
  id: number;
  instrument: string;
  alertType: string;
  threshold: number;
  notificationEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAlertPayload {
  instrument: string;
  alertType: string;
  threshold: number;
  notificationEmail: string;
}

@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly http = inject(HttpClient);

  private readonly _alerts = signal<Alert[]>([]);
  readonly alerts = this._alerts.asReadonly();

  list(): Observable<Alert[]> {
    return this.http.get<Alert[]>('/api/alerts').pipe(tap((alerts) => this._alerts.set(alerts)));
  }

  create(payload: CreateAlertPayload): Observable<Alert> {
    return this.http
      .post<Alert>('/api/alerts', payload)
      .pipe(tap((created) => this._alerts.update((alerts) => [created, ...alerts])));
  }
}
