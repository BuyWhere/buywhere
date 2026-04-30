import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.buywhere.ai";
const ACTIVE_WINDOW_HOURS = 6;

interface ScraperHealth {
  source: string;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_rows_inserted?: number | null;
  last_rows_updated?: number | null;
  last_rows_failed?: number | null;
  product_count?: number;
  is_healthy?: boolean;
  hours_since_last_run?: number | null;
  error_message?: string | null;
}

interface ScraperHealthReport {
  generated_at: string;
  scrapers: ScraperHealth[];
  total_scrapers: number;
  healthy_count: number;
  unhealthy_count: number;
}

interface IngestionStats {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  running_runs: number;
  total_rows_inserted: number;
  total_rows_updated: number;
  total_rows_failed: number;
}

interface RecentRun {
  id: string;
  source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_failed: number;
  new_skus: number;
  output_rate_per_hour: number;
  duration_minutes: number | null;
}

interface ThroughputPoint {
  label: string;
  inserted: number;
  updated: number;
  failed: number;
}

interface AlertItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
}

export interface ScrapingProgressMonitorData {
  generated_at: string;
  summary: {
    active_scrapers: number;
    total_scrapers: number;
    healthy_scrapers: number;
    unhealthy_scrapers: number;
    new_skus_24h: number;
    rows_processed_24h: number;
    avg_output_rate_per_hour: number;
    running_runs: number;
    failed_runs: number;
    total_products: number;
    latest_activity_at: string | null;
  };
  scrapers: Array<{
    source: string;
    status: "healthy" | "degraded" | "offline";
    is_active: boolean;
    last_run_at: string | null;
    last_run_status: string | null;
    product_count: number;
    rows_inserted: number;
    rows_updated: number;
    rows_failed: number;
    output_rate_per_hour: number;
    hours_since_last_run: number | null;
    error_message: string | null;
  }>;
  recent_runs: RecentRun[];
  throughput_history: ThroughputPoint[];
  alerts: AlertItem[];
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractRuns(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.runs, record.items, record.results, record.data];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
  }

  return [];
}

function normalizeScraperStatus(scraper: ScraperHealth) {
  const healthy = Boolean(scraper.is_healthy);
  const hoursSinceLastRun =
    typeof scraper.hours_since_last_run === "number" && Number.isFinite(scraper.hours_since_last_run)
      ? scraper.hours_since_last_run
      : null;

  if (!healthy) {
    return "offline" as const;
  }

  if (hoursSinceLastRun !== null && hoursSinceLastRun > ACTIVE_WINDOW_HOURS) {
    return "degraded" as const;
  }

  return "healthy" as const;
}

function buildMockData(): ScrapingProgressMonitorData {
  const now = new Date();
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

  const scrapers = [
    {
      source: "shopee_sg",
      status: "healthy" as const,
      is_active: true,
      last_run_at: minutesAgo(8),
      last_run_status: "running",
      product_count: 1243890,
      rows_inserted: 1430,
      rows_updated: 8210,
      rows_failed: 18,
      output_rate_per_hour: 1205,
      hours_since_last_run: 0.13,
      error_message: null,
    },
    {
      source: "lazada_sg",
      status: "healthy" as const,
      is_active: true,
      last_run_at: minutesAgo(21),
      last_run_status: "completed",
      product_count: 982104,
      rows_inserted: 1124,
      rows_updated: 6450,
      rows_failed: 12,
      output_rate_per_hour: 948,
      hours_since_last_run: 0.35,
      error_message: null,
    },
    {
      source: "amazon_sg",
      status: "healthy" as const,
      is_active: true,
      last_run_at: minutesAgo(42),
      last_run_status: "completed",
      product_count: 541223,
      rows_inserted: 804,
      rows_updated: 2872,
      rows_failed: 7,
      output_rate_per_hour: 516,
      hours_since_last_run: 0.7,
      error_message: null,
    },
    {
      source: "qoo10_sg",
      status: "degraded" as const,
      is_active: false,
      last_run_at: hoursAgo(7),
      last_run_status: "completed",
      product_count: 311984,
      rows_inserted: 202,
      rows_updated: 1044,
      rows_failed: 30,
      output_rate_per_hour: 91,
      hours_since_last_run: 7,
      error_message: "No fresh run in the last 6 hours.",
    },
    {
      source: "carousell_sg",
      status: "offline" as const,
      is_active: false,
      last_run_at: hoursAgo(13),
      last_run_status: "failed",
      product_count: 194820,
      rows_inserted: 41,
      rows_updated: 201,
      rows_failed: 77,
      output_rate_per_hour: 24,
      hours_since_last_run: 13,
      error_message: "HTTP 429 spike across listing pages.",
    },
  ];

  const recentRuns: RecentRun[] = [
    {
      id: "run-18439",
      source: "shopee_sg",
      status: "running",
      started_at: minutesAgo(14),
      finished_at: null,
      rows_inserted: 1430,
      rows_updated: 8210,
      rows_failed: 18,
      new_skus: 1430,
      output_rate_per_hour: 41134,
      duration_minutes: 14,
    },
    {
      id: "run-18438",
      source: "lazada_sg",
      status: "completed",
      started_at: hoursAgo(1.2),
      finished_at: hoursAgo(0.9),
      rows_inserted: 1124,
      rows_updated: 6450,
      rows_failed: 12,
      new_skus: 1124,
      output_rate_per_hour: 18206,
      duration_minutes: 25,
    },
    {
      id: "run-18437",
      source: "amazon_sg",
      status: "completed",
      started_at: hoursAgo(2.4),
      finished_at: hoursAgo(2.1),
      rows_inserted: 804,
      rows_updated: 2872,
      rows_failed: 7,
      new_skus: 804,
      output_rate_per_hour: 10208,
      duration_minutes: 24,
    },
    {
      id: "run-18436",
      source: "carousell_sg",
      status: "failed",
      started_at: hoursAgo(5.8),
      finished_at: hoursAgo(5.6),
      rows_inserted: 41,
      rows_updated: 201,
      rows_failed: 77,
      new_skus: 41,
      output_rate_per_hour: 957,
      duration_minutes: 20,
    },
  ];

  const throughputHistory = Array.from({ length: 8 }, (_, index) => {
    const hour = new Date(now.getTime() - (7 - index) * 60 * 60 * 1000);
    return {
      label: hour.toISOString(),
      inserted: 700 + index * 120,
      updated: 3200 + index * 310,
      failed: 12 + (index % 3) * 8,
    };
  });

  return {
    generated_at: now.toISOString(),
    summary: {
      active_scrapers: 3,
      total_scrapers: 5,
      healthy_scrapers: 3,
      unhealthy_scrapers: 2,
      new_skus_24h: 9128,
      rows_processed_24h: 68420,
      avg_output_rate_per_hour: 2851,
      running_runs: 1,
      failed_runs: 1,
      total_products: scrapers.reduce((sum, scraper) => sum + scraper.product_count, 0),
      latest_activity_at: scrapers[0]?.last_run_at ?? null,
    },
    scrapers,
    recent_runs: recentRuns,
    throughput_history: throughputHistory,
    alerts: [
      {
        id: "degraded-qoo10",
        severity: "warning",
        title: "Qoo10 SG is lagging",
        message: "No fresh run for more than 6 hours. Throughput has dropped below the fleet average.",
      },
      {
        id: "offline-carousell",
        severity: "critical",
        title: "Carousell SG needs intervention",
        message: "Latest run failed with elevated row failures. Inspect rate limits and retry logic.",
      },
    ],
  };
}

function normalizeRun(run: Record<string, unknown>, index: number): RecentRun {
  const startedAt =
    parseDate(run.started_at) ??
    parseDate(run.startedAt) ??
    parseDate(run.created_at) ??
    parseDate(run.createdAt) ??
    parseDate(run.last_run_at);
  const finishedAt =
    parseDate(run.finished_at) ??
    parseDate(run.finishedAt) ??
    parseDate(run.completed_at) ??
    parseDate(run.completedAt) ??
    null;

  const rowsInserted = numberOrZero(run.rows_inserted ?? run.inserted_count ?? run.last_rows_inserted);
  const rowsUpdated = numberOrZero(run.rows_updated ?? run.updated_count ?? run.last_rows_updated);
  const rowsFailed = numberOrZero(run.rows_failed ?? run.failed_count ?? run.last_rows_failed);
  const durationMs =
    startedAt && finishedAt
      ? Math.max(finishedAt.getTime() - startedAt.getTime(), 1)
      : startedAt
        ? Math.max(Date.now() - startedAt.getTime(), 1)
        : 0;
  const durationMinutes = durationMs ? Math.max(Math.round(durationMs / 60000), 1) : null;
  const processedRows = rowsInserted + rowsUpdated + rowsFailed;
  const outputRatePerHour = durationMs
    ? Math.round(processedRows / (durationMs / (1000 * 60 * 60)))
    : 0;

  return {
    id: String(run.id ?? run.run_id ?? index + 1),
    source: String(run.source ?? run.platform ?? run.scraper ?? "unknown"),
    status: String(run.status ?? run.last_run_status ?? "unknown"),
    started_at: startedAt?.toISOString() ?? null,
    finished_at: finishedAt?.toISOString() ?? null,
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    rows_failed: rowsFailed,
    new_skus: numberOrZero(run.new_skus ?? run.rows_inserted ?? run.inserted_count ?? run.last_rows_inserted),
    output_rate_per_hour: outputRatePerHour,
    duration_minutes: durationMinutes,
  };
}

function buildMonitorData(scraperReport: ScraperHealthReport, stats: IngestionStats, rawRuns: Record<string, unknown>[]) {
  const recentRuns = rawRuns
    .map(normalizeRun)
    .sort((a, b) => {
      const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 12);

  const now = Date.now();
  const last24hRuns = recentRuns.filter((run) => {
    if (!run.started_at) {
      return false;
    }

    return now - new Date(run.started_at).getTime() <= 24 * 60 * 60 * 1000;
  });

  const scrapers = scraperReport.scrapers
    .map((scraper) => {
      const processedRows =
        numberOrZero(scraper.last_rows_inserted) +
        numberOrZero(scraper.last_rows_updated) +
        numberOrZero(scraper.last_rows_failed);
      const hoursSince =
        typeof scraper.hours_since_last_run === "number" && Number.isFinite(scraper.hours_since_last_run)
          ? scraper.hours_since_last_run
          : null;
      const rate = hoursSince && hoursSince > 0 ? Math.round(processedRows / Math.max(hoursSince, 0.25)) : processedRows;

      return {
        source: scraper.source,
        status: normalizeScraperStatus(scraper),
        is_active:
          scraper.last_run_status === "running" ||
          (hoursSince !== null && hoursSince <= ACTIVE_WINDOW_HOURS),
        last_run_at: parseDate(scraper.last_run_at)?.toISOString() ?? null,
        last_run_status: scraper.last_run_status ?? null,
        product_count: numberOrZero(scraper.product_count),
        rows_inserted: numberOrZero(scraper.last_rows_inserted),
        rows_updated: numberOrZero(scraper.last_rows_updated),
        rows_failed: numberOrZero(scraper.last_rows_failed),
        output_rate_per_hour: Math.round(rate),
        hours_since_last_run: hoursSince,
        error_message: scraper.error_message ?? null,
      };
    })
    .sort((a, b) => {
      const statusRank = { offline: 0, degraded: 1, healthy: 2 };
      return statusRank[a.status] - statusRank[b.status] || b.output_rate_per_hour - a.output_rate_per_hour;
    });

  const throughputBuckets = new Map<string, ThroughputPoint>();

  for (const run of last24hRuns) {
    if (!run.started_at) {
      continue;
    }

    const bucketDate = new Date(run.started_at);
    bucketDate.setMinutes(0, 0, 0);
    const label = bucketDate.toISOString();
    const existing = throughputBuckets.get(label) ?? {
      label,
      inserted: 0,
      updated: 0,
      failed: 0,
    };

    existing.inserted += run.rows_inserted;
    existing.updated += run.rows_updated;
    existing.failed += run.rows_failed;
    throughputBuckets.set(label, existing);
  }

  const throughputHistory = Array.from(throughputBuckets.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-8);

  const newSkus24h = last24hRuns.reduce((sum, run) => sum + run.new_skus, 0);
  const rowsProcessed24h = last24hRuns.reduce(
    (sum, run) => sum + run.rows_inserted + run.rows_updated + run.rows_failed,
    0
  );
  const avgOutputRatePerHour = rowsProcessed24h > 0 ? Math.round(rowsProcessed24h / 24) : 0;
  const latestActivityAt = scrapers
    .map((scraper) => scraper.last_run_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const alerts: AlertItem[] = [];

  scrapers
    .filter((scraper) => scraper.status !== "healthy")
    .slice(0, 4)
    .forEach((scraper) => {
      alerts.push({
        id: `scraper-${scraper.source}`,
        severity: scraper.status === "offline" ? "critical" : "warning",
        title: `${scraper.source} is ${scraper.status}`,
        message:
          scraper.error_message ??
          (scraper.hours_since_last_run !== null
            ? `Last run was ${scraper.hours_since_last_run.toFixed(1)} hours ago.`
            : "This scraper needs investigation."),
      });
    });

  if (stats.failed_runs > 0) {
    alerts.push({
      id: "failed-runs",
      severity: stats.failed_runs > 3 ? "critical" : "info",
      title: `${stats.failed_runs} ingestion run${stats.failed_runs === 1 ? "" : "s"} failed`,
      message: "Review recent runs for source-specific regressions and row failure spikes.",
    });
  }

  return {
    generated_at: scraperReport.generated_at,
    summary: {
      active_scrapers: scrapers.filter((scraper) => scraper.is_active).length,
      total_scrapers: scraperReport.total_scrapers,
      healthy_scrapers: scraperReport.healthy_count,
      unhealthy_scrapers: scraperReport.unhealthy_count,
      new_skus_24h: newSkus24h,
      rows_processed_24h: rowsProcessed24h,
      avg_output_rate_per_hour: avgOutputRatePerHour,
      running_runs: stats.running_runs,
      failed_runs: stats.failed_runs,
      total_products: scrapers.reduce((sum, scraper) => sum + scraper.product_count, 0),
      latest_activity_at: latestActivityAt,
    },
    scrapers,
    recent_runs: recentRuns,
    throughput_history: throughputHistory,
    alerts,
  };
}

export async function GET(request: NextRequest) {
  const apiKey =
    request.headers.get("x-api-key") ??
    process.env.BUYWHERE_DASHBOARD_API_KEY ??
    process.env.BUYWHERE_API_KEY ??
    null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const [scrapersRes, statsRes, runsRes] = await Promise.all([
      fetch(`${API_BASE}/v1/status/scrapers`, { headers, next: { revalidate: 60 } }),
      fetch(`${API_BASE}/v1/ingestion/stats`, { headers, next: { revalidate: 60 } }),
      fetch(`${API_BASE}/v1/ingest/runs?limit=25&offset=0`, { headers, next: { revalidate: 60 } }),
    ]);

    if (!scrapersRes.ok || !statsRes.ok || !runsRes.ok) {
      return NextResponse.json(buildMockData());
    }

    const [scraperReport, stats, runsPayload] = await Promise.all([
      scrapersRes.json() as Promise<ScraperHealthReport>,
      statsRes.json() as Promise<IngestionStats>,
      runsRes.json() as Promise<unknown>,
    ]);

    return NextResponse.json(buildMonitorData(scraperReport, stats, extractRuns(runsPayload)));
  } catch {
    return NextResponse.json(buildMockData());
  }
}
