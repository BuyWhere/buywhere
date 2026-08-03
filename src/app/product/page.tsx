import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import Schema from "@/components/Schema";
import { HomeProductSearch } from "@/components/HomeProductSearch";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Product Search — BuyWhere",
  description:
    "Search 288M+ products across 158,000+ storefronts with one API. Real-time, normalized, and location-aware.",
  path: "/product/",
});

export default function ProductPage() {
  const schema = buildWebPageSchema({
    path: "/product",
    name: "Product Search — BuyWhere",
    description:
      "Search 288M+ products across 158,000+ storefronts with one API. Real-time, normalized, and location-aware.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Product Search", path: "/product" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <main id="main-content" role="main" tabIndex={-1} aria-label="Main content">
          {/* Hero */}
          <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-20">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="max-w-3xl mx-auto text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-bold mb-6">
                  Find any product across every store
                </h1>
                <p className="text-xl text-indigo-100 leading-relaxed">
                  One search across 158,000+ storefronts. Compare prices, check availability, and get purchase links.
                </p>
              </div>
              <HomeProductSearch />
              <p className="text-center text-sm text-indigo-200 mt-6">
                288M+ structured products — normalized, deduplicated, and location-aware.
              </p>
            </div>
          </section>

          {/* How it differs */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="text-center mb-14">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Why use BuyWhere for product search?
                </h2>
                <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                  Stop maintaining one integration per retailer. Query a single API and get consistent, shoppable results.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[
                  {
                    title: "Cross-merchant coverage",
                    desc: "Query one endpoint and receive products from marketplaces, big-box retailers, and specialty stores in a single response.",
                  },
                  {
                    title: "Availability labels",
                    desc: "Every result is labeled local, ships_to_you, or unavailable so you only recommend products your user can actually receive.",
                  },
                  {
                    title: "Structured for agents",
                    desc: "JSON responses include normalized fields — name, brand, price, currency, image, merchant, and URL — perfect for LLM tool output.",
                  },
                ].map((f) => (
                  <div key={f.title} className="p-6 rounded-xl border border-gray-100 bg-gray-50">
                    <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-20 bg-indigo-600 text-white">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
              <h2 className="text-3xl font-bold mb-4">
                Power your agent with product data
              </h2>
              <p className="text-indigo-100 mb-8 text-lg">
                Get API access and start returning real product recommendations in minutes.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/developers"
                  className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
                >
                  Developer docs →
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center px-6 py-3 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  View pricing
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
