import type { Env } from './index';
import { evaluateAlerts, type AlertEvaluationSummary } from './lib/alert-evaluation';
import { ALL_INSTRUMENT_TYPES, selectAlertInstruments, type InstrumentRow } from './lib/instruments';
import { refreshInstruments, type FetchPhaseResult, type TickerResult } from './lib/market-refresh';

export interface CronRunSummary {
  tickers: TickerResult[];
  alertsEvaluated: number;
  emails: AlertEvaluationSummary['emails'];
  errors: string[];
}

export async function runFetchPhase(env: Env, types: string[] = ALL_INSTRUMENT_TYPES): Promise<FetchPhaseResult> {
  let instruments: InstrumentRow[];
  try {
    instruments = await selectAlertInstruments(env.DB, types);
  } catch (err) {
    console.error('market-data-pipeline: failed to load instruments registry', err);
    return { tickers: [], loadError: String(err) };
  }

  return refreshInstruments(env, instruments);
}

// Must match the `crons` entries in wrangler.toml. Each fetch trigger gets its
// own subrequest budget and owns a set of instrument types. The UTC times are
// fixed on purpose: each falls after the local market close in both DST
// states (GPW closes 17:00 Warsaw time, US markets 16:00 ET), so no timezone
// handling is needed. Evaluation runs once, a few minutes after the last
// fetch, in its own invocation; Cloudflare gives no ordering guarantee between
// invocations, which is why evaluateAlerts checks market_data freshness itself.
export const PL_FETCH_CRON = '30 16 * * 1-5';
export const US_FETCH_CRON = '0 23 * * 1-5';
export const EVALUATE_CRON = '15 23 * * 1-5';

export const FETCH_CRON_TYPES: Record<string, string[]> = {
  [PL_FETCH_CRON]: ['pl_stock'],
  [US_FETCH_CRON]: ['us_stock', 'index'],
};

export async function handleCron(cron: string, env: Env): Promise<void> {
  const fetchTypes = FETCH_CRON_TYPES[cron];
  if (fetchTypes) {
    await runFetchPhase(env, fetchTypes);
  } else if (cron === EVALUATE_CRON) {
    await evaluateAlerts(env);
  } else {
    console.error(`scheduled: no handler for cron expression "${cron}"`);
  }
}

// Manual full run (admin "Force data refresh"): both phases back to back.
export async function handleScheduled(env: Env): Promise<CronRunSummary> {
  const { tickers, loadError } = await runFetchPhase(env);
  if (loadError) {
    return { tickers: [], alertsEvaluated: 0, emails: [], errors: [loadError] };
  }

  const alertSummary = await evaluateAlerts(env);

  return {
    tickers,
    alertsEvaluated: alertSummary.alertsEvaluated,
    emails: alertSummary.emails,
    errors: alertSummary.errors,
  };
}
