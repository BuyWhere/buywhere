"use client";

import React from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { StatCard } from "./StatCard";
import { HealthScoreGauge } from "./HealthScoreGauge";
import { AlertsPanel } from "./AlertsPanel";
import { CategoryCoverageTable } from "./CategoryCoverageTable";
import { SyncHistoryChart } from "./SyncHistoryChart";
import type { CatalogHealthData } from "@/app/api/dashboard/catalog/health/route";

export interface CatalogHealthDashboardProps {
  data: CatalogHealthData;
}

function formatLastSync(isoString: string) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return `${Math.floor(diffHours / 24)} days ago`;
}

function getOverallStatus(data: CatalogHealthData) {
  if (data.status === "down") return "critical";
  if (data.status === "degraded") return "warning";
  const criticalCategories = data.categories.filter((c) => c.status === "critical").length;
  if (criticalCategories > 0) return "critical";
  const warningCategories = data.categories.filter((c) => c.status === "warning").length;
  if (warningCategories > 2) return "warning";
  return "ok";
}

export function CatalogHealthDashboard({ data }: CatalogHealthDashboardProps) {
  const overallStatus = getOverallStatus(data);

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <section className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Catalog Health Dashboard</h1>
              <p className="text-indigo-200">Monitor product catalog quality, coverage, and data freshness</p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-indigo-200 hover:text-white transition-colors"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="py-10 bg-gray-50 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Products"
              value={data.product_count.toLocaleString()}
              trend={`+2,341 today`}
              status="ok"
            />
            <StatCard
              label="Categories"
              value={data.category_count}
              trend={`+1 this week`}
              status="ok"
            />
            <StatCard
              label="Retailers"
              value={data.retailer_count}
              trend={`+0 this week`}
              status="ok"
            />
            <StatCard
              label="Data Fresh"
              value={formatLastSync(data.last_sync_at)}
              trend={`● ${data.status === "ok" ? "Healthy" : data.status === "degraded" ? "Degraded" : "Down"}`}
              status={overallStatus}
            />
          </div>

          <HealthScoreGauge
            score={data.health_score}
            coverage={data.metrics.coverage}
            freshness={data.metrics.freshness}
            completeness={data.metrics.completeness}
            error_rate={data.metrics.error_rate}
          />

          <div className="grid lg:grid-cols-2 gap-6">
            <AlertsPanel alerts={data.alerts} />
            <CategoryCoverageTable categories={data.categories} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">Operations visibility</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Scraper fleet monitor</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-500">
                  Watch active scrapers, output rates, and new SKU counts from the dedicated scraping progress monitor.
                </p>
              </div>
              <Link
                href="/dashboard/scraping"
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Open monitor
              </Link>
            </div>
          </div>

          <SyncHistoryChart syncHistory={data.sync_history} />
        </div>
      </section>

      <Footer />
    </div>
  );
}

export default CatalogHealthDashboard;
