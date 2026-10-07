import { Alert } from './alerts.service';

// '' means "no filter" for every field.
export interface AlertFilters {
  type: string;
  ticker: string;
  alertType: string;
}

// A chosen ticker is more specific than its type, so it takes precedence; the
// picker already drops a selection that contradicts the chosen type.
export function filterAlerts(alerts: Alert[], filters: AlertFilters): Alert[] {
  return alerts.filter((alert) => {
    if (filters.ticker) {
      if (alert.ticker !== filters.ticker) return false;
    } else if (filters.type && alert.instrumentType !== filters.type) {
      return false;
    }
    return !filters.alertType || alert.alertType === filters.alertType;
  });
}
