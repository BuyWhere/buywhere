"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { Auth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = searchParams?.get("next") || "/dashboard";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!apiKey.trim()) {
      setError("Enter a BuyWhere API key to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await Auth.login(apiKey.trim());
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to start a dashboard session right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />
      <main className="flex-1 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_38%),linear-gradient(180deg,#f8fafc_0%,#ffffff_42%,#eef2ff_100%)] py-16 dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                Developer access
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                Sign in to the developer dashboard
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                Paste an existing BuyWhere API key to open `/dashboard`, manage rotation, and inspect current usage without emailing support.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="bw_live_xxxxxxxxxxxxxxxxx"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
                  />
                </label>

                {error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {submitting ? "Starting session..." : "Open dashboard"}
                </button>
              </form>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Create a new key
                </Link>
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center rounded-xl text-sm font-semibold text-indigo-700 transition hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  View quickstart
                </Link>
              </div>
            </section>

            <section className="rounded-[32px] border border-slate-200 bg-slate-950 p-8 text-white shadow-sm dark:border-slate-800">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200">
                What you get
              </div>
              <div className="mt-6 space-y-4">
                {[
                  "Masked API key display with one-click copy.",
                  "Self-service key rotation with a visible rollover window.",
                  "Daily and monthly request usage without leaving the product.",
                  "Quick links for docs, quickstart, and MCP setup.",
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
