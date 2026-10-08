export interface InstrumentRow {
  ticker: string;
  rsi_eligible: number;
  currency: string;
  suffix: string;
}

// Mirrors the CHECK constraint on instruments.type
// (migrations/0014_instrument_registry_extended_types.sql).
export const ALL_INSTRUMENT_TYPES = ['index', 'pl_stock', 'us_stock'];

// The one place that groups instrument types into markets; the cron fetch
// triggers and the admin per-market refresh both read it. `type` conflates
// market with instrument kind, so a Polish index would land in `other`.
export const MARKET_TYPES = {
  pl: ['pl_stock'],
  other: ['us_stock', 'index'],
} as const satisfies Record<string, readonly string[]>;
export type Market = keyof typeof MARKET_TYPES;

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

// Every instrument of the given types, alert or not: the manual admin refresh
// keeps the whole catalogue current, unlike the alert-scoped cron fetch.
export async function selectInstruments(db: D1Database, types: string[]): Promise<InstrumentRow[]> {
  if (types.length === 0) return [];
  const { results } = await db
    .prepare(`SELECT ticker, rsi_eligible, suffix, currency FROM instruments WHERE type IN (${types.map(() => '?').join(', ')})`)
    .bind(...types)
    .all<InstrumentRow>();
  return results;
}
