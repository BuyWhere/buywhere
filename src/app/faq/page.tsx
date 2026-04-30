import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — BuyWhere",
  description: "Top 10 questions about BuyWhere — how it works, what's covered, how accurate prices are, and more.",
};

const faqs = [
  {
    question: "How does BuyWhere work?",
    answer: "BuyWhere aggregates product data from multiple retailers and marketplaces into a single, normalized API. You query our catalog with a product name or category, and we return structured results — title, price, availability, specs, affiliate link — from across the market, not just one platform. We handle the schema normalization and data cleaning so your AI agent gets consistent, usable data without writing retailer-specific integrations.",
  },
  {
    question: "Is it free?",
    answer: "Yes. BuyWhere offers a free tier with generous rate limits suitable for development, prototypes, and small projects. Paid tiers add higher rate limits and advanced features. We monetize through referral fees when transactions happen through our links — not by charging developers for API access.",
  },
  {
    question: "What markets do you cover?",
    answer: "BuyWhere covers the US and Southeast Asia (Singapore, Malaysia, Philippines, Thailand, Indonesia, Vietnam). We index products across major platforms and independent merchants in each market, normalizing them into a consistent schema regardless of source.",
  },
  {
    question: "How accurate are the prices?",
    answer: "Prices are refreshed multiple times per day from source retailers. We flag stale prices (typically older than 24 hours) with a freshness indicator so your agent can decide whether to trust the data or skip it. For time-sensitive decisions like deal detection, we recommend verifying price at checkout.",
  },
  {
    question: "How often are prices updated?",
    answer: "Most prices refresh every 4–8 hours. We prioritize high-traffic products and active deals for more frequent updates. You can check the `lastUpdated` timestamp on each product response to determine whether the data is current enough for your use case.",
  },
  {
    question: "Can I set price alerts?",
    answer: "Price alerts are on our roadmap. You'll be able to configure threshold-based alerts for specific products or categories, delivered via webhook or email. In the meantime, our API lets you poll price data programmatically to build your own alerting logic.",
  },
  {
    question: "Do you have an API?",
    answer: "Yes. BuyWhere is an API-first product. We offer a REST API with structured JSON responses, a LangChain integration for AI agent frameworks, and an OpenAI tools adapter so you can drop BuyWhere into existing agent pipelines. Full docs are at buywhere.com/quickstart.",
  },
  {
    question: "How is this different from CamelCamelCamel?",
    answer: "CamelCamelCamel tracks price history for Amazon products — useful for humans checking if a price is good. BuyWhere is built for AI agents: we return structured product data across multiple retailers and markets simultaneously, with a normalized schema designed for programmatic reasoning, not human browsing. We cover Southeast Asia markets that CamelCamelCamel doesn't, and we don't limit you to a single retailer.",
  },
  {
    question: "Is there a browser extension?",
    answer: "Not yet. We're focused on the API layer first, which serves AI agents and developer integrations. Browser extension is on the roadmap for later this year. Subscribe to our newsletter or check the docs for updates.",
  },
  {
    question: "How do you make money?",
    answer: "We earn referral fees when users buy products through our affiliate links. When your AI agent recommends a product and the user purchases it, the retailer pays us a commission — the same standard affiliate model used across the web. This means our incentives are aligned with getting users the right product at a fair price, not with pushing higher-margin items.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <section className="bg-indigo-600 text-white py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-2xl">
              <h1 className="text-4xl font-bold mb-4">Frequently Asked Questions</h1>
              <p className="text-indigo-200 text-lg">
                Top questions from the ProductHunt community about how BuyWhere works and what it covers.
              </p>
            </div>
          </div>
        </section>

        <section className="py-16 bg-white flex-1">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="max-w-3xl">
              <div className="space-y-8">
                {faqs.map((faq, i) => (
                  <div key={i} className="border-b border-gray-100 pb-8 last:border-0">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">{faq.question}</h2>
                    <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}