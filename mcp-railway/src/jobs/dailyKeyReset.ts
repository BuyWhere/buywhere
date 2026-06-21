import { db } from '../config';

export interface ResetSummary {
  ran_at: Date;
  keys_reset: number;
}

export async function runDailyKeyReset(): Promise<ResetSummary> {
  const ranAt = new Date();

  const result = await db.query(
    `UPDATE api_keys
     SET daily_request_count = 0,
         daily_reset_at = $1
     WHERE daily_reset_at <= $1
     RETURNING id`,
    [ranAt]
  );

  const keysReset = result.rowCount ?? 0;
  console.log(`[daily-key-reset] Reset ${keysReset} API key(s) at ${ranAt.toISOString()}`);

  return { ran_at: ranAt, keys_reset: keysReset };
}
