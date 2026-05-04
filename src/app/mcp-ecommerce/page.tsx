import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "MCP for Ecommerce: The Complete Guide to Product Search MCP Servers (2026)",
  description:
    "Learn how AI agents search real products, compare prices, and discover deals using MCP for ecommerce. Complete guide with setup instructions and real-world use cases.",
  alternates: {
    canonical: "https://buywhere.ai/mcp-ecommerce",
  },
  openGraph: {
    title: "MCP for Ecommerce: The Complete Guide to Product Search MCP Servers (2026)",
    description:
      "Learn how AI agents search real products, compare prices, and discover deals using MCP for ecommerce. Complete guide with setup instructions and real-world use cases.",
    type: "article",
    url: "https://buywhere.ai/mcp-ecommerce",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "@id": "https://buywhere.ai/mcp-ecommerce#article",
      headline: "MCP for Ecommerce: The Complete Guide to Product Search MCP Servers (2026)",
      description:
        "Learn how AI agents search real products, compare prices, and discover deals using MCP for ecommerce. Complete guide with setup instructions and real-world use cases.",
      url: "https://buywhere.ai/mcp-ecommerce",
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": "https://buywhere.ai/mcp-ecommerce",
      },
      author: { "@type": "Organization", "@id": "https://buywhere.ai/#organization", name: "BuyWhere", url: "https://buywhere.ai" },
      publisher: { "@type": "Organization", "@id": "https://buywhere.ai/#organization", name: "BuyWhere", url: "https://buywhere.ai" },
      datePublished: "2026-05-04",
      dateModified: "2026-05-04",
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://buywhere.ai/#software",
      name: "BuyWhere API",
      description:
        "A normalized, cross-merchant product catalog API and MCP server for AI agents. Enables product search, price comparison, availability checks, and merchant handoff across Singapore, Southeast Asia, and US markets.",
      applicationCategory: "CommerceApplication",
      operatingSystem: "All",
      browserRequirements: "Requires API access",
      url: "https://buywhere.ai",
      sameAs: [
        "https://github.com/BuyWhere/buywhere-mcp",
        "https://www.npmjs.com/package/@buywhere/mcp-server",
        "https://docs.buywhere.ai",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free tier with 100 req/min. Partner and enterprise tiers available." },
      author: { "@type": "Organization", "@id": "https://buywhere.ai/#organization", name: "BuyWhere", url: "https://buywhere.ai" },
    },
    {
      "@type": "Organization",
      "@id": "https://buywhere.ai/#organization",
      name: "BuyWhere",
      url: "https://buywhere.ai",
      description: "MCP commerce infrastructure for AI agents — normalized product catalog API and MCP server for cross-merchant product search and comparison.",
      foundingDate: "2025",
      sameAs: ["https://github.com/BuyWhere/buywhere-mcp", "https://www.npmjs.com/package/@buywhere/mcp-server", "https://docs.buywhere.ai"],
    },
    {
      "@type": "WebSite",
      "@id": "https://buywhere.ai/#website",
      url: "https://buywhere.ai",
      name: "BuyWhere — MCP Commerce Infrastructure for AI Agents",
      description: "MCP server and product catalog API for AI agents. Search, compare, and discover products across Singapore and Southeast Asia with one normalized API.",
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: "https://api.buywhere.ai/v1/search?q={search_term_string}" },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function McpEcommercePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Script id="structured-data" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(structuredData)}
      </Script>
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.12),_transparent_40%),linear-gradient(135deg,#0f172a_0%,#1e1b4b_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-emerald-200">
              MCP for Ecommerce
            </div>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              MCP for Ecommerce: The Complete Guide to Product Search MCP Servers
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              Learn how AI agents search real products, compare prices, and discover deals using MCP for ecommerce. Complete guide with setup instructions and real-world use cases.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/api-keys" className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100">
                Get Your Free API Key
              </Link>
              <Link href="/docs/quickstart" className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                Read the Docs
              </Link>
            </div>
            <div className="mt-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Quick Install</p>
              <pre className="inline-block rounded-xl bg-slate-950/80 px-5 py-3 font-mono text-sm text-blue-200">npx -y @buywhere/mcp-server</pre>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="prose prose-slate max-w-none">
            <p className="text-lg leading-8 text-slate-700">
              MCP (Model Context Protocol) has become the universal standard for AI agents to interact with tools and data. But <strong>ecommerce</strong> — the ability for AI agents to search real product catalogs, compare live prices, and find deals — has been the missing piece.
            </p>
            <p className="mt-4 text-lg leading-8 text-slate-700">
              This guide covers everything you need to know about using MCP for ecommerce product search, including the best tools, setup steps, and real-world use cases for AI agents that shop.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Overview</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">What Is an MCP Server for Ecommerce?</h2>
          <p className="mt-6 text-lg leading-8 text-slate-700">
            An MCP server for ecommerce is a standardized interface that lets AI agents (Claude, ChatGPT, Cursor, Copilot, custom agents) search, compare, and discover products across retailers and markets — returning structured, real-time data instead of scraped or hallucinated results.
          </p>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">The Problem</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Why Ecommerce MCP Matters for AI Agents</h2>
          <p className="mt-6 text-lg leading-8 text-slate-700">
            Before MCP for ecommerce, giving an AI agent shopping capabilities required:
          </p>
          <ul className="mt-6 list-disc space-y-4 pl-6 text-lg leading-8 text-slate-700">
            <li><strong>Web scraping</strong> — fragile, slow, often blocked</li>
            <li><strong>Manual API integration</strong> — building custom connectors for every marketplace</li>
            <li><strong>Hallucinated prices</strong> — the agent guesses, and you waste time verifying</li>
          </ul>
          <p className="mt-6 text-lg leading-8 text-slate-700">
            MCP solves all three problems with a single, standardized protocol.
          </p>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Options</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">The Best MCP for Ecommerce Options in 2026</h2>

          <div className="mt-10 rounded-2xl border border-indigo-200 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">BuyWhere MCP Server — The Commerce Layer for AI Agents</h3>
            <p className="mt-4 text-lg leading-8 text-slate-700">
              <Link href="https://buywhere.ai" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">BuyWhere</Link> is the leading MCP server for ecommerce product discovery, providing cross-border product search, price comparison, and multi-market access through a single MCP interface.
            </p>
            <pre className="mt-6 rounded-xl bg-slate-950 p-4 font-mono text-sm text-blue-200">npx -y @buywhere/mcp-server</pre>
            <h4 className="mt-8 text-lg font-semibold text-slate-900">Capabilities:</h4>
            <ul className="mt-4 list-disc space-y-3 pl-6 text-lg leading-8 text-slate-700">
              <li><strong>Product search</strong> across 50M+ products in 6 markets (Singapore, China, US, Japan, Korea, Australia)</li>
              <li><strong>Multi-retailer aggregation</strong> — Lazada, Shopee, Amazon, and more</li>
              <li><strong>Price comparison</strong> across markets in a single tool call</li>
              <li><strong>Deal discovery</strong> — active promotions and price drops</li>
              <li><strong>A2A protocol discovery</strong> via Agent Card at <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">buywhere.ai/.well-known/agent.json</code></li>
            </ul>
            <p className="mt-6 text-lg leading-8 text-slate-700">
              <strong>Setup time:</strong> 60 seconds. <Link href="/api-keys" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">Get your free API key</Link>.
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
            <h3 className="text-2xl font-bold text-slate-900">Platform-Specific Ecommerce MCP Servers</h3>
            <p className="mt-4 text-lg leading-8 text-slate-700">Several platforms offer MCP servers for their specific ecosystems:</p>
            <ul className="mt-4 list-disc space-y-3 pl-6 text-lg leading-8 text-slate-700">
              <li><strong>Shopify MCP</strong> — store-specific product and order management</li>
              <li><strong>WooCommerce MCP</strong> — WordPress-based store operations</li>
              <li><strong>BigCommerce MCP</strong> — enterprise store management</li>
            </ul>
            <p className="mt-4 text-lg leading-8 text-slate-500 italic">
              These are valuable for store management — but they don't help AI agents search and compare products across markets.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Setup</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Setup Guide</h2>

          <h3 className="mt-10 text-2xl font-bold text-slate-900">Claude Desktop</h3>
          <p className="mt-4 text-lg leading-8 text-slate-700">Add to <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">claude_desktop_config.json</code>:</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-5 font-mono text-sm leading-7 text-slate-100">{`{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_xxxx"
      }
    }
  }
}`}</pre>

          <h3 className="mt-10 text-2xl font-bold text-slate-900">Cursor / VS Code / Cline / OpenCode</h3>
          <p className="mt-4 text-lg leading-8 text-slate-700">Same configuration in your MCP settings file — just point at the BuyWhere MCP server.</p>

          <h3 className="mt-10 text-2xl font-bold text-slate-900">Verify It Works</h3>
          <p className="mt-4 text-lg leading-8 text-slate-700">Ask your agent:</p>
          <blockquote className="mt-6 rounded-r-2xl border-l-4 border-indigo-500 bg-indigo-50/70 px-5 py-4 text-lg italic leading-8 text-slate-700">
            &ldquo;Search for Sony WH-1000XM5 headphones and find the best price across Singapore, Japan, and the US&rdquo;
          </blockquote>
          <p className="mt-6 text-lg leading-8 text-slate-700">Your agent returns <strong>real, live prices</strong>:</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-5 font-mono text-sm leading-7 text-slate-100">{`Sony WH-1000XM5 (Singapore) — S$398 @ Lazada SG
Sony WH-1000XM5 (Japan)     — ¥32,800 @ Amazon JP
Sony WH-1000XM5 (US)        — $329.99 @ Amazon US`}</pre>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Use Cases</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Real-World Use Cases</h2>

          <div className="mt-10 space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h3 className="text-xl font-bold text-slate-900">Cross-Border Price Comparison</h3>
              <p className="mt-4 text-lg leading-8 text-slate-700">
                AI agents search multiple markets to find the best deal on electronics, factoring in currency conversion and estimated shipping.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h3 className="text-xl font-bold text-slate-900">Deal Hunting</h3>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-sm text-slate-100">{`{
  "market": "SG",
  "category": "electronics",
  "min_discount": 30
}`}</pre>
              <p className="mt-4 text-lg leading-8 text-slate-700">Returns every product with 30%+ off across retailers.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h3 className="text-xl font-bold text-slate-900">Product Research</h3>
              <p className="mt-4 text-lg leading-8 text-slate-700">
                Agents collect specs, prices, and availability across markets — then build a comparison table for the user.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8">
              <h3 className="text-xl font-bold text-slate-900">AI-to-AI Commerce</h3>
              <p className="mt-4 text-lg leading-8 text-slate-700">
                With A2A protocol support, one agent can discover BuyWhere autonomously, search products, and hand results to another agent for checkout.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Landscape</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">The Ecommerce MCP Landscape</h2>
          <p className="mt-6 text-lg leading-8 text-slate-700">The ecommerce MCP category is still emerging. As of 2026:</p>
          <ul className="mt-6 list-disc space-y-4 pl-6 text-lg leading-8 text-slate-700">
            <li><strong>BuyWhere</strong> is the only cross-market MCP server for product discovery</li>
            <li>Platform-specific servers (Shopify, WooCommerce, BigCommerce) serve store management, not product search</li>
            <li>The category is wide open — first movers are defining how AI agents shop</li>
          </ul>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Architecture</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Architecture Overview</h2>
          <p className="mt-6 text-lg leading-8 text-slate-700">BuyWhere's MCP server exposes five core tools:</p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tool</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {[
                  { tool: "search_products", desc: "Natural language product search", output: "Structured product list" },
                  { tool: "get_product", desc: "Full product details by ID", output: "Specs, price, availability" },
                  { tool: "compare_products", desc: "Side-by-side comparison", output: "Comparison table" },
                  { tool: "get_deals", desc: "Active promotions and price drops", output: "Deal list with discounts" },
                  { tool: "list_categories", desc: "Category taxonomy", output: "Category tree" },
                ].map((row) => (
                  <tr key={row.tool}>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-600">{row.tool}</td>
                    <td className="px-4 py-3 text-slate-600">{row.desc}</td>
                    <td className="px-4 py-3 text-slate-600">{row.output}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-lg leading-8 text-slate-700">
            Each tool returns structured JSON — LLMs parse and reason over the data without custom parsing code.
          </p>
        </div>
      </section>

      <section className="bg-indigo-600 py-20 text-white">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold">Try It Now</h2>
          <ol className="mt-8 mx-auto max-w-lg text-left list-decimal space-y-4 pl-6 text-lg leading-8 text-indigo-100">
            <li><strong className="text-white">Get your free API key:</strong> <Link href="/api-keys" className="underline decoration-indigo-300 underline-offset-4">buywhere.ai/api-keys</Link></li>
            <li><strong className="text-white">Install:</strong> <code className="rounded bg-white/15 px-2 py-0.5 font-mono text-sm">npx -y @buywhere/mcp-server</code></li>
            <li><strong className="text-white">Ask your agent:</strong> <em>&ldquo;Search for the best laptop deals across Singapore, Japan, and the US&rdquo;</em></li>
          </ol>
          <p className="mt-8 text-xl font-semibold text-indigo-100">The first AI agent to search real ecommerce data wins. Make it yours.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/api-keys" className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50">
              Get Started Free
            </Link>
            <Link href="/docs/quickstart" className="inline-flex items-center justify-center rounded-xl border border-indigo-400 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
              Read the Docs
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-10 text-center">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="text-sm text-slate-400">
            <em>Built with TypeScript and MCP SDK. MIT licensed.</em>
          </p>
          <p className="mt-2 text-sm text-slate-400">
            <Link href="https://github.com/buywhere/buywhere-mcp" className="underline decoration-slate-300 underline-offset-4 hover:text-slate-600">GitHub</Link>
            {" | "}
            <Link href="/docs" className="underline decoration-slate-300 underline-offset-4 hover:text-slate-600">Docs</Link>
            {" | "}
            <Link href="/api-keys" className="underline decoration-slate-300 underline-offset-4 hover:text-slate-600">API Keys</Link>
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
