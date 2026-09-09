"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  services: ServiceHealth[];
  frontend: FrontendHealth;
}

interface ServiceHealth {
  name: string;
  status: "up" | "down" | "degraded";
  responseTime?: number;
  lastChecked: string;
  message?: string;
}

interface FrontendHealth {
  buildId: string;
  version: string;
  environment: string;
  apiEndpoint: string;
}

function statusBadge(status: "healthy" | "degraded" | "unhealthy") {
  if (status === "healthy") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "degraded") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-rose-100 text-rose-800";
}

function serviceStatusBadge(status: "up" | "down" | "degraded") {
  if (status === "up") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "degraded") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-rose-100 text-rose-800";
}

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString();
}

function formatResponseTime(ms?: number) {
  if (ms === undefined) return "—";
  return `${ms}ms`;
}

export default function HealthCheckPage() {
  const [data, setData] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const startTime = Date.now();
      const response = await fetch("/api/dashboard/health");
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const payload = await response.json();

      const frontendHealth: FrontendHealth = {
        buildId: process.env.NEXT_PUBLIC_BUILD_ID || "local",
        version: process.env.NEXT_PUBLIC_VERSION || "1.0.0",
        environment: process.env.NODE_ENV || "development",
        apiEndpoint: process.env.NEXT_PUBLIC_API_URL || "https://api.buywhere.ai",
      };

      const services: ServiceHealth[] = [
        {
          name: "API Health Endpoint",
          status: payload.error ? "down" : "up",
          responseTime,
          lastChecked: new Date().toISOString(),
          message: payload.error || undefined,
        },
        {
          name: "Catalog Service",
          status: payload.status === "ok" ? "up" : payload.status === "degraded" ? "degraded" : "down",
          lastChecked: new Date().toISOString(),
        },
        {
          name: "Database",
          status: payload.database?.status === "ok" ? "up" : payload.database?.status === "degraded" ? "degraded" : "down",
          lastChecked: new Date().toISOString(),
          message: payload.database?.message,
        },
        {
          name: "Redis Cache",
          status: payload.redis?.status === "ok" ? "up" : payload.redis?.status === "degraded" ? "degraded" : "down",
          lastChecked: new Date().toISOString(),
          message: payload.redis?.message,
        },
      ];

      const overallStatus = services.every((s) => s.status === "up")
        ? "healthy"
        : services.some((s) => s.status === "down")
        ? "unhealthy"
        : "degraded";

      setData({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        services,
        frontend: frontendHealth,
      });
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to perform health check");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <section className="bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.35),_transparent_35%),linear-gradient(135deg,#0f172a,#111827_55%,#1d4ed8)] py-14 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.24em] text-sky-200">Operations</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Frontend Health Check</h1>
              <p className="mt-4 max-w-2xl text-base text-slate-200">
                Monitor frontend health status, API connectivity, and downstream service availability for Fetch QA.
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
                onClick={checkHealth}
                disabled={loading}
                className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {loading ? "Checking..." : "Refresh"}
              </button>
            </div>
          </div>

          {data ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Overall Status</p>
                <p className="mt-2 text-3xl font-semibold capitalize">{data.status}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {data.services.filter((s) => s.status === "up").length}/{data.services.length} services up
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Environment</p>
                <p className="mt-2 text-3xl font-semibold">{data.frontend.environment}</p>
                <p className="mt-1 text-sm text-slate-300">v{data.frontend.version}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">API Endpoint</p>
                <p className="mt-2 text-lg font-semibold truncate">{data.frontend.apiEndpoint}</p>
                <p className="mt-1 text-sm text-slate-300">Build: {data.frontend.buildId}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm text-slate-300">Last Check</p>
                <p className="mt-2 text-3xl font-semibold">
                  {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  {lastRefresh
                    ? `${Math.round((Date.now() - lastRefresh.getTime()) / 1000)}s ago`
                    : "Never"}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="flex-1 py-10">
        <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
          {loading && !data ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
              Performing health check...
            </div>
          ) : error && !data ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center shadow-sm">
              <p className="text-base font-semibold text-rose-900">Health check failed</p>
              <p className="mt-2 text-sm text-rose-700">{error}</p>
              <button
                onClick={checkHealth}
                className="mt-4 text-sm font-medium text-rose-900 underline"
              >
                Try again
              </button>
            </div>
          ) : data ? (
            <>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">Service Status</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Current health status of frontend dependencies.
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${statusBadge(
                      data.status
                    )}`}
                  >
                    {data.status}
                  </span>
                </div>

                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-3 font-medium">Service</th>
                        <th className="pb-3 font-medium">Status</th>
                        <th className="pb-3 font-medium">Response Time</th>
                        <th className="pb-3 font-medium">Last Checked</th>
                        <th className="pb-3 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.services.map((service) => (
                        <tr key={service.name} className="border-b border-slate-100">
                          <td className="py-4 font-medium text-slate-950">{service.name}</td>
                          <td className="py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${serviceStatusBadge(
                                service.status
                              )}`}
                            >
                              {service.status}
                            </span>
                          </td>
                          <td className="py-4 text-slate-600">
                            {formatResponseTime(service.responseTime)}
                          </td>
                          <td className="py-4 text-slate-600">
                            {formatTimestamp(service.lastChecked)}
                          </td>
                          <td className="py-4 text-slate-600">
                            {service.message || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Frontend Environment</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Runtime configuration and build information.
                  </p>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 p-4">
                    <p className="text-sm font-medium text-slate-500">Build ID</p>
                    <p className="mt-1 text-base text-slate-950 font-mono">{data.frontend.buildId}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-4">
                    <p className="text-sm font-medium text-slate-500">Version</p>
                    <p className="mt-1 text-base text-slate-950">{data.frontend.version}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-4">
                    <p className="text-sm font-medium text-slate-500">Environment</p>
                    <p className="mt-1 text-base text-slate-950 capitalize">{data.frontend.environment}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-4">
                    <p className="text-sm font-medium text-slate-500">API Endpoint</p>
                    <p className="mt-1 text-base text-slate-950 font-mono truncate">
                      {data.frontend.apiEndpoint}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <Footer />
    </div>
  );
}