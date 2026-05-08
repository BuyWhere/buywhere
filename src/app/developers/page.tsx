import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { TrustLayer } from "@/components/TrustLayer";

export const metadata: Metadata = {
  title: "Developer Portal — BuyWhere MCP & API for AI Agents",
  description:
    "BuyWhere gives AI agents a product catalog layer for live product discovery, comparison, and merchant handoff starting in Singapore, expanding across Southeast Asia.",
  alternates: {
    canonical: "https://buywhere.ai/developers",
  },
};

const mcpConfig = `{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_your_key_here"
      }
    }
  }
}`;

const curlExample = `curl -sS "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
  -H "Authorization: Bearer bw_live_your_key_here"`;

export default function DevelopersPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://buywhere.ai/developers#faq",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is MCP (Model Context Protocol)?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "MCP (Model Context Protocol) is an open standard that lets AI models call external tools through a standardized interface. Instead of hardcoding API calls, an MCP server exposes tools that any MCP-compatible client can discover and use. Think of it as 'USB for AI tools' — one integration works across all MCP clients."
        }
      },
      {
        "@type": "Question",
        name: "How does BuyWhere use MCP?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere exposes its product catalog API as MCP tools. When you configure @buywhere/mcp-server in Claude Desktop, Cursor, or any MCP client, the client can call tools like search_products and get_deals without you writing any API integration code."
        }
      },
      {
        "@type": "Question",
        name: "What MCP tools does BuyWhere expose?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere exposes six MCP tools: search_products (full-text product search across all merchants), get_product (product details by ID), compare_products (side-by-side comparison), get_deals (find discounted products), list_categories (browse categories), and find_best_price (cheapest current listing across merchants)."
        }
      },
      {
        "@type": "Question",
        name: "Which MCP clients support BuyWhere?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Any MCP-compatible client works. Tested and documented: Claude Desktop (Anthropic), Cursor, Cline, Windsurf, VS Code (with MCP extension), LangChain, CrewAI, AutoGen, and LlamaIndex."
        }
      },
      {
        "@type": "Question",
        name: "Do I need a credit card to start with BuyWhere?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. The BuyWhere free tier includes 1,000 API calls per month with no time limit and no credit card required."
        }
      },
      {
        "@type": "Question",
        name: "What countries does BuyWhere support?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere covers Singapore (SGD), United States (USD), Malaysia (MYR), Thailand (THB), Vietnam (VND), Philippines (PHP), and Indonesia (IDR) — with more markets planned."
        }
      },
      {
        "@type": "Question",
        name: "Can I use BuyWhere without MCP?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. The same product catalog is available via REST API at api.buywhere.ai/v1. MCP is an optional wrapper that makes the tools available to AI agents with zero custom integration code."
        }
      },
      {
        "@type": "Question",
        name: "How do I debug MCP tool calls?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Most MCP clients log tool calls and responses. For Claude Desktop, check the developer console. For Cursor, the MCP settings panel shows server logs. You can also test directly with: npx -y @buywhere/mcp-server --verbose"
        }
      }
    ]
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Script id="faq-schema" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqSchema)}
      </Script>
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.15),_transparent_40%),linear-gradient(135deg,#0f172a_0%,#1e1b4b_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-indigo-200">
            Developer Portal
          </div>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            Launch your shopping agent with one clear setup path.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
            BuyWhere gives AI agents a product catalog layer for live product discovery, comparison, and merchant handoff starting in Singapore, expanding across Southeast Asia.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
            Start with one API request, then add the published MCP package when you want BuyWhere tools inside Claude Desktop, Cursor, or another MCP client.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/api-keys"
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
            >
              Get API key
            </Link>
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Start in 5 minutes
            </Link>
          </div>
        </div>
      </section>

      {/* Stat strip */}
      <section className="bg-indigo-950 text-indigo-100 py-4">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm font-medium text-center">
            <span>3.7M+ products</span>
            <span className="hidden sm:block text-indigo-600">·</span>
            <span>7 SG retailers</span>
            <span className="hidden sm:block text-indigo-600">·</span>
            <span>Real-time pricing</span>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">REST API</p>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">Canonical onboarding endpoint</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              The shortest path to activation is one authenticated request to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">GET https://api.buywhere.ai/v1/products/search</code>.
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
              <pre className="overflow-x-auto p-4 text-sm leading-6 text-gray-100">
                <code>{curlExample}</code>
              </pre>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">MCP package</p>
            <h2 className="mt-3 text-2xl font-bold text-slate-900">Package-based MCP setup</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Use the published MCP package instead of the hosted MCP URL on public onboarding surfaces.
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
              <pre className="overflow-x-auto p-4 text-sm leading-6 text-gray-100">
                <code>{mcpConfig}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/api-keys" className="rounded-2xl border border-slate-200 bg-slate-50 p-6 transition-colors hover:border-indigo-200 hover:bg-indigo-50">
              <p className="text-sm font-semibold text-slate-900">1. Get API key</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Create a working key instantly with the self-serve flow.</p>
            </Link>
            <Link href="/quickstart" className="rounded-2xl border border-slate-200 bg-slate-50 p-6 transition-colors hover:border-indigo-200 hover:bg-indigo-50">
              <p className="text-sm font-semibold text-slate-900">2. Follow quickstart</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Run your first search request, then branch into the right integration path.</p>
            </Link>
            <Link href="/integrate" className="rounded-2xl border border-slate-200 bg-slate-50 p-6 transition-colors hover:border-indigo-200 hover:bg-indigo-50">
              <p className="text-sm font-semibold text-slate-900">3. Add MCP</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Use the package-based MCP setup for Claude Desktop, Cursor, and custom agents.</p>
            </Link>
          </div>
        </div>
      </section>

      <TrustLayer />
      <Footer />
    </div>
  );
}
