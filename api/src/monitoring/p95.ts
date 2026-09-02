import { db } from '../config';
import { Request, Response, NextFunction } from 'express';

export const VALID_MARKETS = ['sg', 'us', 'my', 'vn', 'th'] as const;
export const P95_THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
export const INTERNAL_P95_PROBE_HEADER = 'x-buywhere-internal-p95-probe';

const AGGREGATION_WINDOW_MINUTES = 5;
const AGGREGATION_LOOKBACK_WINDOWS = 3;
const FRESHNESS_GRACE_MINUTES = 15;
const REQUEST_TIMEOUT_MS = 10_000;
const MONITORED_ENDPOINT = '/api/monitoring/p95';
const API_BASE_URL = process.env.BUYWHERE_API_BASE_URL
  || (process.env.RAILWAY_SERVICE_BUYWHERE_API_URL ? `https://${process.env.RAILWAY_SERVICE_BUYWHERE_API_URL}` : 'https://api.buywhere.ai');
const SYSTEM_API_KEY = process.env.BUYWHERE_SYSTEM_API_KEY || '';

let freshnessRecoveryPromise: Promise<void> | null = null;

// BUY-46193: the read/reporting endpoints (/api/monitoring/p95, /p95/all, /p95/history)
// must never run the heavy freshness work (window aggregation + nested HTTP probe
// recovery) on the request path. That work routinely took >5s and, under stale data or
// load, blew past the 10s hard route timeout — the socket was destroyed and Railway
// returned 502 "Application failed to respond", which in turn self-blocked the P95
// monitoring routine. Reads now serve last-known data from the DB (and the 30s cache)
// immediately, while freshness is refreshed in the background for the next request.
let backgroundFreshnessPromise: Promise<void> | null = null;

function triggerBackgroundFreshness(market?: string): void {
  if (backgroundFreshnessPromise) {
    return;
  }
  backgroundFreshnessPromise = (async () => {
    try {
      await ensureFreshP95Data(market);
    } catch (error) {
      console.error('[P95] Background freshness refresh failed:', error);
    } finally {
      backgroundFreshnessPromise = null;
    }
  })();
}

interface P95QueryOptions {
  skipFreshness?: boolean;
}

export interface P95LatencyRecord {
  id: number;
  market: string;
  endpoint: string;
  p95_ms: number;
  sample_size: number;
  window_start: Date;
  window_end: Date;
  created_at: Date;
}

export interface AlertRecord {
  id: number;
  market: string;
  p95_ms: number;
  threshold_ms: number;
  kind: string;
  triggered_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolution_notes: string | null;
}

export interface AlertHistoryOptions {
  market?: string | null;
  kind?: string | null;
  limit?: number;
}

export interface LatestP95MarketSummary {
  endpoint: string;
  p95_ms: number;
  sample_size: number;
  window_start: Date | null;
  window_end: Date | null;
  alert_triggered: boolean;
  baseline_ms: number;
  threshold_ms: number;
}

export function isValidMarket(market: string): market is typeof VALID_MARKETS[number] {
  return VALID_MARKETS.includes(market as any);
}

export function calculateP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;
  return Math.round(sorted[p95Index]);
}

function parseTimestampMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value instanceof Date ? value.toISOString() : value);
  return Number.isFinite(millis) ? millis : null;
}

function isWindowFresh(
  windowEnd: Date | string | null | undefined,
  nowMillis = Date.now(),
  maxAgeMinutes = FRESHNESS_GRACE_MINUTES
): boolean {
  const parsedMillis = parseTimestampMillis(windowEnd);
  if (parsedMillis === null) {
    return false;
  }

  return (nowMillis - parsedMillis) <= (maxAgeMinutes * 60 * 1000);
}

async function queryLatestWindowEnd(market?: string): Promise<Date | null> {
  if (market) {
    const result = await db.query(
      `SELECT MAX(window_end) AS window_end
       FROM monitoring.p95_latency
       WHERE market = $1
         AND endpoint = $2`,
      [market, MONITORED_ENDPOINT]
    );
    return result.rows[0]?.window_end || null;
  }

  const result = await db.query(
    `SELECT MAX(window_end) AS window_end
     FROM monitoring.p95_latency
     WHERE endpoint = $1`,
    [MONITORED_ENDPOINT]
  );
  return result.rows[0]?.window_end || null;
}

async function recordRawMeasurement(
  market: string,
  endpoint: string,
  responseTimeMs: number,
  statusCode: number
): Promise<void> {
  // BUY-51454: a single transient DB blip (ECONNREFUSED, pool timeout, statement_timeout)
  // must not become an unhandledRejection that takes down the whole process. Swallow and log;
  // the probe scheduler's own wrapper (p95ProbeScheduler.recordRawMeasurement) will still
  // surface the per-market failure for ops visibility.
  try {
    await db.query(
      `INSERT INTO monitoring.p95_raw_measurements
         (market, endpoint, response_time_ms, status_code, measured_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [market, endpoint, responseTimeMs, statusCode]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[p95-probe] recordRawMeasurement failed for ${market}:${endpoint}: ${message}`);
  }
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<{ statusCode: number; latencyMs: number }> {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  for (const market of VALID_MARKETS) {
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

function buildInternalMonitoringProbeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    [INTERNAL_P95_PROBE_HEADER]: '1',
  };

  const monitoringApiKey = process.env.MONITORING_API_KEY;
  if (monitoringApiKey) {
    headers.Authorization = `Bearer ${monitoringApiKey}`;
  }

  return headers;
}

export async function recordMonitoredEndpointProbeSamples(
  markets: readonly (typeof VALID_MARKETS[number])[] = VALID_MARKETS
): Promise<void> {
  const headers = buildInternalMonitoringProbeHeaders();

  for (const market of markets) {
    const { statusCode, latencyMs } = await timedFetch(
      `${API_BASE_URL}${MONITORED_ENDPOINT}?market=${encodeURIComponent(market)}`,
      { headers }
    );
    await recordRawMeasurement(market, MONITORED_ENDPOINT, latencyMs, statusCode);
  }
}

async function runFreshnessRecovery(): Promise<void> {
  await Promise.allSettled([
    probeHealth(),
    probeCatalogStats(),
    probeMcpListCategories(),
    recordMonitoredEndpointProbeSamples(),
  ]);

  await refreshRecentP95Windows();
}

async function ensureFreshP95Data(market?: string): Promise<void> {
  await refreshRecentP95Windows();

  const latestWindowEnd = await queryLatestWindowEnd(market);
  if (isWindowFresh(latestWindowEnd)) {
    return;
  }

  if (!freshnessRecoveryPromise) {
    freshnessRecoveryPromise = (async () => {
      try {
        await runFreshnessRecovery();
      } finally {
        freshnessRecoveryPromise = null;
      }
    })();
  }

  await freshnessRecoveryPromise;
}

export async function getP95Latency(
  market: string,
  limit = 100,
  options: P95QueryOptions = {}
): Promise<P95LatencyRecord[]> {
  if (!options.skipFreshness) {
    triggerBackgroundFreshness(market);
  }

  const result = await db.query(
    `SELECT * FROM monitoring.p95_latency
     WHERE market = $1
       AND endpoint = $2
     ORDER BY window_end DESC
     LIMIT $3`,
    [market, MONITORED_ENDPOINT, limit]
  );
  return result.rows;
}

export async function getLatestP95ForMarket(
  market: string,
  options: P95QueryOptions = {}
): Promise<P95LatencyRecord | null> {
  if (!options.skipFreshness) {
    triggerBackgroundFreshness(market);
  }

  const result = await db.query(
    `SELECT * FROM monitoring.p95_latency
     WHERE market = $1
       AND endpoint = $2
     ORDER BY window_end DESC
     LIMIT 1`,
    [market, MONITORED_ENDPOINT]
  );
  return result.rows[0] || null;
}

// In-memory cache for getAllLatestP95 to prevent repeated expensive aggregation/probe runs.
// Cache is shared across all callers; keyed on options (freshness check is the only variant that matters).
const P95_ALL_CACHE_TTL_MS = 30_000; // 30-second cache window
let p95AllCache: { data: Record<string, LatestP95MarketSummary>; expiresAt: number } | null = null;

export async function getAllLatestP95(
  options: P95QueryOptions = {}
): Promise<Record<string, LatestP95MarketSummary>> {
  // Only cache when freshness checks are enabled (skipFreshness=false, the default).
  if (!options.skipFreshness && p95AllCache && Date.now() < p95AllCache.expiresAt) {
    return p95AllCache.data;
  }

  if (!options.skipFreshness) {
    triggerBackgroundFreshness();
  }

  const result = await db.query(
    `SELECT DISTINCT ON (market) market, endpoint, p95_ms, sample_size, window_start, window_end
     FROM monitoring.p95_latency
     WHERE endpoint = $1
     ORDER BY market, window_end DESC`,
    [MONITORED_ENDPOINT]
  );

  const markets: Record<string, LatestP95MarketSummary> = {};
  for (const row of result.rows) {
    markets[row.market] = {
      endpoint: row.endpoint,
      p95_ms: row.p95_ms,
      sample_size: row.sample_size,
      window_start: row.window_start,
      window_end: row.window_end,
      alert_triggered: row.p95_ms > P95_THRESHOLD_MS,
      baseline_ms: row.market === 'sg' ? 160 : 0,
      threshold_ms: P95_THRESHOLD_MS,
    };
  }

  for (const market of VALID_MARKETS) {
    if (!markets[market]) {
      markets[market] = {
        endpoint: MONITORED_ENDPOINT,
        p95_ms: 0,
        sample_size: 0,
        window_start: null,
        window_end: null,
        alert_triggered: false,
        baseline_ms: market === 'sg' ? 160 : 0,
        threshold_ms: P95_THRESHOLD_MS,
      };
    }
  }

  // Populate cache when freshness checks are enabled (skipFreshness=false).
  if (!options.skipFreshness) {
    p95AllCache = { data: markets, expiresAt: Date.now() + P95_ALL_CACHE_TTL_MS };
  }

  return markets;
}

export async function insertP95Latency(
  market: string,
  endpoint: string,
  p95Ms: number,
  sampleSize: number,
  windowStart: Date,
  windowEnd: Date
): Promise<void> {
  await db.query(
    `INSERT INTO monitoring.p95_latency (market, endpoint, p95_ms, sample_size, window_start, window_end)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [market, endpoint, p95Ms, sampleSize, windowStart, windowEnd]
  );

  if (p95Ms > P95_THRESHOLD_MS) {
    await insertAlert(market, p95Ms, P95_THRESHOLD_MS);
  }
}

export async function insertAlert(market: string, p95Ms: number, thresholdMs: number): Promise<void> {
  await db.query(
    `INSERT INTO monitoring.alert_history (market, p95_ms, threshold_ms, kind)
     VALUES ($1, $2, $3, 'p95')`,
    [market, p95Ms, thresholdMs]
  );
}

export async function getAlertHistory(options: AlertHistoryOptions = {}): Promise<AlertRecord[]> {
  const {
    market = null,
    kind = null,
    limit = 50,
  } = options;

  const values: Array<string | number> = [];
  const filters: string[] = [];

  if (market) {
    values.push(market);
    filters.push(`market = $${values.length}`);
  }

  if (kind) {
    values.push(kind);
    filters.push(`kind = $${values.length}`);
  }

  values.push(Math.min(Math.max(limit, 1), 500));
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT *
       FROM monitoring.alert_history
       ${whereClause}
     ORDER BY triggered_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

export async function cleanupOldData(retentionDays: number = 7): Promise<number> {
  const result = await db.query(
    `SELECT monitoring.cleanup_old_p95_data($1) as deleted_count`,
    [retentionDays]
  );
  return result.rows[0].deleted_count;
}

export async function refreshRecentP95Windows(
  lookbackWindows: number = AGGREGATION_LOOKBACK_WINDOWS
): Promise<void> {
  const safeLookbackWindows = Math.max(1, Number(lookbackWindows) || AGGREGATION_LOOKBACK_WINDOWS);
  const lookbackMinutes = safeLookbackWindows * AGGREGATION_WINDOW_MINUTES;

  await db.query(
    `WITH aggregated AS (
       SELECT
         market,
         endpoint,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY response_time_ms)::integer AS p95_ms,
         COUNT(*)::integer AS sample_size,
         to_timestamp(floor(extract(epoch FROM measured_at) / 300) * 300) AS window_start,
         to_timestamp(floor(extract(epoch FROM measured_at) / 300) * 300) + interval '5 minutes' AS window_end
       FROM monitoring.p95_raw_measurements
       WHERE measured_at >= NOW() - ($1::integer * interval '1 minute')
       GROUP BY market, endpoint, window_start, window_end
     ),
     deleted AS (
       DELETE FROM monitoring.p95_latency existing
       USING aggregated
       WHERE existing.market = aggregated.market
         AND existing.endpoint = aggregated.endpoint
         AND existing.window_start = aggregated.window_start
         AND existing.window_end = aggregated.window_end
     )
     INSERT INTO monitoring.p95_latency
       (market, endpoint, p95_ms, sample_size, window_start, window_end)
     SELECT market, endpoint, p95_ms, sample_size, window_start, window_end
     FROM aggregated`,
    [lookbackMinutes]
  );
}

const latencySamples = new Map<string, number[]>();

export function recordLatencySample(market: string, endpoint: string, latencyMs: number): void {
  const key = `${market}:${endpoint}`;
  if (!latencySamples.has(key)) {
    latencySamples.set(key, []);
  }
  const samples = latencySamples.get(key)!;
  samples.push(latencyMs);

  if (samples.length > 1000) {
    samples.shift();
  }
}

export function getLatencySamples(market: string, endpoint: string): number[] {
  const key = `${market}:${endpoint}`;
  return latencySamples.get(key) || [];
}

export function clearLatencySamples(market: string, endpoint: string): void {
  const key = `${market}:${endpoint}`;
  latencySamples.delete(key);
}

export async function computeAndStoreP95(market: string, endpoint: string): Promise<void> {
  const samples = getLatencySamples(market, endpoint);
  if (samples.length < 10) {
    return;
  }

  const p95Ms = calculateP95(samples);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 5 * 60 * 1000);

  await insertP95Latency(market, endpoint, p95Ms, samples.length, windowStart, windowEnd);
  clearLatencySamples(market, endpoint);
}
