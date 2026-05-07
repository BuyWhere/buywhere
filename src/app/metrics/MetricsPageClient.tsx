"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MetricsSection, { type PublicMetricsData } from "@/components/metrics/MetricsSection";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatRefreshTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default function MetricsPageClient({
  data,
  usingFallbackData,
  fetchedAt,
}: {
  data: PublicMetricsData;
  usingFallbackData: boolean;
  fetchedAt: string;
}) {
  const router = useRouter();
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now() + REFRESH_INTERVAL_MS);
  const [countdownMs, setCountdownMs] = useState(REFRESH_INTERVAL_MS);

  useEffect(() => {
    const refreshAt = Date.now() + REFRESH_INTERVAL_MS;
    setNextRefreshAt(refreshAt);
    setCountdownMs(REFRESH_INTERVAL_MS);

    const countdownTimer = window.setInterval(() => {
      setCountdownMs(Math.max(refreshAt - Date.now(), 0));
    }, 1000);

    const refreshTimer = window.setInterval(() => {
      const nextAt = Date.now() + REFRESH_INTERVAL_MS;
      setNextRefreshAt(nextAt);
      setCountdownMs(REFRESH_INTERVAL_MS);
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(countdownTimer);
      window.clearInterval(refreshTimer);
    };
  }, [router, fetchedAt]);

  const countdownLabel = useMemo(() => {
    const totalSeconds = Math.ceil(countdownMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [countdownMs]);

  const nextRefreshLabel = useMemo(() => formatRefreshTimestamp(new Date(nextRefreshAt).toISOString()), [nextRefreshAt]);

  return (
    <div className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.24),_transparent_35%),radial-gradient(circle_at_85%_15%,_rgba(16,185,129,0.18),_transparent_25%),linear-gradient(135deg,_#0c1324_0%,_#111827_45%,_#1f2937_100%)] py-20">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,_transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,_transparent_1px)] bg-[size:32px_32px] opacity-25" />
          <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.28em] text-cyan-200">
                  Public Metrics
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                  Auto-refresh every 5 min
                </div>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Growth dashboard for the BuyWhere product API
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-stone-300">
                Catalog scale, developer adoption, request volume, and system
                reliability in one public page.
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-sm text-stone-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Last refresh {formatRefreshTimestamp(fetchedAt)} UTC
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Next refresh in {countdownLabel}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Next sync window {nextRefreshLabel} UTC
                </span>
              </div>
              {usingFallbackData && (
                <p className="mt-4 inline-flex rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-sm text-amber-200">
                  Preview mode: showing fallback metrics because live data is unavailable.
                </p>
              )}
            </div>

            <div className="grid w-full max-w-xl grid-cols-2 gap-4">
              {[
                {
                  label: "Products indexed",
                  value: data.hero.productsIndexed.toLocaleString(),
                },
                {
                  label: "Active developers",
                  value: data.hero.activeDevelopers.toLocaleString(),
                },
                {
                  label: "Queries this month",
                  value: data.hero.queriesThisMonth.toLocaleString(),
                },
                {
                  label: "Average response time",
                  value: `${data.hero.avgResponseTimeMs} ms`,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur"
                >
                  <p className="text-sm text-stone-400">{stat.label}</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <MetricsSection data={data} />

        <section className="border-t border-white/10 bg-stone-950 py-16">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <h2 className="text-2xl font-semibold text-white md:text-3xl">
              Want this data inside your own agent workflows?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-stone-400">
              Use the BuyWhere API for semantic product search, structured retrieval,
              and merchant-aware commerce actions.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/developers"
                className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Developer Quickstart
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
              >
                Query Singapore products in 5 minutes
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
