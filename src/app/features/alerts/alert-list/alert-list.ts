import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { AlertsService } from '../alerts.service';

const INSTRUMENT_LABELS: Record<string, string> = {
  VIX: 'VIX',
  NASDAQ100: 'NASDAQ-100',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  PRICE: 'Cena',
  RSI: 'RSI',
};

@Component({
  selector: 'app-alert-list',
  imports: [MatExpansionModule, DatePipe],
  templateUrl: './alert-list.html',
  styleUrl: './alert-list.scss',
})
export class AlertList {
  private readonly alertsService = inject(AlertsService);

  protected readonly alerts = this.alertsService.alerts;

  constructor() {
    this.alertsService.list().subscribe();
  }

  protected instrumentLabel(instrument: string): string {
    return INSTRUMENT_LABELS[instrument] ?? instrument;
  }

  protected alertTypeLabel(alertType: string): string {
    return ALERT_TYPE_LABELS[alertType] ?? alertType;
  }

  protected showCurrentRsi(instrument: string, alertType: string): boolean {
    return instrument === 'NASDAQ100' && alertType === 'RSI';
  }
}
