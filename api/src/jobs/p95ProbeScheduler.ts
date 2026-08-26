import { db } from '../config';
import { recordMonitoredEndpointProbeSamples, refreshRecentP95Windows } from '../monitoring/p95';

const MARKETS = ['sg', 'us', 'my', 'vn', 'th'] as const;
// 2026-08-26 (Richmond): these probes run on EVERY api/mcp replica and were hard-coded at
// 30-60 s. catalog/stats alone forced a count(*) over 365M rows back-to-back on the search
// replica; together with the search samples they were the single largest load on it
// (pg_stat_statements: 672K rank queries, p95 12-29 s, zero-result timeouts for customers).
// Intervals are now env-tunable with conservative defaults; P95_PROBES_ENABLED=0 disables.
const envMs = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 10_000 ? v : fallback;
};
const HEALTH_INTERVAL_MS = envMs('P95_HEALTH_INTERVAL_MS', 300_000);
const CATALOG_STATS_INTERVAL_MS = envMs('P95_CATALOG_STATS_INTERVAL_MS', 3_600_000);
const MCP_LIST_CATEGORIES_INTERVAL_MS = envMs('P95_MCP_LIST_CATEGORIES_INTERVAL_MS', 900_000);
const ENDPOINT_SAMPLES_INTERVAL_MS = envMs('P95_ENDPOINT_SAMPLES_INTERVAL_MS', 900_000);
const WINDOW_REFRESH_INTERVAL_MS = envMs('P95_WINDOW_REFRESH_INTERVAL_MS', 300_000);
const PROBES_ENABLED = process.env.P95_PROBES_ENABLED !== '0';

const API_BASE_URL = process.env.BUYWHERE_API_BASE_URL
  || (process.env.RAILWAY_SERVICE_BUYWHERE_API_URL ? `https://${process.env.RAILWAY_SERVICE_BUYWHERE_API_URL}` : 'https://api.buywhere.ai');

const SYSTEM_API_KEY = process.env.BUYWHERE_SYSTEM_API_KEY || '';

let schedulerStarted = false;
let schedulerTimers: NodeJS.Timeout[] = [];

async function recordRawMeasurement(
  market: string,
  endpoint: string,
  responseTimeMs: number,
  statusCode: number
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO monitoring.p95_raw_measurements
         (market, endpoint, response_time_ms, status_code, measured_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [market, endpoint, responseTimeMs, statusCode]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[p95-probe] failed to record ${market}:${endpoint}: ${message}`);
  }
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<{ statusCode: number; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    try {
      await response.text();
    } catch {}
    return { statusCode: response.status, latencyMs: Date.now() - startedAt };
  } catch {
    return { statusCode: 0, latencyMs: Date.now() - startedAt };
  }
}

async function probeHealth(): Promise<void> {
  for (const market of MARKETS) {
    const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/health`);
    await recordRawMeasurement(market, '/health', latencyMs, statusCode);
  }
}

async function probeCatalogStats(): Promise<void> {
  const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/v1/catalog/stats`);
  await recordRawMeasurement('sg', '/v1/catalog/stats', latencyMs, statusCode);
}

async function probeMcpListCategories(): Promise<void> {
  if (!SYSTEM_API_KEY) {
    return;
  }

  const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${SYSTEM_API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'probe:list_categories',
      method: 'tools/call',
      params: { name: 'list_categories', arguments: {} },
    }),
  });

  await recordRawMeasurement('sg', 'mcp:list_categories', latencyMs, statusCode);
}

async function runProbeCycle(): Promise<void> {
  try {
    await Promise.allSettled([
      probeHealth(),
      probeCatalogStats(),
      probeMcpListCategories(),
      recordMonitoredEndpointProbeSamples(),
    ]);
    await refreshRecentP95Windows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[p95-probe] probe cycle failed: ${message}`);
  }
}

export function startP95ProbeScheduler(): void {
  if (schedulerStarted) {
    return;
  }
  if (!PROBES_ENABLED) {
    console.log('[p95-probe] disabled via P95_PROBES_ENABLED=0');
    return;
  }
  schedulerStarted = true;

  console.log(`[p95-probe] starting external probe scheduler against ${API_BASE_URL}`);

  const initialTimer = setTimeout(() => {
    void runProbeCycle();
  }, 5_000);
  if (initialTimer.unref) {
    initialTimer.unref();
  }

  // BUY-51454: every setInterval callback here awaits async work that touches the DB
  // pool. Even though the local `recordRawMeasurement` (above) wraps `db.query` in
  // try/catch, `recordMonitoredEndpointProbeSamples` is the imported p95.ts version which
  // can still throw (e.g. timedFetch rejection, or a future regression in the p95.ts
  // wrapper). Wrap each callback's promise in `.catch` so a single bad tick never becomes
  // an unhandledRejection. The top-level `process.on('unhandledRejection', ...)` guard in
  // index.ts is the last line of defense; the goal is to never reach it from this module.
  const swallow = (label: string) => (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[p95-probe] ${label} failed: ${message}`);
  };

  schedulerTimers = [
    setInterval(() => { void probeHealth().catch(swallow('probeHealth')); }, HEALTH_INTERVAL_MS),
    setInterval(() => { void probeCatalogStats().catch(swallow('probeCatalogStats')); }, CATALOG_STATS_INTERVAL_MS),
    setInterval(() => { void probeMcpListCategories().catch(swallow('probeMcpListCategories')); }, MCP_LIST_CATEGORIES_INTERVAL_MS),
    setInterval(() => { void recordMonitoredEndpointProbeSamples().catch(swallow('recordMonitoredEndpointProbeSamples')); }, ENDPOINT_SAMPLES_INTERVAL_MS),
    setInterval(() => { void refreshRecentP95Windows().catch(swallow('refreshRecentP95Windows')); }, WINDOW_REFRESH_INTERVAL_MS),
  ];

  for (const timer of schedulerTimers) {
    if (timer.unref) {
      timer.unref();
    }
  }
}

export function stopP95ProbeScheduler(): void {
  for (const timer of schedulerTimers) {
    clearInterval(timer);
  }
  schedulerTimers = [];
  schedulerStarted = false;
}
