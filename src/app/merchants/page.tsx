import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import Schema from "@/components/Schema";
import MerchantIntakeForm from "@/components/MerchantIntakeForm";
import { buildServiceSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Merchants — Get Discovered by AI Agents | BuyWhere",
  description:
    "List your catalog on BuyWhere and become discoverable to the next wave of AI-powered shopping experiences in Singapore.",
  path: "/merchants/",
});

const benefits = [
  {
    icon: "🔍",
    title: "AI-Powered Discoverability",
    desc: "Your products surface when AI agents search for what their users need — not just when someone types your brand name.",
  },
  {
    icon: "📦",
    title: "Simple Catalog Ingestion",
    desc: "Submit a product feed, connect an existing data source, or let us index your public catalog. No complex integration required.",
  },
  {
    icon: "📊",
    title: "Demand Insights",
    desc: "Understand how AI agents discover and recommend your products. See which queries match your catalog and where gaps exist.",
  },
  {
    icon: "🌏",
    title: "Singapore-First Coverage",
    desc: "We are building the deepest product catalog for Singapore commerce. Early merchants get the strongest positioning as the ecosystem grows.",
  },
];

const steps = [
  {
    step: "1",
    title: "Submit your catalog",
    desc: "Share your product feed via CSV, API, or supported e-commerce platform export. We handle normalization and deduplication.",
  },
  {
    step: "2",
    title: "We index and structure",
    desc: "Your products are normalized into BuyWhere's unified schema — titles, prices, specs, availability, and images — ready for semantic search.",
  },
  {
    step: "3",
    title: "AI agents discover your products",
    desc: "When developers and AI agents query BuyWhere for products matching their users' intent, your catalog is in the results.",
  },
  {
    step: "4",
    title: "Demand routes to you",
    desc: "Matched queries route buyer intent back to your store through attribution and referral, driving qualified traffic.",
  },
];

export default function MerchantsPage() {
  const schema = buildServiceSchema({
    path: "/merchants",
    name: "List your catalog on BuyWhere",
    description:
      "Become discoverable to AI agents and price-comparison shoppers in Singapore, Southeast Asia, and the US. Get qualified leads with pay-per-click pricing.",
    serviceType: "Merchant listing and lead generation",
    areaServed: ["Singapore", "United States", "Malaysia", "Thailand", "Philippines", "Indonesia", "Vietnam"],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <main id="main-content" tabIndex={-1}>
      {/* Hero */}
      <section className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold mb-4">
              Get your products discovered by AI agents
            </h1>
            <p className="text-emerald-200 text-lg leading-relaxed mb-8">
              AI is changing how consumers find and buy products. BuyWhere makes your catalog
              discoverable to the AI agents and shopping assistants that are driving this shift —
              starting with Singapore.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center px-6 py-3 bg-white text-emerald-700 font-semibold rounded-xl hover:bg-emerald-50 transition-colors"
            >
              List your catalog →
            </Link>
          </div>
        </div>
      </section>

      {/* Merchant intake form (BUY-75315 — writes to contacts table via /api/v1/contact) */}
      <section id="apply" className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Apply to list your catalog</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Tell us about your store and how you can feed BuyWhere. We onboard Singapore merchants at no cost during our beta period and respond within one business day.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• CSV feed, Shopify/Shopee/Lazada admin API, or existing product URL list</li>
                <li>• Works alongside any existing channel — no exclusivity</li>
                <li>• Products are normalized, deduplicated, and ranked deliverable-first</li>
              </ul>
            </div>
            <div>
              <MerchantIntakeForm />
            </div>
          </div>
        </div>
      </section>

      {/* Why it matters */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Why AI discoverability matters</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              AI shopping assistants and product-comparison agents are the fastest-growing channel for product discovery.
              These agents don&rsquo;t browse storefronts — they query structured data. If your catalog isn&rsquo;t in
              the data layer they search, your products don&rsquo;t exist to them.
            </p>
            <p className="text-gray-600 leading-relaxed">
              BuyWhere is that data layer. We are building the neutral product catalog that AI agents in Singapore
              query to find, compare, and recommend products. Listing your catalog here means your products are
              discoverable every time an agent searches for what you sell.
            </p>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">What you get</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {benefits.map((b) => (
              <div key={b.title} className="bg-white rounded-xl p-6 border border-gray-100">
                <div className="text-2xl mb-3">{b.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">How it works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-sm mb-4 mx-auto">
                  {s.step}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Merchant participation model */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Merchant participation</h2>
            <p className="text-gray-600 leading-relaxed mb-4 text-center">
              We are currently onboarding Singapore merchants into the BuyWhere catalog at no cost during our beta period.
              Our long-term model is built around referral economics and merchant partnerships — we succeed when AI agents
              route qualified demand to your store.
            </p>
            <p className="text-gray-500 text-sm leading-relaxed text-center">
              Participation details and partnership terms are evolving as we grow. Get in touch to discuss how your catalog
              fits into the BuyWhere ecosystem.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-emerald-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to be discovered?</h2>
          <p className="text-emerald-200 mb-8 text-lg">
            Join Singapore merchants who are making their catalogs available to the next generation of AI-powered shopping.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="#apply"
              className="inline-flex items-center justify-center px-8 py-3 bg-white text-emerald-700 font-semibold rounded-xl hover:bg-emerald-50 transition-colors"
            >
              List your catalog →
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center justify-center px-8 py-3 border border-emerald-400 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Learn about BuyWhere
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
