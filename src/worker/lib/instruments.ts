export interface InstrumentRow {
  ticker: string;
  rsi_eligible: number;
  currency: string;
  suffix: string;
}

// Mirrors the CHECK constraint on instruments.type
// (migrations/0014_instrument_registry_extended_types.sql).
export const ALL_INSTRUMENT_TYPES = ['index', 'pl_stock', 'us_stock'];

// Scoped by the EXISTENCE of an alert row, not by `armed = 1`: a disarmed
// alert still needs fresh data to re-arm (see hasRetreatedPastMargin in
// alert-evaluation.ts), so filtering on `armed` would strand it permanently.
export async function selectAlertInstruments(db: D1Database, types: string[]): Promise<InstrumentRow[]> {
  if (types.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT ticker, rsi_eligible, suffix, currency FROM instruments
       WHERE type IN (${types.map(() => '?').join(', ')})
         AND EXISTS (SELECT 1 FROM alerts WHERE alerts.ticker = instruments.ticker)`,
    )
    .bind(...types)
    .all<InstrumentRow>();
  return results;
}
