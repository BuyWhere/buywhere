import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "BuyWhere for AI Agents",
  description:
    "Product behavior documentation for AI agents using BuyWhere: ranking, price comparison, availability, merchant selection, tool mapping, and machine-relevant metrics.",
  alternates: {
    canonical: "https://buywhere.ai/agents",
  },
};

const flowSteps = [
  {
    title: "Query",
    body: "Your agent sends a product intent such as 'best headphones under $100' or 'where can I buy an air fryer today?'.",
  },
  {
    title: "Resolve",
    body: "BuyWhere converts that intent into ranked products, current prices, trusted merchants, availability, and direct purchase options.",
  },
  {
    title: "Rank",
    body: "Results are scored using price competitiveness, match quality, merchant reliability, availability, and freshness.",
  },
  {
    title: "Present",
    body: "Your agent receives structured options with buywhere_score and confidence so it can explain or select the best fit.",
  },
  {
    title: "Purchase",
    body: "The user completes checkout on the merchant site. BuyWhere helps close the research loop, not process payment.",
  },
];

const rankingFactors = [
  ["Price competitiveness", "35%"],
  ["Product match quality", "25%"],
  ["Merchant reliability", "20%"],
  ["Availability", "15%"],
  ["Freshness", "5%"],
];

const sortOptions = ["best_match", "best_value", "lowest_price", "highest_rated", "fastest_delivery"];

const behaviorCards = [
  {
    title: "Price comparison",
    body: "Prices are normalized to SGD for Singapore queries, shipping is included when available, and comparison output can include lowest, highest, and median price points.",
  },
  {
    title: "Availability",
    body: "Status values include in_stock, low_stock, backorder, out_of_stock, and discontinued. Availability is checked at query time and can change quickly.",
  },
  {
    title: "Merchant selection",
    body: "Merchants are selected using data quality, reliability, coverage, and affiliate status rather than paid placement.",
  },
];

const callMapping = [
  ["recommend / best / what to buy", "resolve_product_query"],
  ["cheapest / best deal", "find_best_price"],
  ["A vs B / compare", "compare_products"],
  ["where to buy / purchase", "get_purchase_options"],
  ["product details", "get_product_details"],
  ["in stock / available", "resolve_product_query with filter"],
];

const toolSelection = [
  ["resolve_product_query", "Open-ended product discovery"],
  ["find_best_price", "Price-focused deal finding"],
  ["compare_products", "A vs B decisions"],
  ["get_product_details", "Deep dive on a specific item"],
  ["get_purchase_options", "Ready-to-buy merchant selection"],
];

const metrics = [
  {
    title: "Latency targets",
    rows: [
      ["P50", "< 150ms"],
      ["P95", "< 350ms"],
      ["P99", "< 600ms"],
      ["Timeout", "5s"],
    ],
  },
  {
    title: "Accuracy targets",
    rows: [
      ["Intent classification", "> 95%"],
      ["Price accuracy", "> 99%"],
      ["Availability accuracy", "> 92%"],
    ],
  },
  {
    title: "Coverage",
    rows: [
      ["Singapore products", "850K+"],
      ["Categories", "150+"],
      ["Merchants", "60+"],
    ],
  },
  {
    title: "Freshness",
    rows: [
      ["Prices", "Every 6h"],
      ["Availability", "Every 30m"],
      ["New products", "Daily"],
    ],
  },
];

export default function AgentsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <main className="flex-1">
        <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_28%),linear-gradient(135deg,#0f172a_0%,#111827_56%,#172554_100%)] text-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Agent Documentation
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
                How BuyWhere behaves when your agent needs product answers
              </h1>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                BuyWhere turns shopping intent into ranked products, current prices, trusted merchants, availability,
                and purchase-ready options. This page documents when agents should call BuyWhere, how results are
                ranked, and what performance signals to expect.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                >
                  Get API key
                </Link>
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Start quickstart
                </Link>
                <Link
                  href="/developers"
                  className="inline-flex items-center justify-center rounded-xl border border-indigo-300/25 bg-indigo-300/10 px-5 py-3 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-300/20"
                >
                  Developer portal
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Query to purchase</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">The flow your agent can rely on</h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                BuyWhere is designed for product-resolution tasks, not generic web search. The API is optimized for
                structured shopping decisions that need explanation, comparison, and a direct next step.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-5">
              {flowSteps.map((step, index) => (
                <div key={step.title} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Step {index + 1}</p>
                  <h3 className="mt-3 text-lg font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Ranking logic</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">How `best_value` works</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Each result includes `buywhere_score` and `confidence` values on a `0.0-1.0` scale. The default
                ranking model balances value and reliability instead of promoting paid listings.
              </p>
              <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Factor</th>
                      <th className="px-4 py-3 font-semibold">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {rankingFactors.map(([factor, weight]) => (
                      <tr key={factor}>
                        <td className="px-4 py-3 text-slate-700">{factor}</td>
                        <td className="px-4 py-3 text-slate-600">{weight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-8 text-white shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Supported sorts</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {sortOptions.map((option) => (
                  <span
                    key={option}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200"
                  >
                    {option}
                  </span>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-5">
                <p className="text-sm font-semibold text-cyan-200">Merchant reliability model</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Merchant reliability blends fulfillment rate (40%), return rate (30%), average rating (20%), and
                  response time (10%).
                </p>
              </div>
              <p className="mt-6 text-sm leading-7 text-slate-400">
                Use `best_value` when your agent needs the strongest overall recommendation. Switch to `lowest_price`
                or `fastest_delivery` only when the user intent is explicit.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Behavior details</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">What BuyWhere returns and what it does not</h2>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {behaviorCards.map((card) => (
                <div key={card.title} className="rounded-[28px] border border-slate-200 bg-slate-50 p-7 shadow-sm">
                  <h3 className="text-xl font-semibold text-slate-900">{card.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{card.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-[28px] border border-amber-200 bg-amber-50 p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Important limitation</p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-amber-900">
                Availability is checked at query time, not continuously, and BuyWhere does not process checkout.
                Agents should link users to the merchant page for final stock, shipping, and payment confirmation.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Intent mapping</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">When your agent should call BuyWhere</h2>
              <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold">User says...</th>
                      <th className="px-4 py-3 font-semibold">Call</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {callMapping.map(([intent, call]) => (
                      <tr key={intent}>
                        <td className="px-4 py-3 text-slate-700">{intent}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{call}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-8 text-white shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Tool selection</p>
              <h2 className="mt-3 text-3xl font-bold">Which call fits which job</h2>
              <div className="mt-6 space-y-3">
                {toolSelection.map(([tool, description]) => (
                  <div key={tool} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-mono text-sm text-cyan-200">{tool}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Machine-relevant metrics</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">Operational targets for agent builders</h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                These targets help agents decide whether BuyWhere is appropriate for latency-sensitive shopping,
                comparison, and purchase-intent workflows.
              </p>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((section) => (
                <div key={section.title} className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">{section.title}</h3>
                  <dl className="mt-5 space-y-3">
                    {section.rows.map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
                        <dt className="text-sm text-slate-500">{label}</dt>
                        <dd className="text-sm font-semibold text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[linear-gradient(135deg,#0f172a_0%,#111827_60%,#1d4ed8_100%)] py-16 text-white">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Next action</p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">Use BuyWhere when your agent needs a buying answer, not another search result page</h2>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-300">
              Start with the quickstart for your first request, then plug BuyWhere into MCP or your own API client once
              the behavior model fits your shopping workflow.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Start quickstart
              </Link>
              <Link
                href="/integrate"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                View MCP setup
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
