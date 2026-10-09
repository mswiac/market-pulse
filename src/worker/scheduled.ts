import type { Env } from './index';
import { evaluateAlerts, type AlertEvaluationSummary } from './lib/alert-evaluation';
import { notifyCronFailure } from './lib/cron-failure-notice';
import { ALL_INSTRUMENT_TYPES, MARKET_TYPES, selectAlertInstruments, selectInstruments, type InstrumentRow } from './lib/instruments';
import { refreshInstruments, type FetchPhaseResult, type TickerResult } from './lib/market-refresh';

export interface CronRunSummary {
  tickers: TickerResult[];
  alertsEvaluated: number;
  emails: AlertEvaluationSummary['emails'];
  errors: string[];
}

// `alerts` (cron) refreshes only instruments that have an alert; `all` (manual
// admin refresh) refreshes the whole catalogue of the given types.
export async function runFetchPhase(
  env: Env,
  types: string[] = ALL_INSTRUMENT_TYPES,
  scope: 'alerts' | 'all' = 'alerts',
): Promise<FetchPhaseResult> {
  let instruments: InstrumentRow[];
  try {
    instruments = scope === 'all' ? await selectInstruments(env.DB, types) : await selectAlertInstruments(env.DB, types);
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
  [PL_FETCH_CRON]: [...MARKET_TYPES.pl],
  [US_FETCH_CRON]: [...MARKET_TYPES.other],
};

const FETCH_PHASE_LABELS: Record<string, string> = {
  [PL_FETCH_CRON]: 'GPW fetch',
  [US_FETCH_CRON]: 'US fetch',
};

function fetchProblems({ tickers, loadError }: FetchPhaseResult): string[] {
  return [
    ...(loadError ? [`failed to load instruments: ${loadError}`] : []),
    ...tickers.filter((t) => t.status === 'error').map((t) => `${t.ticker}: ${t.error}`),
  ];
}

function evaluationProblems({ errors, emails }: AlertEvaluationSummary): string[] {
  return [
    ...errors,
    ...emails.filter((e) => e.status === 'failed').map((e) => `alert ${e.alertId} ${e.ticker}: email failed: ${e.error}`),
  ];
}

// Runs one phase and emails the admin about its problems. An unexpected
// exception is reported too and then rethrown, so Cloudflare still records
// the invocation as failed.
async function runAndReport<T>(env: Env, phase: string, run: () => Promise<T>, problemsOf: (result: T) => string[]): Promise<void> {
  let result: T;
  try {
    result = await run();
  } catch (err) {
    await notifyCronFailure(env, phase, [`unexpected error: ${err instanceof Error ? err.message : String(err)}`]);
    throw err;
  }
  await notifyCronFailure(env, phase, problemsOf(result));
}

export async function handleCron(cron: string, env: Env): Promise<void> {
  const fetchTypes = FETCH_CRON_TYPES[cron];
  if (fetchTypes) {
    await runAndReport(env, FETCH_PHASE_LABELS[cron], () => runFetchPhase(env, fetchTypes), fetchProblems);
  } else if (cron === EVALUATE_CRON) {
    await runAndReport(env, 'alert evaluation', () => evaluateAlerts(env), evaluationProblems);
  } else {
    console.error(`scheduled: no handler for cron expression "${cron}"`);
  }
}
