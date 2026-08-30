import Schema from "@/components/Schema";
import { buildSoftwareApplicationSchema } from "@/lib/page-schema";

import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Pricing — BuyWhere Product Catalog API",
  description:
    "Simple, transparent pricing for the BuyWhere Product Catalog API. Free, Starter at $29/mo, and Pro at $99/mo.",
  path: "/pricing/",
});

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "Get started with the BuyWhere API at no cost — no credit card required.",
    requests: "100 req/day",
    rateLimit: "10 req/min",
    bulk: false,
    webhooks: false,
    affiliate: false,
    support: "Standard",
    trial: null as string | null,
    cta: "Sign up free",
    ctaHref: "/register",
    highlighted: false,
    variant: "outline" as const,
  },
  {
    name: "Starter",
    price: "$29",
    period: "/mo",
    description: "For developers building production integrations.",
    requests: "10,000 req/day",
    rateLimit: "100 req/min",
    bulk: true,
    webhooks: true,
    affiliate: false,
    support: "Standard",
    trial: "7-day free trial" as string | null,
    cta: "Start Free Trial",
    ctaHref: "/checkout?plan=pro",
    highlighted: true,
    variant: "primary" as const,
  },
  {
    name: "Pro",
    price: "$99",
    period: "/mo",
    description: "For high-volume apps and AI agent platforms.",
    requests: "100,000 req/day",
    rateLimit: "500 req/min",
    bulk: true,
    webhooks: true,
    affiliate: true,
    support: "Priority SLA",
    trial: null as string | null,
    cta: "Get Pro",
    ctaHref: "/checkout?plan=scale",
    highlighted: false,
    variant: "dark" as const,
  },
];

const compareRows: { label: string; key: keyof (typeof tiers)[0] }[] = [
  { label: "Requests/day", key: "requests" },
  { label: "Rate limit", key: "rateLimit" },
  { label: "Bulk endpoint", key: "bulk" },
  { label: "Webhooks", key: "webhooks" },
  { label: "Affiliate embedding", key: "affiliate" },
  { label: "Support", key: "support" },
];

function CheckIcon({ on }: { on: boolean }) {
  if (!on) {
    return (
      <svg className="w-5 h-5 text-gray-300 mx-auto" viewBox="0 0 20 20" fill="none">
        <path d="M6 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-indigo-500 mx-auto" viewBox="0 0 20 20" fill="none">
      <path
        d="M4 10l4.5 4.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeatureCell({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") return <CheckIcon on={value} />;
  return <span className="text-sm text-gray-700">{value}</span>;
}

export default function PricingPage() {
  const schema = buildSoftwareApplicationSchema({
    path: '/pricing',
    name: 'BuyWhere Pricing',
    description:
      'Simple, transparent pricing for the BuyWhere Product Catalog API. Free, Starter at $29/mo, and Pro at $99/mo.',
    applicationCategory: 'DeveloperApplication',
    offers: [
      { price: '0', priceCurrency: 'USD' },
      { price: '29', priceCurrency: 'USD' },
      { price: '99', priceCurrency: 'USD' },
    ],
    // BUY-69732: Home > Pricing breadcrumb for the pricing route.
    breadcrumb: [
      { name: 'Home', path: '/' },
      { name: 'Pricing', path: '/pricing' },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen bg-white">
        <Nav />

        <main id="main-content">
      {/* Header */}
      <section className="py-16 border-b border-gray-100 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-gray-500">Start free — no credit card required. Scale as you grow. No hidden fees.</p>
        </div>
      </section>

      {/* Cards */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-3 gap-6 items-stretch">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-8 flex flex-col ${
                  tier.highlighted
                    ? "bg-indigo-600 text-white shadow-xl shadow-indigo-200 ring-2 ring-indigo-600"
                    : "bg-white border border-gray-200"
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h2
                    className={`text-lg font-bold mb-1 ${tier.highlighted ? "text-white" : "text-gray-900"}`}
                  >
                    {tier.name}
                  </h2>
                  <div className="flex items-end gap-1 mb-2">
                    <span
                      className={`text-4xl font-bold ${tier.highlighted ? "text-white" : "text-gray-900"}`}
                    >
                      {tier.price}
                    </span>
                    <span
                      className={`text-sm pb-1 ${tier.highlighted ? "text-indigo-200" : "text-gray-400"}`}
                    >
                      {tier.period}
                    </span>
                  </div>
                  <p className={`text-sm ${tier.highlighted ? "text-indigo-200" : "text-gray-500"}`}>
                    {tier.description}
                  </p>
                  {tier.trial && (
                    <p
                      className={`text-xs mt-1 font-semibold ${tier.highlighted ? "text-amber-300" : "text-indigo-600"}`}
                    >
                      {tier.trial}
                    </p>
                  )}
                </div>

                <ul className="space-y-3 text-sm mb-8 flex-1">
                  {[
                    tier.requests,
                    tier.rateLimit,
                    tier.bulk ? "Bulk endpoint" : null,
                    tier.webhooks ? "Webhooks" : null,
                    tier.affiliate ? "Affiliate embedding" : null,
                    `${tier.support} support`,
                  ]
                    .filter(Boolean)
                    .map((feat) => (
                      <li key={feat as string} className="flex items-center gap-2">
                        <svg
                          className={`w-4 h-4 shrink-0 ${tier.highlighted ? "text-indigo-300" : "text-indigo-500"}`}
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M3 8l3.5 3.5L13 5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className={tier.highlighted ? "text-indigo-100" : "text-gray-600"}>
                          {feat}
                        </span>
                      </li>
                    ))}
                </ul>

                <Link
                  href={tier.ctaHref}
                  className={`block w-full text-center py-3 rounded-xl font-semibold text-sm transition-colors ${
                    tier.highlighted
                      ? "bg-white text-indigo-700 hover:bg-indigo-50"
                      : tier.variant === "dark"
                      ? "bg-gray-900 text-white hover:bg-gray-800"
                      : "border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">Compare plans</h2>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-4 px-6 text-sm font-semibold text-gray-600">Feature</th>
                  {tiers.map((tier) => (
                    <th
                      key={tier.name}
                      scope="col"
                      className={`text-center py-4 px-6 text-sm font-semibold ${
                        tier.highlighted ? "text-indigo-600" : "text-gray-900"
                      }`}
                    >
                      <span className="block">{tier.name}</span>
                      {tier.highlighted && (
                        <span className="mt-1 inline-flex text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          {" Popular"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {compareRows.map((row) => (
                  <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6 text-sm text-gray-600">{row.label}</td>
                    {tiers.map((tier) => (
                      <td key={tier.name} className="py-4 px-6 text-center">
                        <FeatureCell value={tier[row.key] as boolean | string} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-indigo-50 rounded-2xl p-8">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">
                Need higher volume or custom data?
              </h3>
              <p className="text-gray-600">
                Enterprise plans with custom rate limits, SLA guarantees, and dedicated catalog support.
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
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: "What counts as an API request?",
                a: "Any single authenticated request to a BuyWhere endpoint — search, price lookup, or catalog fetch. Batch requests that return multiple results still count as one. Error responses (4xx/5xx) are not counted.",
              },
              {
                q: "Can I upgrade or downgrade anytime?",
                a: "Yes. Upgrades apply immediately. Downgrades take effect at the end of your billing cycle with prorated credit.",
              },
              {
                q: "How does the Starter free trial work?",
                a: "You get 7 days on the Starter plan at no charge. Cancel before the trial ends and you won't be billed.",
              },
              {
                q: "What is affiliate embedding?",
                a: "Pro users can embed BuyWhere affiliate links in their product results and earn referral revenue when users complete purchases.",
              },
              {
                q: "Is there a merchant listing fee?",
                a: "No. Catalog ingestion is free. Our model is built around referral economics — we make money when qualified buyers reach your store.",
              },
            ].map((faq) => (
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
            Sign up free and make your first API query in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="px-8 py-3 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
            >
              Get started free →
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

      </main>
      <Footer />
    </div>
  </>
  );
}
