"use client";

import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { useDeveloperAuth } from "@/lib/developer-auth";

export default function SavedSearchesPage() {
  const { developer, isAuthenticated, status } = useDeveloperAuth();

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#1d4ed8_52%,#312e81_100%)] py-14 text-white dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
            Saved searches
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Reopen your highest-signal catalog queries faster.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-indigo-100 sm:text-base">
            Saved search persistence is being finalized. This page is ready for authenticated navigation now, with the search management UI landing next.
          </p>
        </div>
      </section>

      <section className="flex-1 bg-slate-50 py-10 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="space-y-6 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
            <DashboardSidebar />
            <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
              {!isAuthenticated ? (
                <>
                  <div className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    Session required
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
                    Sign in to access saved searches.
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                    The shared navigation now detects your developer session and routes saved-search access here. Sign in with your BuyWhere API key to continue.
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/login?next=%2Fsaved-searches"
                      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                    >
                      {status === "loading" ? "Checking session..." : "Sign in"}
                    </Link>
                    <Link
                      href="/api-keys"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      Create API key
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    Signed in
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
                    Save your searches to re-run them with one click.
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Signed in as <span className="font-semibold text-slate-900 dark:text-white">{developer?.email}</span>. Start searching to build your saved searches.
                  </p>
                  <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-950">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No saved searches yet</h3>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Search for products and save your queries to access them quickly later.
                    </p>
                  </div>
                  <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <Link
                      href="/search"
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
                    >
                      Browse search results
                    </Link>
                    <Link
                      href="/alerts"
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
                    >
                      Manage alert subscriptions
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
