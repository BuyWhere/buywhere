import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "BuyWhere US Quickstart — Preview",
  description: "Get early access to BuyWhere's US product catalog API. Sign up for the US preview and be first when we launch.",
  alternates: {
    canonical: toSiteUrl("/quickstart/us"),
  },
};

export default function QuickstartUSPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.18),_transparent_38%),linear-gradient(135deg,#0f172a_0%,#111827_48%,#1e1b4b_100%)] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-20 sm:px-6">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
              United States — Preview
            </div>
            <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
              BuyWhere for US markets is coming soon.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              We&apos;re expanding BuyWhere&apos;s agent-native product catalog to the United States. Sign up to get early access when the US catalog launches.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
              In the meantime, our Singapore catalog is live and ready. Start building today with SG coverage and migrate your integration to US data with zero API changes when we launch.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Get early access
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Singapore quickstart (live)
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="text-xs font-medium uppercase tracking-[0.15em] text-slate-500">Region:</span>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/quickstart"
                className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                Singapore — Live
              </Link>
              <Link
                href="/quickstart/us"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                United States — Preview
              </Link>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                SEA — Coming soon
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="rounded-3xl border border-amber-100 bg-amber-50 p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">US Preview</p>
              <h2 className="mt-3 text-2xl font-bold text-slate-900">What to expect</h2>
              <ul className="mt-6 space-y-4 text-sm leading-7 text-slate-700">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-bold">1</span>
                  <span>Same REST API and MCP interface as Singapore — no integration changes needed when we launch US data.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-bold">2</span>
                  <span>Coverage across major US retailers including Amazon, Best Buy, Walmart, and Target.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-bold">3</span>
                  <span>USD pricing, US availability signals, and merchant attribution out of the box.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-bold">4</span>
                  <span>Early access subscribers get first invite, a dedicated onboarding call, and extended free tier.</span>
                </li>
              </ul>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Start now with Singapore</p>
              <h2 className="mt-3 text-2xl font-bold text-slate-900">Don&apos;t wait — build today</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                The BuyWhere API is live and production-ready for Singapore. Get your key now, build your integration, and switch to US data by changing one parameter when we launch.
              </p>
              <div className="mt-6 rounded-2xl bg-slate-50 p-4 font-mono text-xs text-slate-700">
                <p className="text-slate-400">{`// Switch from SG to US with one param change`}</p>
                <p className="mt-1">GET /v1/products/search</p>
                <p className="ml-4 text-slate-500">?q=wireless+headphones</p>
                <p className="ml-4 text-green-700">&amp;country_code=US <span className="text-slate-400">← add this</span></p>
              </div>
              <div className="mt-6 flex flex-col gap-3">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Get free API key (Singapore)
                </Link>
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  View Singapore quickstart
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Questions about US access?</h2>
          <p className="mt-3 text-slate-600">
            Reach out and we&apos;ll let you know the timeline and priority access options.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Contact us
            </Link>
            <a
              href="https://api.buywhere.ai/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              API documentation
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
