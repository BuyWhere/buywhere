import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Pricing — BuyWhere Product Catalog API",
  description:
    "BuyWhere is in developer beta. Get free API access to Singapore's structured product catalog for AI agents.",
  alternates: {
    canonical: toSiteUrl("/pricing/"),
  },
};

const betaFeatures = [
  "Full Singapore product catalog",
  "Structured product schema (JSON)",
  "Semantic natural-language search",
  "Price comparison across merchants",
  "Real-time availability data",
  "Rate-limited API access",
];

const faqs = [
  {
    q: "Is BuyWhere free during the beta?",
    a: "Yes. During developer beta, API access is free with rate limits. We want developers building on BuyWhere before we finalize pricing. When we introduce paid tiers, existing beta users will get advance notice and transition support.",
  },
  {
    q: "What exactly counts as an API query?",
    a: "A query is any single authenticated request to a BuyWhere API endpoint — whether it's a product search, a price lookup, or a catalog fetch. Batch requests that return multiple results still count as one query. Requests that return errors (4xx/5xx) are not counted.",
  },
  {
    q: "How does BuyWhere make money?",
    a: "BuyWhere's business model is built around referral fees, merchant partnerships, and demand routing economics. When AI agents use our catalog to match buyers with products, we participate in the commerce economics of that transaction. We are not a subscription API business — we succeed when merchants get qualified demand.",
  },
  {
    q: "Will there be paid tiers later?",
    a: "We expect to offer tiered access for high-volume use cases as the platform matures. Pricing details will be shared when they are finalized and aligned with our partners. For now, focus on building — the beta is free.",
  },
  {
    q: "I'm a merchant. Is there a cost to list my catalog?",
    a: "No. During beta, merchant catalog ingestion is free. Our long-term model is built around demand routing and referral economics, not listing fees. Get in touch via the Merchants page to start the conversation.",
  },
];

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      {/* Header */}
      <section className="bg-white py-16 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-sm font-medium px-3 py-1 rounded-full mb-6">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Developer Beta — Free Access
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Build on BuyWhere for free during beta
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            We&rsquo;re focused on getting the product catalog and API right. During developer beta,
            access is free with rate limits so you can build and test your AI commerce integrations.
          </p>
        </div>
      </section>

      {/* Beta plan */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-2xl border border-indigo-200 shadow-lg shadow-indigo-50 p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-gray-900 text-xl">Developer Beta</h3>
                <p className="text-gray-500 text-sm">Full catalog access with rate limits</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-gray-900">Free</span>
                <p className="text-gray-400 text-xs">during beta</p>
              </div>
            </div>

            <ul className="space-y-3 text-sm text-gray-600 mb-8">
              {betaFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <CheckIcon />
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href="/api-keys"
              className="block w-full text-center py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
            >
              Get your API key →
            </Link>
          </div>
        </div>
      </section>

      {/* Future model */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">For developers</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                We expect to offer tiered API access as the platform matures — with free tiers for
                experimentation and paid tiers for production-scale usage. Details will be shared when
                pricing is finalized.
              </p>
              <p className="text-gray-500 text-sm">
                Beta users will get advance notice and fair transition terms.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">For merchants</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Catalog listing is free during beta. Our long-term merchant model is built around
                referral economics and demand routing — not listing fees or SaaS subscriptions.
                We make money when AI agents route qualified buyers to your store.
              </p>
              <p className="text-gray-500 text-sm">
                <Link href="/merchants" className="text-indigo-600 hover:text-indigo-700">
                  Learn more about merchant participation →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-indigo-50 rounded-2xl p-8">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Need higher rate limits or custom data?</h3>
              <p className="text-gray-600">
                For teams with production-scale requirements, custom catalog needs, or partnership opportunities — let&rsquo;s talk.
              </p>
            </div>
            <Link
              href="/contact"
              className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-center shrink-0"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">Frequently asked questions</h2>
          <div className="space-y-6">
            {faqs.map((faq) => (
              <div key={faq.q} className="bg-gray-50 rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-2">{faq.q}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to start building?</h2>
          <p className="text-indigo-200 mb-8">
            Get your API key and make your first query in under 5 minutes. Free during beta.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/api-keys"
              className="px-8 py-3 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
            >
              Get API key →
            </Link>
            <Link
              href="/quickstart"
              className="px-8 py-3 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
            >
              View quickstart
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
