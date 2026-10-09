import type { Env } from '../index';
import { sendAlertEmailBatch } from './resend';

const MAX_LISTED_PROBLEMS = 20;

// Never throws: a failed notice must not change the outcome of the cron run
// it reports on, so every error here is logged and dropped.
export async function notifyCronFailure(env: Env, phase: string, problems: string[]): Promise<void> {
  if (problems.length === 0) return;

  try {
    const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
    const omitted = problems.length - listed.length;
    const lines = [...listed, ...(omitted > 0 ? [`... and ${omitted} more`] : [])];
    // The date keeps the subject (and so Resend's payload-derived
    // idempotency key) different from day to day: an identical failure on
    // consecutive days would otherwise be deduplicated and never delivered.
    const date = new Date().toISOString().slice(0, 10);

    const [result] = await sendAlertEmailBatch(env, [
      {
        to: env.RESEND_VERIFIED_EMAIL,
        subject: `MarketPulse: ${phase} had problems (${date})`,
        text: `${phase} reported ${problems.length} problem(s):\n\n${lines.join('\n')}\n`,
      },
    ]);
    if (!result.ok) console.error(`cron-failure-notice: failed to send notice for ${phase}: ${result.error}`);
  } catch (err) {
    console.error(`cron-failure-notice: failed to send notice for ${phase}`, err);
  }
}
