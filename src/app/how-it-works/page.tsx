import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import Schema from "@/components/Schema";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "How It Works — BuyWhere",
  description:
    "See how BuyWhere turns a natural language product query into ranked, purchase-ready product data for AI agents.",
  path: "/how-it-works/",
});

export default function HowItWorksPage() {
  const schema = buildWebPageSchema({
    path: "/how-it-works",
    name: "How It Works — BuyWhere",
    description:
      "From natural language query to purchase-ready product data — BuyWhere handles the complexity so your agents don't have to.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "How It Works", path: "/how-it-works" },
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
                  How BuyWhere works
                </h1>
                <p className="text-xl text-indigo-100 leading-relaxed">
                  A neutral product layer that turns agent questions into structured, shoppable answers.
                </p>
              </div>
            </div>
          </section>

          <HowItWorksSection />

          {/* Workflow explainer */}
          <section className="py-20 bg-gray-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="text-center mb-14">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  The pipeline behind every query
                </h2>
                <p className="text-lg text-gray-500 max-w-2xl mx-auto">
                  Merchant feeds are normalized, indexed, and served through a single API designed for agent reasoning.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  {
                    step: "1",
                    title: "Ingest",
                    desc: "Retailers submit feeds or we ingest from existing catalog sources across Singapore, Southeast Asia, and the US.",
                  },
                  {
                    step: "2",
                    title: "Normalize",
                    desc: "Products are deduplicated, attributes are mapped to a common schema, and availability signals are attached.",
                  },
                  {
                    step: "3",
                    title: "Index",
                    desc: "Semantic search and structured filters let agents query by intent, category, price range, and geography.",
                  },
                  {
                    step: "4",
                    title: "Deliver",
                    desc: "Agents receive ranked JSON with prices, merchants, images, and purchase URLs — ready to present to users.",
                  },
                ].map((s) => (
                  <div key={s.step} className="bg-white rounded-xl p-6 border border-gray-100">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm mb-4">
                      {s.step}
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-20 bg-white border-t border-gray-100">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Ready to plug your agent into the catalog?
              </h2>
              <p className="text-gray-500 mb-8 text-lg">
                Get an API key and make your first product query in under five minutes.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  Get started →
                </Link>
                <Link
                  href="/developers"
                  className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Developer portal
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
