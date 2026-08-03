import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "MCP Server — BuyWhere Developers",
  description:
    "Add the BuyWhere MCP server to Claude, Cursor, or any MCP client and give your AI agent product search, comparison, and merchant handoff tools.",
  path: "/developers/mcp/",
});

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

export default function McpDevelopersPage() {
  const schema = buildWebPageSchema({
    path: "/developers/mcp",
    name: "MCP Server — BuyWhere Developers",
    description:
      "Add the BuyWhere MCP server to Claude, Cursor, or any MCP client and give your AI agent product search, comparison, and merchant handoff tools.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Developers", path: "/developers" },
      { name: "MCP Server", path: "/developers/mcp" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <main id="main-content" role="main" tabIndex={-1} aria-label="Main content">
          <section className="bg-indigo-950 text-white py-20">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="max-w-3xl">
                <h1 className="text-4xl sm:text-5xl font-bold mb-6">
                  BuyWhere MCP Server
                </h1>
                <p className="text-xl text-indigo-100 leading-relaxed">
                  Give your AI agent native product tools: search, compare, and merchant handoff with one normalized catalog.
                </p>
              </div>
            </div>
          </section>

          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="grid lg:grid-cols-2 gap-12 items-start">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    One config line
                  </h2>
                  <p className="text-gray-600 mb-6">
                    Add the BuyWhere MCP server to your client configuration and restart. The server exposes tools like <code>search_products</code>, <code>compare_products</code>, and <code>get_product</code> that agents can call directly.
                  </p>
                  <ul className="space-y-3 text-gray-600 mb-8">
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>No backend code required — works inside Claude Desktop, Cursor, Windsurf, and any MCP host.</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>Structured tool responses the model can reason about.</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>Location-aware ranking with deliver_to and availability labels.</span>
                    </li>
                  </ul>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      href="/quickstart"
                      className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                    >
                      Quickstart →
                    </Link>
                    <Link
                      href="/developers"
                      className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Back to developer portal
                    </Link>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                    <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                    <span className="ml-2 text-xs text-gray-300 font-mono">mcp-config.json</span>
                  </div>
                  <pre className="p-4 text-sm text-gray-200 font-mono overflow-x-auto leading-relaxed">
                    <code>{mcpConfig}</code>
                  </pre>
                </div>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
