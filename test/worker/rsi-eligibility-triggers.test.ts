import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// Proves the DB-level enforcement added by migration 0009 actually fires by
// writing directly via env.DB, bypassing alerts.ts's validateAlertInput entirely.
async function seedUser(email: string): Promise<number> {
  const result = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .bind(email, 'irrelevant-hash')
    .run();
  return result.meta.last_row_id as number;
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM alerts'), env.DB.prepare('DELETE FROM market_data')]);
});

describe('alerts RSI-eligibility triggers', () => {
  it('blocks a direct INSERT of an RSI alert for a non-RSI-eligible ticker (^VIX)', async () => {
    const userId = await seedUser('trigger-alerts-insert@example.com');
    await expect(
      env.DB.prepare(
        'INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(userId, '^VIX', 'RSI', 70, 'alerts@example.com')
        .run(),
    ).rejects.toThrow();
  });

  it('blocks a direct UPDATE that sets alert_type to RSI for a non-RSI-eligible ticker (^VIX)', async () => {
    const userId = await seedUser('trigger-alerts-update@example.com');
    const insertResult = await env.DB.prepare(
      'INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(userId, '^VIX', 'PRICE', 20, 'alerts@example.com')
      .run();

    await expect(
      env.DB.prepare('UPDATE alerts SET alert_type = ? WHERE id = ?')
        .bind('RSI', insertResult.meta.last_row_id)
        .run(),
    ).rejects.toThrow();
  });

  it('allows a valid RSI alert insert for an RSI-eligible ticker (^NDX)', async () => {
    const userId = await seedUser('trigger-alerts-valid@example.com');
    await expect(
      env.DB.prepare(
        'INSERT INTO alerts (user_id, ticker, alert_type, threshold, notification_email) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(userId, '^NDX', 'RSI', 70, 'alerts@example.com')
        .run(),
    ).resolves.toBeDefined();
  });
});

describe('market_data RSI-eligibility triggers', () => {
  it('blocks a direct INSERT with a non-null rsi for a non-RSI-eligible ticker (^VIX)', async () => {
    await expect(
      env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
        .bind('^VIX', 18.5, 55)
        .run(),
    ).rejects.toThrow();
  });

  it('blocks a direct UPDATE that sets a non-null rsi for a non-RSI-eligible ticker (^VIX)', async () => {
    await env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
      .bind('^VIX', 18.5, null)
      .run();

    await expect(env.DB.prepare('UPDATE market_data SET rsi = ? WHERE ticker = ?').bind(55, '^VIX').run()).rejects.toThrow();
  });

  it('allows a valid market_data insert with rsi for an RSI-eligible ticker (^NDX)', async () => {
    await expect(
      env.DB.prepare('INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())')
        .bind('^NDX', 4500, 62.5)
        .run(),
    ).resolves.toBeDefined();
  });

  // Mirrors the exact upsert shape scheduled.ts uses in production, on both
  // the no-conflict (first write) and conflict (subsequent write) paths.
  const UPSERT_SQL = `INSERT INTO market_data (ticker, price, rsi, updated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, rsi = excluded.rsi, updated_at = excluded.updated_at`;

  it('blocks the production upsert shape on the no-conflict path for a non-RSI-eligible ticker (^VIX)', async () => {
    await expect(env.DB.prepare(UPSERT_SQL).bind('^VIX', 18.5, 55).run()).rejects.toThrow();
  });

  it('blocks the production upsert shape on the conflict path for a non-RSI-eligible ticker (^VIX)', async () => {
    await env.DB.prepare(UPSERT_SQL).bind('^VIX', 18.5, null).run();

    await expect(env.DB.prepare(UPSERT_SQL).bind('^VIX', 19.0, 55).run()).rejects.toThrow();
  });
});
