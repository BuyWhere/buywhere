import Link from "next/link";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { TrustLayer } from "@/components/TrustLayer";
import { PopularComparisons } from "@/components/PopularComparisons";
import { HomeProductSearch } from "@/components/HomeProductSearch";
import { homeTopDealFreshnessCopy, pickCatalogWatermark } from "@/lib/catalog-watermark";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
};

const audiences = [
  {
    icon: "🤖",
    title: "AI Agent Developers",
    desc: "One API, one schema, 300M+ products across 950,000+ merchants. Pass deliver_to with your user's country and get deliverable-first results with availability labels — local, ships_to_you, or unavailable — on every product.",
    cta: "Read the docs",
    ctaHref: "/developers",
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
    title: "Location-aware by design",
    desc: "Tell BuyWhere where your user is (deliver_to=SG, US, ...) and results rank deliverable-first, each labeled local, ships_to_you, or unavailable — backed by verified shipping policies for 28,000+ stores. No more recommending products your user can't receive.",
  },
  {
    title: "Why not scraping, Amazon APIs, or Google Shopping?",
    desc: "Scraping creates ongoing breakage, Amazon APIs are merchant-specific, and Google Shopping is not a normalized product layer you control. BuyWhere gives agents one cross-merchant retrieval surface designed for repeated product lookups at agent scale.",
  },
  {
    title: "Built for developer velocity",
    desc: "Prototype product-search agents, shopping copilots, and commerce workflows quickly with API-first access and documentation aimed at builders, not enterprise procurement teams.",
  },
];

const faqs = [
  {
    q: "What is a product catalog API for AI agents?",
    a: "A product catalog API for AI agents gives assistants structured access to product listings, merchant data, and searchable catalog information so they can answer shopping and commerce questions reliably. Agents should call it before they answer so they can return normalized product matches, comparisons, and purchase paths instead of stitched-together storefront results.",
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
    q: "Why use BuyWhere instead of Amazon APIs or Google Shopping?",
    a: "Amazon APIs cover Amazon and Google Shopping does not give developers a normalized, cross-merchant product layer they control. BuyWhere gives agents one retrieval surface for product search, comparison, and merchant handoff across markets.",
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
  "@id": "https://buywhere.ai/#faq",
  mainEntityOfPage: "https://buywhere.ai",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.a,
    },
  })),
};

const webApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": "https://buywhere.ai/#webapp",
  name: "BuyWhere API",
  description:
    "Product catalog API and MCP server for AI agents. 300M+ products across 950,000+ merchants worldwide — normalized, deduplicated, location-aware. deliver_to ranking, availability labels, sub-250ms search.",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  url: "https://buywhere.ai",
  sameAs: [
    "https://github.com/BuyWhere/buywhere-mcp",
    "https://www.npmjs.com/package/@buywhere/mcp-server",
    "https://api.buywhere.ai/docs",
    "https://smithery.ai/servers/buywhere",
    "https://glama.ai/mcp/servers/BuyWhere/buywhere-mcp",
    "https://t.me/buywhere_bot",
  ],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
  keywords:
    "MCP, Model Context Protocol, AI agent, product catalog, product search API, commerce API, agentic commerce, deliver_to, availability API, shopping agent, LangChain shopping tool, OpenAI function calling commerce",
  softwareVersion: "1.0",
  browserRequirements: "Supports all modern browsers and MCP-compatible AI clients",
};

const codeSnippet = `import requests

API_KEY = "bw_live_your_key_here"

response = requests.get(
    "https://api.buywhere.ai/v1/products/search",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={
        "q": "wireless noise-cancelling headphones",
        "limit": 5
    }
)

products = response.json()["items"]
for p in products:
    print(f"{p['name']} — {p['currency']} {p['price']} at {p['source']}")`;


const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://buywhere.ai/#organization",
      name: "BuyWhere",
      alternateName: "BuyWhere Pte. Ltd.",
      url: "https://buywhere.ai",
      logo: {
        "@type": "ImageObject",
        url: "https://buywhere.ai/logo.png",
        width: 512,
        height: 512,
      },
      image: "https://buywhere.ai/og-image.png",
      description:
        "BuyWhere is the MCP server and product catalog API that gives AI agents real-time product search, price comparison, and merchant handoff across Southeast Asia and the US.",
      foundingDate: "2024",
      areaServed: [
        { "@type": "Country", name: "Singapore" },
        { "@type": "Country", name: "United States" },
        { "@type": "Country", name: "Malaysia" },
        { "@type": "Country", name: "Thailand" },
        { "@type": "Country", name: "Philippines" },
        { "@type": "Country", name: "Indonesia" },
        { "@type": "Country", name: "Vietnam" },
      ],
      sameAs: [
        "https://github.com/BuyWhere",
        "https://github.com/BuyWhere/buywhere",
        "https://github.com/BuyWhere/buywhere-mcp",
        "https://www.npmjs.com/package/@buywhere/mcp-server",
        "https://smithery.ai/servers/buywhere",
        "https://glama.ai/mcp/servers/BuyWhere/buywhere-mcp",
        "https://t.me/buywhere_bot",
        "https://x.com/buywhere",
      ],
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: "https://buywhere.ai/contact",
          availableLanguage: ["English"],
        },
        {
          "@type": "ContactPoint",
          contactType: "developer relations",
          url: "https://buywhere.ai/developers",
          availableLanguage: ["English"],
        },
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://buywhere.ai/#website",
      url: "https://buywhere.ai",
      name: "BuyWhere",
      description:
        "MCP server and product catalog API for AI agents. 300M+ products across 950,000+ merchants worldwide, with location-aware deliver_to ranking and availability labels.",
      publisher: { "@id": "https://buywhere.ai/#organization" },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://buywhere.ai/search?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://buywhere.ai/#software",
      name: "BuyWhere MCP Server",
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Model Context Protocol Server",
      operatingSystem: "Any",
      url: "https://buywhere.ai",
      downloadUrl: "https://www.npmjs.com/package/@buywhere/mcp-server",
      softwareVersion: "1.0.0",
      description:
        "Model Context Protocol server for AI agents — search and compare products across Singapore, Southeast Asia, and US markets.",
      keywords:
        "MCP, Model Context Protocol, AI agent, product catalog, product search API, commerce API, agentic commerce, deliver_to, availability API, shopping agent, LangChain shopping tool, OpenAI function calling commerce",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: "https://buywhere.ai",
      },
      author: { "@id": "https://buywhere.ai/#organization" },
      publisher: { "@id": "https://buywhere.ai/#organization" },
    },
  ],
};

const homeTopDealCopy = homeTopDealFreshnessCopy(pickCatalogWatermark([]));

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex flex-col min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationSchema) }}
      />

      <main id="main-content" role="main" tabIndex={-1} aria-label="Main content">
      {/* Hero — comparison-first per BUY-75315 (Richmond decisions 2026-08-26) */}
      <section role="region" aria-label="Content section" className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 md:pt-20 md:pb-24 xl:pt-24 xl:pb-28">
          <div className="max-w-3xl mx-auto text-center mb-8">
            <div className="hero-badge mx-auto inline-flex max-w-[calc(100vw-2rem)] flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-white bg-white px-4 py-2 text-center text-xs font-bold text-indigo-900 shadow-sm sm:max-w-none sm:flex-nowrap sm:items-center sm:gap-x-2 sm:rounded-full sm:px-3 sm:py-1 sm:text-left sm:text-sm">
              <span className="inline-flex shrink-0 items-center gap-x-1.5">
                <span className="status-dot inline-block h-2 w-2 shrink-0 self-center rounded-full bg-green-600" aria-hidden="true"></span>
                <span className="whitespace-nowrap">360M+ products</span>
              </span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span className="whitespace-nowrap">950,000+ merchants</span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span className="whitespace-nowrap">SG &amp; US</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight mb-6">
              Compare products and prices across stores.
            </h1>
            <p className="text-xl font-semibold text-white mb-8 leading-relaxed">
              Compare prices and availability across merchants — Singapore and the United States,
              side by side, in one search.
            </p>
          </div>
          <HomeProductSearch />
          <div className="max-w-3xl mx-auto text-center mt-8 pb-8">
            <p className="text-base font-semibold text-white leading-snug px-4">
              Live product comparisons updated daily — real-time price tracking with a fast, agent-ready API.
            </p>
          </div>
        </div>
      </section>

      {/* Live comparison examples — comparison-first per BUY-75315 */}
      <section role="region" aria-label="Live comparisons" className="bg-white py-16 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-10">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Live comparisons</h2>
            <p className="text-lg text-gray-600 leading-relaxed">
              Real pages indexed by ChatGPT, Claude, and Perplexity. Each one prices the same product
              across multiple retailers and ships with a server-rendered table AI crawlers can read.
            </p>
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            {[
              { slug: "iphone-16-price-singapore", title: "iPhone 16 — Singapore", tagline: "Compare across authorised resellers" },
              { slug: "best-gaming-laptops-us", title: "Best gaming laptops — US 2026", tagline: "6 top models, priced live" },
              { slug: "laptop-singapore", title: "Laptop deals — Singapore", tagline: "Ultraportable, gaming, student picks" },
            ].map(({ slug, title, tagline }) => (
              <Link
                key={slug}
                href={`/${slug}`}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-5 hover:border-indigo-300 hover:bg-indigo-50 transition-colors min-w-0"
              >
                <h3 className="font-semibold text-gray-900 mb-1 truncate">{title}</h3>
                <p className="text-sm text-gray-600">{tagline}</p>
                <p className="mt-3 text-sm font-medium text-indigo-600">View comparison →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Prices second */}
      <section role="region" aria-label="Deals" className="bg-gray-50 py-16 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-10">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Today&rsquo;s prices</h2>
            <p className="text-lg text-gray-600 leading-relaxed">
              Real-time deals across categories. Every link routes through our affiliate layer
              so merchants stay attributed.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Electronics", href: "/deals?category=electronics" },
              { label: "Laptops", href: "/deals?category=laptops" },
              { label: "Smartphones", href: "/deals?category=smartphones" },
              { label: "Home & Living", href: "/deals?category=home-living" },
              { label: "Fashion", href: "/deals?category=fashion" },
              { label: "Health & Wellness", href: "/deals?category=health-wellness" },
            ].map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="mt-6">
            <Link href="/deals" prefetch={false} className="text-indigo-600 font-medium hover:text-indigo-700 transition-colors text-sm">
              Browse all deals →
            </Link>
          </div>
        </div>
      </section>

      {/* API third — Developers link */}
      <section role="region" aria-label="API for developers" className="bg-gray-900 py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-start gap-12">
            <div className="flex-1 text-white">
              <h2 className="text-2xl font-bold mb-4">For AI agents and developers</h2>
              <p className="text-gray-300 mb-6">
                One REST API and MCP server for product search, price comparison, and merchant handoff.
                Location-aware ranking, sub-250ms latency, structured JSON or compact agent mode.
              </p>
              <Link
                href="/developers"
                className="inline-flex items-center text-indigo-300 font-medium hover:text-indigo-200 transition-colors"
              >
                Read the developer docs →
              </Link>
            </div>
            <div className="flex-1 w-full min-w-0">
              <div className="bg-gray-800 rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 focus:ring-offset-gray-900" tabIndex={0} aria-label="Scrollable Python search example" role="region">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                  <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                  <span className="ml-2 text-xs text-gray-300 font-mono">search.py</span>
                </div>
                <pre tabIndex={0} className="p-4 text-sm text-gray-200 font-mono overflow-x-auto leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-inset">
                  <code>{codeSnippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <TrustLayer />
      <section role="region" aria-label="Content section" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Who BuyWhere is for</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
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
                <p className="text-sm text-gray-600 leading-relaxed flex-1 mb-4">{a.desc}</p>
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
      <section role="region" aria-label="Content section" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">How BuyWhere works</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              A neutral, agent-native product layer connecting merchant catalogs to AI-driven demand.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "1", title: "Merchant catalogs in", desc: "Retailers submit product feeds or we ingest from existing catalog sources." },
              { step: "2", title: "Structured discovery layer", desc: "Products are normalized, deduplicated, and indexed for semantic search." },
              { step: "3", title: "AI agent query & ranking", desc: "Agents call BuyWhere by natural language, filters, or category before they answer. Structured JSON back." },
              { step: "4", title: "Routed buyer demand out", desc: "Matched products route demand back to merchants through attribution and referral." },
            ].map((s) => (
              <div key={s.step} className="bg-white rounded-xl p-6 border border-gray-100">
                <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm mb-4">
                  {s.step}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value props */}
      <section role="region" aria-label="Content section" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why developers use BuyWhere</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
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
                <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

       {/* Why now */}
       <section role="region" aria-label="Content section" className="py-20 bg-indigo-50">
         <div className="max-w-6xl mx-auto px-4 sm:px-6">
           <div className="max-w-3xl mx-auto text-center">
             <h2 className="text-3xl font-bold text-gray-900 mb-6">Why AI shopping needs a neutral catalog layer</h2>
             <p className="text-gray-600 leading-relaxed mb-4">
               Platform APIs surface their own inventory first. Amazon APIs return Amazon products. Shopee returns Shopee products. Google Shopping returns shopping results, not a normalized product layer. For an AI agent trying to find the best match across the market, those are distribution channels — not the cross-merchant system of record.
             </p>
             <p className="text-gray-600 leading-relaxed mb-8">
               BuyWhere has no inventory to sell and no platform to favour. We index 300M+ products across 950,000+ independent storefronts worldwide into a single, structured API — with MCP tools, an A2A agent card, LangChain and OpenAI-tools SDKs, and an agent-optimized compact mode — so AI agents call one normalized, cross-merchant product layer instead of reconciling one platform&rsquo;s version of the market.
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
      <section role="region" aria-label="Content section" className="py-20 bg-white border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">FAQ for agent builders</h2>
            <p className="text-lg text-gray-600">
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

      {/* Price comparisons hub — crawlable entry point into /compare cluster */}
      <section role="region" aria-label="Content section" className="py-16 bg-slate-50 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Price comparison guides</h2>
            <p className="text-gray-600 leading-relaxed">
              Compare prices across merchants for the most searched products in Singapore, the US, and Southeast Asia.
            </p>
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-indigo-600">
              {homeTopDealCopy}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 mb-6">
            {[
              { label: "Electronics", href: "/compare?category=electronics" },
              { label: "Laptops", href: "/compare?category=laptops" },
              { label: "Smartphones", href: "/compare?category=smartphones" },
              { label: "Home & Living", href: "/compare?category=home-living" },
              { label: "Fashion", href: "/compare?category=fashion" },
              { label: "Health & Wellness", href: "/compare?category=health-wellness" },
            ].map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            <Link
              href="/blog/best-laptop-deals-singapore"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              Best laptop deals in Singapore →
            </Link>
            <Link
              href="/blog/cheapest-iphone-singapore-2026"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              Cheapest iPhone in Singapore 2026 →
            </Link>
            <Link
              href="/blog/best-gaming-laptops-us-2026"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              Best gaming laptops in the US →
            </Link>
          </div>
          <Link
            href="/compare"
            prefetch={false}
            className="text-indigo-600 font-medium hover:text-indigo-700 transition-colors text-sm"
          >
            Browse all price comparisons →
          </Link>
        </div>
      </section>

      {/* PopularComparisons — 5 marketing page cards */}
      <PopularComparisons variant="hero" />

      {/* CTA */}
      <section role="region" aria-label="Content section" className="py-20 bg-indigo-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Launch product-aware agents without building a catalog pipeline.</h2>
          <p className="text-white mb-8 text-lg">
            If your agent needs to answer &ldquo;what should I buy?&rdquo;, &ldquo;where can I get it?&rdquo;, or &ldquo;what are the best options in Singapore, the US, or Southeast Asia?&rdquo; BuyWhere gives you the product layer to ship faster.
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

      </main>
      <Footer />
    </div>
    </>
  );
}
