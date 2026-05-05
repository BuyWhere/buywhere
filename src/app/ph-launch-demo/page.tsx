import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "BuyWhere Demo — Product Catalog API for AI Agents",
  description:
    "See BuyWhere in action. Query 50M+ products across 6 markets with real-time pricing. Built for AI agents.",
  alternates: {
    canonical: "https://buywhere.ai/ph-launch-demo",
  },
};

const features = [
  {
    icon: "🌏",
    title: "6 markets, one API",
    desc: "US, Singapore, Malaysia, Indonesia, Thailand, Philippines — normalized product data across Southeast Asia and beyond.",
  },
  {
    icon: "📦",
    title: "50M+ products indexed",
    desc: "Structured catalog data from Amazon, Walmart, Lazada, Shopee, Best Denki, and more major retailers.",
  },
  {
    icon: "⚡",
    title: "Real-time pricing",
    desc: "Live price, availability, and merchant data. No stale cache — your agent always sees the current state.",
  },
  {
    icon: "🤖",
    title: "Built for AI agents",
    desc: "MCP-native, JSON responses, semantic search, and normalized schemas that LLMs can reason over directly.",
  },
  {
    icon: "🔍",
    title: "Semantic product search",
    desc: "Natural language queries, category filters, cross-market comparison — structured JSON back every time.",
  },
  {
    icon: "🔗",
    title: "MCP & REST",
    desc: "Use the Model Context Protocol for native agent integration, or call the REST API directly from any stack.",
  },
];

const terminalLines = [
  { prefix: "$", text: "pip install buywhere-mcp" },
  { prefix: "$", text: 'export BUYWHERE_API_KEY="bw_live_your_key"' },
  { prefix: ">>>", text: "import buywhere_mcp" },
  { prefix: ">>>", text: 'result = buywhere_mcp.search("wireless headphones", limit=3)' },
  { prefix: "", text: "" },
  { prefix: "←", text: '1. Sony WH-1000XM5 — $248.00 (Amazon US)' },
  { prefix: "←", text: '2. Samsung Galaxy Buds3 — $179.00 (Lazada SG)' },
  { prefix: "←", text: '3. JBL Tune 770NC — S$129.00 (Shopee SG)' },
];

const codeSnippet = `curl -sS "https://api.buywhere.ai/v1/search?q=vaccum+cleaner&limit=3" \\
  -H "Authorization: Bearer bw_live_your_key" | jq '.items[] | {name, price, currency, source}'`;

export default function PhLaunchDemoPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <div className="bg-amber-50 border-b border-amber-200 text-sm text-center py-2 px-4">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-amber-800">🚀</span>
          <span className="text-amber-900 font-medium">We&apos;re live on Product Hunt!</span>
          <a
            href="https://www.producthunt.com/posts/buywhere-mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 underline hover:text-amber-900 ml-1 font-medium"
          >
            Upvote us
          </a>
          <span className="text-amber-600">·</span>
          <span className="text-amber-700">npx -y @buywhere/mcp-server</span>
        </span>
      </div>

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 text-white/90 text-sm font-medium px-3 py-1 rounded-full mb-6">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                Product Hunt Launch Demo
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-6">
                Product search infrastructure for AI agents.
              </h1>
              <p className="text-lg text-indigo-200 mb-8 leading-relaxed">
                Query real products across 6 markets with one API. Built for LLMs, MCP-native, no scraping required.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
                >
                  Try it now →
                </Link>
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center px-6 py-3 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-colors border border-white/20"
                >
                  Get started
                </Link>
              </div>
            </div>

            {/* Terminal demo embed */}
            <div className="bg-gray-900 rounded-xl overflow-hidden shadow-2xl border border-gray-700">
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 border-b border-gray-700">
                <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                <span className="ml-2 text-xs text-gray-400 font-mono">terminal — buywhere demo</span>
              </div>
              <div className="p-4 font-mono text-sm leading-relaxed">
                {terminalLines.map((line, i) => (
                  <div key={i} className="flex gap-2">
                    {line.prefix ? (
                      <>
                        <span className={
                          line.prefix === "$" ? "text-green-400" :
                          line.prefix === ">>>" ? "text-blue-400" :
                          "text-purple-400"
                        }>
                          {line.prefix}
                        </span>
                        <span className={line.prefix === "←" ? "text-gray-200" : "text-gray-300"}>
                          {line.text}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-600">&nbsp;</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Video embed placeholder — insert asciinema cast URL here */}
            <div className="md:col-span-2 -mt-4">
              <div className="bg-indigo-800/40 border border-indigo-500/30 rounded-lg px-4 py-3 text-sm text-indigo-200 text-center">
                🎬 <span className="font-medium">60s terminal demo:</span>{" "}
                Watch the full walkthrough{" "}
                <a href="#" className="text-indigo-300 underline hover:text-white">here</a>{" "}
                (asciinema cast) — install, search, compare across markets in under a minute.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Key features */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Everything your agent needs to shop across markets
            </h2>
            <p className="text-lg text-gray-500 max-w-3xl mx-auto">
              One API gives you normalized product data, real-time pricing, and cross-market coverage — no scraping, no brittle parsers, no platform bias.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-6 rounded-xl border border-gray-100 hover:border-indigo-100 hover:shadow-md transition-all"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code demo */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-start gap-12">
            <div className="flex-1 text-white">
              <h2 className="text-2xl font-bold mb-4">One curl, 50M+ products</h2>
              <p className="text-gray-400 mb-6">
                Search, filter, and compare across markets with a single HTTP request. Structured JSON back every time.
              </p>
              <Link
                href="/quickstart"
                className="inline-flex items-center text-indigo-400 font-medium hover:text-indigo-300 transition-colors"
              >
                View quickstart →
              </Link>
            </div>
            <div className="flex-1 w-full">
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                  <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                  <span className="ml-2 text-xs text-gray-500 font-mono">search.sh</span>
                </div>
                <pre className="p-4 text-sm text-gray-300 font-mono overflow-x-auto leading-relaxed">
                  <code>{codeSnippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 bg-white border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { stat: "50M+", label: "Products indexed" },
              { stat: "6", label: "Markets covered" },
              { stat: "< 200ms", label: "Median query latency" },
              { stat: "99.9%", label: "API uptime target" },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold text-indigo-600 mb-1">{s.stat}</div>
                <div className="text-sm text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-indigo-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Ship product-aware agents without building a catalog pipeline.</h2>
          <p className="text-indigo-200 mb-8 text-lg">
            Whether you are building an MCP-powered shopping assistant, a price comparison tool, or a cross-market product search — BuyWhere gives you the product layer to launch faster.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/api-keys"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors text-lg"
            >
              Try it now
            </Link>
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center px-8 py-4 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-lg"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
