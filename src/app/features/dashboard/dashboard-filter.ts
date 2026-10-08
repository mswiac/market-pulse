import { LatestInstrument } from './dashboard.service';

// '' means "no filter" for every field.
export interface DashboardFilters {
  type: string;
  ticker: string;
}

// A chosen ticker is more specific than its type, so it takes precedence; the
// picker already drops a selection that contradicts the chosen type.
export function filterLatest(rows: LatestInstrument[], filters: DashboardFilters): LatestInstrument[] {
  return rows.filter((row) => {
    if (filters.ticker) return row.ticker === filters.ticker;
    return !filters.type || row.type === filters.type;
  });
}
