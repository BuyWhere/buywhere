import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const audiences = [
  {
    icon: "🤖",
    title: "AI Agent Developers",
    desc: "Query a structured, normalized product catalog from your agent. One API, one schema, cross-market product discovery for the US and Southeast Asia.",
    cta: "Start building",
    ctaHref: "/quickstart",
  },
  {
    icon: "🏪",
    title: "Merchants & Retailers",
    desc: "Get your catalog discovered by the next wave of AI-powered shopping experiences. No integration work required.",
    cta: "List your catalog",
    ctaHref: "/merchants",
  },
  {
    icon: "🤝",
    title: "Commerce Partners",
    desc: "Collaborate on attribution, referral, and demand routing as AI reshapes how consumers find and buy products.",
    cta: "Explore partnerships",
    ctaHref: "/partners",
  },
];

const valueProps = [
  {
    title: "Structured for agent reasoning",
    desc: "Product, merchant, and catalog data is normalized so LLM-powered agents can search, rank, compare, and recommend with less prompt overhead and fewer brittle parsing failures.",
  },
  {
    title: "Commerce-ready regional coverage",
    desc: "Start with region-aware coverage across the US and Southeast Asia so your agent can answer market-specific shopping and availability questions without rebuilding the stack for each geography.",
  },
  {
    title: "Faster than scraping",
    desc: "Skip anti-bot breakage, messy HTML transforms, and one-off merchant adapters. Use a single API designed for repeated product lookups at agent scale.",
  },
  {
    title: "Built for developer velocity",
    desc: "Prototype product-search agents, shopping copilots, and commerce workflows quickly with API-first access and documentation aimed at builders, not enterprise procurement teams.",
  },
];

const faqs = [
  {
    q: "What is a product catalog API for AI agents?",
    a: "A product catalog API for AI agents gives assistants structured access to product listings, merchant data, and searchable catalog information so they can answer shopping and commerce questions reliably. Instead of scraping websites, agents can query normalized data and return product matches, comparisons, and purchase paths.",
  },
  {
    q: "Why do AI agents need structured product data instead of web scraping?",
    a: "Structured product data is more reliable, easier to parse, and cheaper to maintain than scraping HTML pages. AI agents perform better when products, merchants, and attributes are exposed through stable fields rather than inconsistent storefront markup.",
  },
  {
    q: "What is agentic commerce?",
    a: "Agentic commerce is when AI agents help users discover, compare, and choose products, and can eventually complete commerce workflows on their behalf. It requires product data infrastructure that agents can query in real time.",
  },
  {
    q: "How do you build a shopping assistant with product search?",
    a: "Start with a product catalog API, then add retrieval, ranking, and conversation logic. The API provides searchable products and merchant data, while the assistant handles user intent, filtering, and recommendations.",
  },
  {
    q: "What makes a good product API for LLM applications?",
    a: "A strong product API for LLM apps should provide normalized schemas, searchable catalog data, merchant context, availability signals, and predictable responses that are easy for models and tools to consume.",
  },
  {
    q: "What is the best way to power region-specific shopping queries in an AI app?",
    a: "Use a product and merchant API that supports explicit regional filters so your app can return locally relevant products and sellers in the US, Singapore, and broader Southeast Asia. Geography-aware catalog coverage improves answer quality for users asking where to buy items within a specific market.",
  },
  {
    q: "How can developers avoid scraping merchant sites for commerce agents?",
    a: "Developers can avoid scraping by integrating a catalog API that already standardizes merchant and product data. This reduces maintenance load, avoids breakage from site changes, and speeds up agent development.",
  },
  {
    q: "What data does an AI shopping agent need?",
    a: "An AI shopping agent needs product names, categories, descriptions, pricing when available, merchant identity, search relevance, and links or actions that help users continue the buying journey.",
  },
  {
    q: "How do product APIs improve recommendation quality?",
    a: "Product APIs improve recommendation quality by giving the model consistent, machine-readable product attributes and merchant context. Better input structure leads to stronger filtering, ranking, and explanation quality.",
  },
  {
    q: "What should a developer landing page for an agentic commerce API include?",
    a: "It should clearly explain the API's purpose, who it is for, the core use cases, why it is better than scraping, what geography or catalog coverage it offers, and how to get access quickly.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.a,
    },
  })),
};

const codeSnippet = `import requests

API_KEY = "bw_live_your_key_here"

response = requests.get(
    "https://api.buywhere.ai/v1/search",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={
        "q": "wireless noise-cancelling headphones",
        "limit": 5
    }
)

products = response.json()["items"]
for p in products:
    print(f"{p['name']} — {p['currency']} {p['price']} at {p['source']}")`;

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white/90 text-sm font-medium px-3 py-1 rounded-full mb-6">
              <span className="w-2 h-2 bg-green-400 rounded-full"></span>
              Now in developer beta · US + Southeast Asia
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight mb-6">
              The product catalog API built for AI agents.
            </h1>
            <p className="text-xl text-indigo-200 mb-10 leading-relaxed">
              Give your agents real products, live merchant data, and structured catalog search for US and Southeast Asia commerce workflows with one API.
            </p>
            <p className="text-base text-indigo-100/90 mb-8 leading-relaxed max-w-2xl">
              BuyWhere helps AI assistants and agentic apps discover products, compare options, and power commerce experiences without scraping storefronts or stitching together unreliable feeds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
              >
                Get API access →
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center px-6 py-3 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-colors border border-white/20"
              >
                View quickstart
              </Link>
            </div>
            <p className="text-sm text-indigo-100/80">
              Built for agentic commerce, product search, merchant discovery, and real-world buying workflows across the US and Southeast Asia.
            </p>
          </div>
        </div>
      </section>

      {/* Who this is for */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Who BuyWhere is for</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              A two-sided infrastructure layer connecting AI-powered demand with merchant supply.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {audiences.map((a) => (
              <div
                key={a.title}
                className="p-6 rounded-xl border border-gray-100 hover:border-indigo-100 hover:shadow-md transition-all flex flex-col"
              >
                <div className="text-3xl mb-4">{a.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{a.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed flex-1 mb-4">{a.desc}</p>
                <Link
                  href={a.ctaHref}
                  className="text-sm text-indigo-600 font-medium hover:text-indigo-700 transition-colors"
                >
                  {a.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">How BuyWhere works</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              A neutral product-discovery layer connecting merchant catalogs to AI-driven demand.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "1", title: "Merchant catalogs in", desc: "Retailers submit product feeds or we ingest from existing catalog sources." },
              { step: "2", title: "Structured discovery layer", desc: "Products are normalized, deduplicated, and indexed for semantic search." },
              { step: "3", title: "AI agent query & ranking", desc: "Agents search by natural language, filters, or category. Structured JSON back." },
              { step: "4", title: "Routed buyer demand out", desc: "Matched products route demand back to merchants through attribution and referral." },
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

      {/* Code demo */}
      <section className="bg-gray-900 py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-start gap-12">
            <div className="flex-1 text-white">
              <h2 className="text-2xl font-bold mb-4">Query regional products in 5 lines</h2>
              <p className="text-gray-400 mb-6">
                One API call returns structured product data: name, price, SKU, retailer, image, and availability. No scraping, no parsing.
              </p>
              <Link
                href="/quickstart"
                className="inline-flex items-center text-indigo-400 font-medium hover:text-indigo-300 transition-colors"
              >
                View quickstart →
              </Link>
            </div>
            <div className="flex-1 w-full">
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                  <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                  <span className="ml-2 text-xs text-gray-500 font-mono">search.py</span>
                </div>
                <pre className="p-4 text-sm text-gray-300 font-mono overflow-x-auto leading-relaxed">
                  <code>{codeSnippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why developers use BuyWhere</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              The approved developer-first positioning, translated directly into the live landing page.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {valueProps.map((f, index) => (
              <div
                key={f.title}
                className="p-6 rounded-xl border border-gray-100 hover:border-indigo-100 hover:shadow-md transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold mb-4">
                  0{index + 1}
                </div>
                <h3 className="font-semibold text-gray-900 mb-3">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

       {/* Why now */}
       <section className="py-20 bg-indigo-50">
         <div className="max-w-6xl mx-auto px-4 sm:px-6">
           <div className="max-w-3xl mx-auto text-center">
             <h2 className="text-3xl font-bold text-gray-900 mb-6">Why AI shopping needs a neutral catalog layer</h2>
             <p className="text-gray-600 leading-relaxed mb-4">
               Platform APIs surface their own inventory first. Shopee returns Shopee products. Lazada returns Lazada products. For an AI agent trying to find the best match across the market, that is a sales channel — not a catalog.
             </p>
             <p className="text-gray-600 leading-relaxed mb-8">
               BuyWhere has no inventory to sell and no platform to favour. We index products across the US and Southeast Asia into a single, structured API so AI agents get a broader market view instead of one platform&rsquo;s version of it.
             </p>
             <Link
               href="/about"
               className="text-indigo-600 font-medium hover:text-indigo-700 transition-colors"
             >
               Learn more about our approach →
             </Link>
           </div>
         </div>
       </section>

       {/* FAQ */}
      <section className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">FAQ for agent builders</h2>
            <p className="text-lg text-gray-500">
              Answer-engine friendly questions and answers based on the approved AEO plan.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {faqs.map((faq) => (
              <div key={faq.q} className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{faq.q}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-indigo-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Launch product-aware agents without building a catalog pipeline.</h2>
          <p className="text-indigo-200 mb-8 text-lg">
            If your agent needs to answer &ldquo;what should I buy?&rdquo;, &ldquo;where can I get it?&rdquo;, or &ldquo;what are the best options in the US, Singapore, or Southeast Asia?&rdquo; BuyWhere gives you the product layer to ship faster.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/api-keys"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors text-lg"
            >
              Request beta access
            </Link>
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center px-8 py-4 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-lg"
            >
              Explore the API
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
