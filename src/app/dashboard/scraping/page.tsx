"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { ScrapingProgressMonitorData } from "@/app/api/dashboard/scraping/progress/route";

const ACTIVE_WINDOW_HOURS = 6;

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "No recent activity";
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
}

function statusStyles(status: "healthy" | "degraded" | "offline") {
  if (status === "healthy") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "degraded") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-rose-100 text-rose-800";
}

function alertStyles(severity: "critical" | "warning" | "info") {
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }

  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-sky-200 bg-sky-50 text-sky-900";
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  );
}

export default function ScrapingProgressPage() {
  const [data, setData] = useState<ScrapingProgressMonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/dashboard/scraping/progress");
      if (!response.ok) {
        throw new Error("Failed to load scraping monitor");
      }

      const payload = (await response.json()) as ScrapingProgressMonitorData;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scraping monitor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <section className="bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.35),_transparent_35%),linear-gradient(135deg,#0f172a,#111827_55%,#1d4ed8)] py-14 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.24em] text-sky-200">Operations</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Scraping Progress Monitor</h1>
              <p className="mt-4 max-w-2xl text-base text-slate-200">
                Track active scrapers, recent throughput, and SKU growth so the catalog team can spot drift before it stalls coverage.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/catalog"
                className="inline-flex items-center rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
              >
                Catalog health
              </Link>
              <button
                onClick={loadData}
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100"
              >
                Refresh monitor
              </button>
            </div>
          </div>

          {data ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Active scrapers</p>
                <p className="mt-2 text-3xl font-semibold">{data.summary.active_scrapers}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {data.summary.healthy_scrapers}/{data.summary.total_scrapers} healthy
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">New SKUs, 24h</p>
                <p className="mt-2 text-3xl font-semibold">{formatCompact(data.summary.new_skus_24h)}</p>
                <p className="mt-1 text-sm text-slate-300">Latest activity {formatRelativeTime(data.summary.latest_activity_at)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Output / hour</p>
                <p className="mt-2 text-3xl font-semibold">{formatCompact(data.summary.avg_output_rate_per_hour)}</p>
                <p className="mt-1 text-sm text-slate-300">{formatCompact(data.summary.rows_processed_24h)} rows in the last day</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Running runs</p>
                <p className="mt-2 text-3xl font-semibold">{data.summary.running_runs}</p>
                <p className="mt-1 text-sm text-slate-300">{data.summary.failed_runs} failed run{data.summary.failed_runs === 1 ? "" : "s"} recorded</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex-1 py-10">
        <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
              Loading scraping progress...
            </div>
          ) : error || !data ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
              <p className="text-base font-semibold text-rose-900">Failed to load scraping monitor</p>
              <p className="mt-2 text-sm text-rose-700">{error}</p>
              <button onClick={loadData} className="mt-4 text-sm font-medium text-rose-900 underline">
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard
                  label="Total catalog products"
                  value={formatCompact(data.summary.total_products)}
                  hint="Summed from per-scraper product counts."
                />
                <SummaryCard
                  label="Unhealthy scrapers"
                  value={String(data.summary.unhealthy_scrapers)}
                  hint="Offline or lagging beyond the active window."
                />
                <SummaryCard
                  label="Rows processed, 24h"
                  value={formatCompact(data.summary.rows_processed_24h)}
                  hint="Inserted, updated, and failed rows combined."
                />
                <SummaryCard
                  label="Healthy scrapers"
                  value={String(data.summary.healthy_scrapers)}
                  hint="Reported healthy by the scraper status endpoint."
                />
                <SummaryCard
                  label="Generated"
                  value={formatRelativeTime(data.generated_at)}
                  hint="Monitor snapshot freshness."
                />
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-950">Fleet throughput</h2>
                      <p className="mt-1 text-sm text-slate-500">Recent hourly output across ingestion runs.</p>
                    </div>
                    <p className="text-sm text-slate-400">Last {data.throughput_history.length} buckets</p>
                  </div>

                  <div className="mt-8 grid min-h-[260px] grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8" aria-label="Fleet throughput chart">
                    {data.throughput_history.map((point) => {
                      const total = point.inserted + point.updated + point.failed;
                      const maxTotal = Math.max(
                        ...data.throughput_history.map((entry) => entry.inserted + entry.updated + entry.failed),
                        1
                      );
                      const totalHeight = Math.max((total / maxTotal) * 180, total > 0 ? 12 : 4);
                      const insertedHeight = total > 0 ? (point.inserted / total) * totalHeight : 0;
                      const updatedHeight = total > 0 ? (point.updated / total) * totalHeight : 0;
                      const failedHeight = total > 0 ? (point.failed / total) * totalHeight : 0;

                      return (
                        <div key={point.label} className="flex flex-col items-center justify-end gap-3">
                          <span className="text-xs font-medium text-slate-500">{formatCompact(total)}</span>
                          <div className="flex h-48 w-full max-w-12 items-end overflow-hidden rounded-t-2xl bg-slate-100">
                            <div className="w-full">
                              <div className="bg-emerald-500" style={{ height: `${insertedHeight}px` }} aria-hidden="true" />
                              <div className="bg-sky-500" style={{ height: `${updatedHeight}px` }} aria-hidden="true" />
                              <div className="bg-rose-500" style={{ height: `${failedHeight}px` }} aria-hidden="true" />
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {new Date(point.label).toLocaleTimeString([], { hour: "numeric" })}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex flex-wrap gap-4 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-emerald-500" /> New SKUs</span>
                    <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-sky-500" /> Updated rows</span>
                    <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-rose-500" /> Failed rows</span>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-semibold text-slate-950">Alerts</h2>
                  <p className="mt-1 text-sm text-slate-500">Operator-facing issues derived from fleet health and run failures.</p>

                  <div className="mt-6 space-y-3">
                    {data.alerts.length > 0 ? (
                      data.alerts.map((alert) => (
                        <div key={alert.id} className={`rounded-2xl border p-4 ${alertStyles(alert.severity)}`}>
                          <p className="text-sm font-semibold">{alert.title}</p>
                          <p className="mt-1 text-sm opacity-90">{alert.message}</p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        No active fleet alerts.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">Scraper fleet</h2>
                    <p className="mt-1 text-sm text-slate-500">Source-by-source health, freshness, and output intensity.</p>
                  </div>
                  <p className="text-sm text-slate-400">
                    Active window: {ACTIVE_WINDOW_HOURS} hours
                  </p>
                </div>

                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[940px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-3 font-medium">Source</th>
                        <th className="pb-3 font-medium">Status</th>
                        <th className="pb-3 font-medium">Last run</th>
                        <th className="pb-3 font-medium">Output / hr</th>
                        <th className="pb-3 font-medium">New SKUs</th>
                        <th className="pb-3 font-medium">Updated</th>
                        <th className="pb-3 font-medium">Failed</th>
                        <th className="pb-3 font-medium">Products</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.scrapers.map((scraper) => (
                        <tr key={scraper.source} className="border-b border-slate-100 align-top">
                          <td className="py-4">
                            <div className="font-medium text-slate-950">{scraper.source}</div>
                            {scraper.error_message ? (
                              <div className="mt-1 max-w-xs text-xs text-slate-500">{scraper.error_message}</div>
                            ) : null}
                          </td>
                          <td className="py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles(scraper.status)}`}>
                              {scraper.status}
                            </span>
                            <div className="mt-2 text-xs text-slate-500">{scraper.is_active ? "Active" : "Idle"}</div>
                          </td>
                          <td className="py-4 text-slate-600">
                            <div>{formatRelativeTime(scraper.last_run_at)}</div>
                            <div className="mt-1 text-xs text-slate-400">{scraper.last_run_status ?? "unknown"}</div>
                          </td>
                          <td className="py-4 font-medium text-slate-950">{formatCompact(scraper.output_rate_per_hour)}</td>
                          <td className="py-4 text-slate-600">{formatNumber(scraper.rows_inserted)}</td>
                          <td className="py-4 text-slate-600">{formatNumber(scraper.rows_updated)}</td>
                          <td className="py-4 text-slate-600">{formatNumber(scraper.rows_failed)}</td>
                          <td className="py-4 text-slate-600">{formatCompact(scraper.product_count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Recent ingestion runs</h2>
                  <p className="mt-1 text-sm text-slate-500">Latest runs with source-level output and failure context.</p>
                </div>

                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[940px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-3 font-medium">Run</th>
                        <th className="pb-3 font-medium">Source</th>
                        <th className="pb-3 font-medium">Status</th>
                        <th className="pb-3 font-medium">Started</th>
                        <th className="pb-3 font-medium">Duration</th>
                        <th className="pb-3 font-medium">New SKUs</th>
                        <th className="pb-3 font-medium">Updated</th>
                        <th className="pb-3 font-medium">Failed</th>
                        <th className="pb-3 font-medium">Output / hr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_runs.map((run) => (
                        <tr key={run.id} className="border-b border-slate-100">
                          <td className="py-4 font-medium text-slate-950">{run.id}</td>
                          <td className="py-4 text-slate-600">{run.source}</td>
                          <td className="py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                run.status === "failed"
                                  ? "bg-rose-100 text-rose-800"
                                  : run.status === "running"
                                    ? "bg-sky-100 text-sky-800"
                                    : "bg-slate-100 text-slate-800"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="py-4 text-slate-600">{formatRelativeTime(run.started_at)}</td>
                          <td className="py-4 text-slate-600">
                            {run.duration_minutes ? `${run.duration_minutes} min` : "—"}
                          </td>
                          <td className="py-4 text-slate-600">{formatNumber(run.new_skus)}</td>
                          <td className="py-4 text-slate-600">{formatNumber(run.rows_updated)}</td>
                          <td className="py-4 text-slate-600">{formatNumber(run.rows_failed)}</td>
                          <td className="py-4 font-medium text-slate-950">{formatCompact(run.output_rate_per_hour)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
