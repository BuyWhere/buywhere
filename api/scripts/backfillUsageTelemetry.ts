/**
 * BUY-22733: backfill PostHog with the last N days of api_query + mcp_tool_call events
 * from the query_log table. Each event is timestamped at its original created_at, so
 * PostHog dashboards show real historical volume instead of starting from zero on the
 * day the new instrumentation shipped.
 *
 * Events are marked `backfilled: true` so dashboard authors can exclude them when
 * sanity-checking forward telemetry.
 *
 * Usage:
 *   DATABASE_URL=postgres://... POSTHOG_API_KEY=phc_... npx ts-node scripts/backfillUsageTelemetry.ts [--days 30] [--dry-run]
 */

import { db, redis } from '../src/config';
import { trackApiUsage, shutdownPostHog } from '../src/analytics/posthog';

interface Row {
  api_key_id: string;
  endpoint: string;
  status_code: number;
  response_time_ms: number;
  created_at: Date;
  tier: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='))?.split('=')[1]
    ?? (args.includes('--days') ? args[args.indexOf('--days') + 1] : null);
  const days = Math.min(Math.max(parseInt(daysArg || '30', 10), 1), 365);
  const dryRun = args.includes('--dry-run');

  console.log(`[backfill] window=${days}d dry_run=${dryRun}`);

  const totalQ = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM query_log q
     WHERE q.created_at >= NOW() - ($1 || ' days')::interval
       AND q.api_key_id IS NOT NULL`,
    [days]
  );
  console.log(`[backfill] candidate rows=${totalQ.rows[0].n}`);

  if (dryRun) {
    const sample = await db.query(
      `SELECT q.api_key_id, q.endpoint, q.status_code, q.response_time_ms,
              q.created_at, k.tier
       FROM query_log q
       LEFT JOIN api_keys k ON k.id = q.api_key_id
       WHERE q.created_at >= NOW() - ($1 || ' days')::interval
         AND q.api_key_id IS NOT NULL
       ORDER BY q.created_at DESC
       LIMIT 5`,
      [days]
    );
    console.log('[backfill] sample rows:');
    for (const r of sample.rows) console.log('  ', r);
    await shutdownPostHog();
    await db.end();
    await redis.quit().catch(() => {});
    return;
  }

  // Stream in batches so large windows don't blow memory on the API box.
  const BATCH = 5000;
  let offset = 0;
  let emitted = 0;

  while (true) {
    const batch = await db.query<Row>(
      `SELECT q.api_key_id, q.endpoint, q.status_code, q.response_time_ms,
              q.created_at, COALESCE(k.tier, 'unknown') AS tier
       FROM query_log q
       LEFT JOIN api_keys k ON k.id = q.api_key_id
       WHERE q.created_at >= NOW() - ($1 || ' days')::interval
         AND q.api_key_id IS NOT NULL
       ORDER BY q.created_at ASC
       LIMIT $2 OFFSET $3`,
      [days, BATCH, offset]
    );

    if (batch.rows.length === 0) break;

    for (const r of batch.rows) {
      // Schema doesn't record the JSON-RPC method per row, so endpoint='mcp'
      // is taken as a tool call (initialize/tools/list bypass auth and aren't
      // logged). Tool name is unknown for historical rows.
      const toolName = r.endpoint === 'mcp' ? 'unknown' : null;
      trackApiUsage({
        apiKeyId: r.api_key_id,
        endpoint: r.endpoint,
        method: r.endpoint === 'mcp' ? 'POST' : 'GET',
        tier: r.tier || 'unknown',
        resultStatus: r.status_code,
        latencyMs: r.response_time_ms,
        toolName,
        timestamp: r.created_at,
        backfilled: true,
      });
      emitted++;
    }
    offset += batch.rows.length;
    console.log(`[backfill] emitted=${emitted} (offset=${offset})`);
  }

  console.log(`[backfill] done — flushing PostHog…`);
  await shutdownPostHog();
  await db.end();
  await redis.quit().catch(() => {});
  console.log(`[backfill] complete — total events emitted=${emitted}`);
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
