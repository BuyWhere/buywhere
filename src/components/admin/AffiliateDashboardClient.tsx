"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { AffiliateSummaryResponse } from "@/app/api/admin/affiliate/summary/route";

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function buildLinePath(
  values: number[],
  width: number,
  height: number,
  padding: number,
) {
  if (values.length === 0) {
    return "";
  }

  const maxValue = Math.max(...values, 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * innerWidth;
      const y = padding + innerHeight - (value / maxValue) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
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
    <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  );
}

function AffiliateTrendChart({ data }: { data: AffiliateSummaryResponse["daily_series"] }) {
  const width = 960;
  const height = 320;
  const padding = 28;
  const clickValues = data.map((point) => point.clicks);
  const conversionValues = data.map((point) => point.conversions);
  const allValues = [...clickValues, ...conversionValues];
  const maxValue = Math.max(...allValues, 1);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">30-day trend</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Clicks and conversions by day</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Daily activity over the current reporting window. Zero values mean the underlying database has not recorded traffic yet.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="inline-flex items-center gap-2 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            Clicks
          </span>
          <span className="inline-flex items-center gap-2 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Conversions
          </span>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-slate-100 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Daily clicks and conversions line chart">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding + (height - padding * 2) * ratio;
            const value = Math.round(maxValue * (1 - ratio));
            return (
              <g key={ratio}>
                <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 6" />
                <text x={6} y={y + 4} fontSize="12" fill="#64748b">
                  {formatInteger(value)}
                </text>
              </g>
            );
          })}

          <path
            d={buildLinePath(clickValues, width, height, padding)}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={buildLinePath(conversionValues, width, height, padding)}
            fill="none"
            stroke="#10b981"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="mt-4 grid grid-cols-5 gap-2 text-xs text-slate-500 md:grid-cols-10">
          {data.filter((_, index) => index % Math.max(Math.floor(data.length / 10), 1) === 0).map((point) => (
            <span key={point.day}>{formatDayLabel(point.day)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesTable({ rows, currency }: { rows: AffiliateSummaryResponse["top_sources"]; currency: string }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">Leaderboard</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Top performing sources</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="pb-3 font-medium">Source</th>
              <th className="pb-3 font-medium">Clicks</th>
              <th className="pb-3 font-medium">Conversions</th>
              <th className="pb-3 font-medium">Conv. rate</th>
              <th className="pb-3 text-right font-medium">Est. revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.source} className="border-b border-slate-100 last:border-b-0">
                <td className="py-3 font-medium text-slate-900">{row.source}</td>
                <td className="py-3 text-slate-600">{formatInteger(row.clicks)}</td>
                <td className="py-3 text-slate-600">{formatInteger(row.conversions)}</td>
                <td className="py-3 text-slate-600">{formatPercent(row.conversion_rate)}</td>
                <td className="py-3 text-right font-medium text-slate-900">{formatCurrency(row.estimated_revenue, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductsTable({ rows, currency }: { rows: AffiliateSummaryResponse["top_products"]; currency: string }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">Products</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Top performing products</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="pb-3 font-medium">Product</th>
              <th className="pb-3 font-medium">Source</th>
              <th className="pb-3 font-medium">Clicks</th>
              <th className="pb-3 font-medium">Conversions</th>
              <th className="pb-3 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.product_id}:${row.source}`} className="border-b border-slate-100 last:border-b-0">
                <td className="py-3">
                  <p className="font-medium text-slate-900">{row.product_name}</p>
                  <p className="mt-1 text-xs text-slate-500">Product ID {row.product_id}</p>
                </td>
                <td className="py-3 text-slate-600">{row.source}</td>
                <td className="py-3 text-slate-600">{formatInteger(row.clicks)}</td>
                <td className="py-3 text-slate-600">{formatInteger(row.conversions)}</td>
                <td className="py-3 text-right font-medium text-slate-900">{formatCurrency(row.estimated_revenue, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AffiliateDashboardClient({ adminToken }: { adminToken?: string | null }) {
  const [data, setData] = useState<AffiliateSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ days: "30" });
      if (adminToken) {
        query.set("token", adminToken);
      }

      const response = await fetch(`/api/admin/affiliate/summary?${query.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load affiliate dashboard");
      }

      const payload = (await response.json()) as AffiliateSummaryResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load affiliate dashboard");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)]">
      <Nav />

      <section className="bg-[linear-gradient(135deg,#082f49_0%,#0f172a_45%,#14532d_100%)] py-14 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.24em] text-sky-200">Admin analytics</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Affiliate Revenue Dashboard</h1>
              <p className="mt-4 max-w-2xl text-base text-slate-200">
                Track outbound clicks, downstream conversions, and estimated commission by source and product over the last 30 days.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
              >
                Back to dashboard
              </Link>
              <button
                onClick={loadData}
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100"
              >
                Refresh data
              </button>
            </div>
          </div>

          {data ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Total clicks</p>
                <p className="mt-2 text-3xl font-semibold">{formatInteger(data.summary.total_clicks)}</p>
                <p className="mt-1 text-sm text-slate-300">Last {data.days} days</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Conversions</p>
                <p className="mt-2 text-3xl font-semibold">{formatInteger(data.summary.total_conversions)}</p>
                <p className="mt-1 text-sm text-slate-300">Tracked orders recorded</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Estimated revenue</p>
                <p className="mt-2 text-3xl font-semibold">{formatCurrency(data.summary.estimated_revenue, data.summary.currency)}</p>
                <p className="mt-1 text-sm text-slate-300">Sum of commission decisions</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Conversion rate</p>
                <p className="mt-2 text-3xl font-semibold">{formatPercent(data.summary.conversion_rate)}</p>
                <p className="mt-1 text-sm text-slate-300">Conversions divided by clicks</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex-1 py-10">
        <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
          {loading ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              Loading affiliate performance data...
            </div>
          ) : error || !data ? (
            <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-center shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <p className="text-base font-semibold text-rose-900">Failed to load affiliate dashboard</p>
              <p className="mt-2 text-sm text-rose-700">{error}</p>
              <button onClick={loadData} className="mt-4 text-sm font-medium text-rose-900 underline">
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Clicks"
                  value={formatInteger(data.summary.total_clicks)}
                  hint="Outbound affiliate redirects captured from the click tracker."
                />
                <SummaryCard
                  label="Conversions"
                  value={formatInteger(data.summary.total_conversions)}
                  hint="Tracked conversion rows linked to the affiliate funnel."
                />
                <SummaryCard
                  label="Revenue"
                  value={formatCurrency(data.summary.estimated_revenue, data.summary.currency)}
                  hint="Estimated revenue from recorded commission decisions."
                />
                <SummaryCard
                  label="CVR"
                  value={formatPercent(data.summary.conversion_rate)}
                  hint="Useful for comparing source quality beyond raw traffic."
                />
              </div>

              <AffiliateTrendChart data={data.daily_series} />

              <div className="grid gap-6 xl:grid-cols-2">
                <SourcesTable rows={data.top_sources} currency={data.summary.currency} />
                <ProductsTable rows={data.top_products} currency={data.summary.currency} />
              </div>
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}

export default AffiliateDashboardClient;
