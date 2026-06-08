import { db } from '../config';
import { Request, Response, NextFunction } from 'express';

export const VALID_MARKETS = ['sg', 'us', 'my', 'vn', 'th'] as const;
export const P95_THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
const AGGREGATION_WINDOW_MINUTES = 5;
const AGGREGATION_LOOKBACK_WINDOWS = 3;

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
  triggered_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolution_notes: string | null;
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

export async function getP95Latency(market: string, limit = 100): Promise<P95LatencyRecord[]> {
  await refreshRecentP95Windows();

  const result = await db.query(
    `SELECT * FROM monitoring.p95_latency
     WHERE market = $1
     ORDER BY window_end DESC
     LIMIT $2`,
    [market, limit]
  );
  return result.rows;
}

export async function getLatestP95ForMarket(market: string): Promise<P95LatencyRecord | null> {
  await refreshRecentP95Windows();

  const result = await db.query(
    `SELECT * FROM monitoring.p95_latency
     WHERE market = $1
     ORDER BY window_end DESC
     LIMIT 1`,
    [market]
  );
  return result.rows[0] || null;
}

export async function getAllLatestP95(): Promise<Record<string, { p95_ms: number; alert_triggered: boolean }>> {
  await refreshRecentP95Windows();

  const result = await db.query(
    `SELECT DISTINCT ON (market) market, p95_ms, window_end
     FROM monitoring.p95_latency
     ORDER BY market, window_end DESC`
  );
  
  const markets: Record<string, { p95_ms: number; alert_triggered: boolean }> = {};
  for (const row of result.rows) {
    markets[row.market] = {
      p95_ms: row.p95_ms,
      alert_triggered: row.p95_ms > P95_THRESHOLD_MS
    };
  }
  
  for (const market of VALID_MARKETS) {
    if (!markets[market]) {
      markets[market] = { p95_ms: 0, alert_triggered: false };
    }
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
    `INSERT INTO monitoring.alert_history (market, p95_ms, threshold_ms)
     VALUES ($1, $2, $3)`,
    [market, p95Ms, thresholdMs]
  );
}

export async function getAlertHistory(market: string, limit = 50): Promise<AlertRecord[]> {
  const result = await db.query(
    `SELECT * FROM monitoring.alert_history
     WHERE market = $1
     ORDER BY triggered_at DESC
     LIMIT $2`,
    [market, limit]
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
