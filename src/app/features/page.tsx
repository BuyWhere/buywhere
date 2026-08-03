import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Features — BuyWhere",
  description:
    "Agent-first product catalog, real-time availability, normalized data, MCP server, and multi-region coverage — built for AI shopping agents.",
  path: "/features/",
});

const features = [
  {
    title: "Agent-first API",
    description:
      "REST endpoints return structured JSON with product, merchant, price, and availability fields — designed for LLM reasoning and tool calling.",
  },
  {
    title: "MCP server",
    description:
      "Add BuyWhere tools directly to Claude Desktop, Cursor, Windsurf, and any MCP client with one npx command.",
  },
  {
    title: "Location-aware ranking",
    description:
      "Pass deliver_to with a country code and receive results ranked by what can actually reach your user: local, ships_to_you, or unavailable.",
  },
  {
    title: "Normalized product schema",
    description:
      "One consistent schema across 158,000+ storefronts. No brittle parsing, no site-specific adapters, no cleaning boilerplate.",
  },
  {
    title: "Sub-250ms search",
    description:
      "Low-latency semantic and keyword search across 288M+ products, backed by purpose-built indexing and strict query plans.",
  },
  {
    title: "Price comparisons & history",
    description:
      "Compare merchant offers for the same product and query historical price trends to surface deals and price-drop alerts.",
  },
  {
    title: "SDKs & compact mode",
    description:
      "Official Python, LangChain, and OpenAI-tools SDKs. Use compact=true to reduce context-window usage inside agent loops.",
  },
  {
    title: "Developer dashboard",
    description:
      "Track usage, rotate keys, manage alerts, and monitor catalog health from a single developer portal.",
  },
];

export default function FeaturesPage() {
  const schema = buildWebPageSchema({
    path: "/features",
    name: "Features — BuyWhere",
    description:
      "Agent-first product catalog, real-time availability, normalized data, MCP server, and multi-region coverage — built for AI shopping agents.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Features", path: "/features" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <main id="main-content" role="main" tabIndex={-1} aria-label="Main content">
          {/* Hero */}
          <section className="bg-indigo-600 text-white py-20">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="max-w-3xl">
                <h1 className="text-4xl sm:text-5xl font-bold mb-6">
                  Built for AI shopping agents
                </h1>
                <p className="text-xl text-indigo-100 leading-relaxed">
                  Everything you need to answer product questions with real data instead of hallucinated recommendations.
                </p>
              </div>
            </div>
          </section>

          {/* Feature grid */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {features.map((f, index) => (
                  <div
                    key={f.title}
                    className="p-6 rounded-xl border border-gray-100 hover:border-indigo-100 hover:shadow-md transition-all"
                  >
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold mb-4">
                      0{index + 1}
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-3">{f.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-20 bg-gray-50 border-t border-gray-100">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Start building with BuyWhere
              </h2>
              <p className="text-gray-500 mb-8 text-lg">
                Request beta access and get your first product query running in minutes.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  Request API access →
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  See pricing
                </Link>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
