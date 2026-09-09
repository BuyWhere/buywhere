import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ServerSideLoginForm from "@/components/ServerSideLoginForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <Nav />
      <main id="main-content" className="flex-1 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_38%),linear-gradient(180deg,#f8fafc_0%,#ffffff_42%,#eef2ff_100%)] py-16 dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]">
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

              {/* Server-rendered login form */}
              <ServerSideLoginForm />
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