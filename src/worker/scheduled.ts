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

// Must match the `crons` entries in wrangler.toml. Evaluation runs a few
// minutes after the fetch, in its own invocation with its own subrequest
// budget; Cloudflare gives no ordering guarantee between the two, which is
// why evaluateAlerts checks market_data freshness itself.
export const FETCH_CRON = '0 23 * * 1-5';
export const EVALUATE_CRON = '15 23 * * 1-5';

export async function handleCron(cron: string, env: Env): Promise<void> {
  if (cron === FETCH_CRON) {
    await runFetchPhase(env);
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
