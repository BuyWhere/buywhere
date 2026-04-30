"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { Auth } from "@/lib/auth";
import { persistDeveloperSession } from "@/lib/developer-session";

const USE_CASES = [
  "AI shopping assistant",
  "Price comparison tool",
  "Affiliate recommendation engine",
  "E-commerce analytics",
  "LangChain / CrewAI agent",
  "Other",
];

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await Auth.register({
        agent_name: name,
        email,
        use_case: useCase || undefined,
      });
      const rawKey = data.api_key;
      await persistDeveloperSession(rawKey);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />
      <main className="flex-1 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_38%),linear-gradient(180deg,#f8fafc_0%,#ffffff_42%,#eef2ff_100%)] dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                Developer access
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                Create your BuyWhere account
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                Get instant API access with a free key. No approval required — start building in minutes.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Your name</span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">What are you building?</span>
                  <select
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
                  >
                    <option value="">Select a use case (optional)</option>
                    {USE_CASES.map((uc) => (
                      <option key={uc} value={uc}>{uc}</option>
                    ))}
                  </select>
                </label>

                {error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Creating account...
                    </>
                  ) : (
                    "Get free API key →"
                  )}
                </button>

                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  Already have a key?{" "}
                  <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-300">
                    Sign in
                  </Link>
                </p>
              </form>
            </section>

            <section className="rounded-[32px] border border-slate-200 bg-slate-950 p-8 text-white shadow-sm dark:border-slate-800">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200">
                What you get
              </div>
              <div className="mt-6 space-y-4">
                {[
                  "Free API key instantly — no credit card required",
                  "1,000 requests/day on the free tier",
                  "Access to product search for US + SEA markets",
                  "Quickstart guides and MCP integration help",
                  "Email support at hello@buywhere.ai",
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200">
                  Best next step
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  After you get your key, follow the{" "}
                  <Link href="/quickstart" className="text-indigo-300 hover:underline">
                    quickstart
                  </Link>{" "}
                  to make your first authenticated request.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}