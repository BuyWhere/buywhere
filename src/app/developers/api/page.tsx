import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "REST API — BuyWhere Developers",
  description:
    "Search, compare, and retrieve products across 158,000+ storefronts with the BuyWhere REST API. One schema, one key, multi-region.",
  path: "/developers/api/",
});

const curlExample = `curl -sS "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
  -H "Authorization: Bearer bw_live_your_key_here"`;

export default function ApiDevelopersPage() {
  const schema = buildWebPageSchema({
    path: "/developers/api",
    name: "REST API — BuyWhere Developers",
    description:
      "Search, compare, and retrieve products across 158,000+ storefronts with the BuyWhere REST API. One schema, one key, multi-region.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Developers", path: "/developers" },
      { name: "REST API", path: "/developers/api" },
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
                  BuyWhere REST API
                </h1>
                <p className="text-xl text-indigo-100 leading-relaxed">
                  One normalized product layer for AI agents. Search, compare, and retrieve products across Singapore, Southeast Asia, and the US.
                </p>
              </div>
            </div>
          </section>

          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="grid lg:grid-cols-2 gap-12 items-start">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    Your first API call
                  </h2>
                  <p className="text-gray-600 mb-6">
                    Send a Bearer token with every request. The response includes normalized products with prices, merchants, images, and availability labels.
                  </p>
                  <ul className="space-y-3 text-gray-600 mb-8">
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>Sub-250ms search across 288M+ products.</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>Compact mode for low-context agent loops.</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-indigo-600 font-bold">✓</span>
                      <span>Location-aware ranking with deliver_to.</span>
                    </li>
                  </ul>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      href="/api-keys"
                      className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                    >
                      Get an API key →
                    </Link>
                    <Link
                      href="/api-reference"
                      className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      API reference
                    </Link>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                    <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                    <span className="ml-2 text-xs text-gray-300 font-mono">terminal</span>
                  </div>
                  <pre className="p-4 text-sm text-gray-200 font-mono overflow-x-auto leading-relaxed">
                    <code>{curlExample}</code>
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
