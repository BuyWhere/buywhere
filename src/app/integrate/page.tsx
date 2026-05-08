import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "BuyWhere Integration Guide — MCP Server & API for AI Agents",
  description:
    "Connect BuyWhere to your AI agent in minutes. Use the MCP server to give your agent product search, price comparison, and deal discovery across Singapore and the US.",
  alternates: {
    canonical: "https://buywhere.ai/integrate",
  },
};

const mcpTools = [
  {
    name: "search_products",
    description:
      "Full-text product search with filters for keyword, merchant, price, category, country, currency, and availability. Returns ranked results across Shopee, Lazada, Amazon, Walmart, and more.",
    exampleSg: "search_products({q: 'mechanical keyboard', country_code: 'SG', limit: 5})",
    exampleUs: "search_products({q: 'mechanical keyboard', country_code: 'US', currency: 'USD', limit: 5})",
    status: "live",
  },
  {
    name: "get_product",
    description:
      "Get full product details by BuyWhere product ID — includes current price, brand, category, ratings, merchant info, and specifications.",
    exampleSg: "get_product({id: 'bw_sg_12345', currency: 'SGD'})",
    exampleUs: "get_product({id: 'bw_us_67890', currency: 'USD'})",
    status: "live",
  },
  {
    name: "compare_products",
    description:
      "Compare 2–10 products side-by-side across merchants. Returns price, brand, rating, category path, and merchant for each product.",
    exampleSg: "compare_products({ids: ['bw_sg_001', 'bw_sg_002', 'bw_sg_003']})",
    exampleUs: "compare_products({ids: ['bw_us_001', 'bw_us_002']})",
    status: "live",
  },
  {
    name: "get_deals",
    description:
      "Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.",
    exampleSg: "get_deals({country_code: 'SG', min_discount: 20, limit: 20})",
    exampleUs: "get_deals({country_code: 'US', min_discount: 20, limit: 20})",
    status: "live",
  },
  {
    name: "list_categories",
    description:
      "List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.",
    exampleSg: "list_categories({currency: 'SGD'})",
    exampleUs: "list_categories({currency: 'USD'})",
    status: "live",
  },
  {
    name: "find_best_price",
    description:
      "Find the single cheapest current listing for a product across all merchants. Use when a user asks about prices or wants to find the best deal.",
    exampleSg: "find_best_price({product_name: 'iphone 15 pro 256gb', country_code: 'SG'})",
    exampleUs: "find_best_price({product_name: 'iphone 15 pro 256gb', country_code: 'US'})",
    status: "live",
  },
];

const examplePrompts = [
  {
    title: "Best-price lookup",
    description:
      "Your agent finds the cheapest option for a product across all Singapore platforms.",
    prompt:
      "Find the best price for a Sony WH-1000XM5 wireless headphone across Singapore shops. Show me where to buy it cheapest and include the affiliate link.",
    tools: ["search_products", "find_best_price"],
  },
  {
    title: "Deal discovery",
    description:
      "Your agent surfaces current deals in a category, sorted by discount.",
    prompt:
      "Show me the best tech deals available right now in Singapore — at least 30% off. List them with original price, sale price, and where to buy.",
    tools: ["get_deals"],
  },
  {
    title: "Product search & comparison",
    description:
      "Your agent searches for products and presents options with key details.",
    prompt:
      "I need a birthday gift for my brother — something under $50. Find popular wireless earbuds available in Singapore with prices and links.",
    tools: ["search_products"],
  },
  {
    title: "Category browsing",
    description: "Your agent explores what categories and products are available.",
    prompt:
      "What product categories does BuyWhere have? I'm looking to browse home appliances.",
    tools: ["list_categories"],
  },
];

const setupSteps = [
  {
    step: "1",
    title: "Get a BuyWhere API key",
    description:
      "Sign up at buywhere.ai/api-keys to get an instant beta key. No credit card required.",
    cta: "Get API key",
    ctaHref: "/api-keys",
  },
  {
    step: "2",
    title: "Configure the MCP server",
    description:
      "Point the MCP server to your API key and the BuyWhere API URL. The server runs locally on your machine.",
    cta: "View setup guide",
    ctaHref: "/quickstart#connect-mcp",
  },
  {
    step: "3",
    title: "Connect to your agent",
    description:
      "Add BuyWhere to your MCP-compatible agent: Claude Desktop, Cursor, or any other MCP client.",
    cta: "See example configs",
    ctaHref: "/quickstart",
  },
];

export default function IntegratePage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://buywhere.ai/integrate#faq",
    mainEntity: [
      {
        "@type": "Question",
        name: "How do I connect BuyWhere MCP to Claude Desktop?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Add BuyWhere to your claude_desktop_config.json file with the npx command and your API key. The configuration includes the server command (npx), arguments (-y @buywhere/mcp-server), and environment variable (BUYWHERE_API_KEY). Full step-by-step instructions are on the BuyWhere quickstart page."
        }
      },
      {
        "@type": "Question",
        name: "What MCP tools does BuyWhere expose?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere exposes six MCP tools: search_products (full-text product search across all merchants), get_product (product details by ID), compare_products (side-by-side comparison of 2–10 products), get_deals (discounted products sorted by discount percentage), list_categories (browse available categories), and find_best_price (cheapest current listing across all merchants)."
        }
      },
      {
        "@type": "Question",
        name: "Do I need an API key to use BuyWhere MCP?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes, you need a BuyWhere API key. Get a free key at buywhere.ai/api-keys — no credit card required. The free tier includes 1,000 API calls per month."
        }
      },
      {
        "@type": "Question",
        name: "Which AI agents support BuyWhere MCP?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere MCP works with any MCP-compatible agent: Claude Desktop, Cursor, Cline, Windsurf, VS Code (with MCP extension), LangChain, CrewAI, AutoGen, and LlamaIndex."
        }
      },
      {
        "@type": "Question",
        name: "What countries does BuyWhere MCP cover?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere MCP covers Singapore (SG) with the full catalog live, and United States (US) in preview. Additional markets including Malaysia, Thailand, Vietnam, Philippines, and Indonesia are planned."
        }
      },
      {
        "@type": "Question",
        name: "How is BuyWhere different from web scraping for AI agents?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere returns structured, normalized product data from official API feeds and merchant partnerships — no HTML parsing, no CAPTCHAs, no IP blocking. One MCP tool call returns clean JSON that LLMs can parse directly, unlike scraped data which breaks whenever a site changes its layout."
        }
      },
      {
        "@type": "Question",
        name: "Can I use BuyWhere without MCP?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. The same product catalog is available via REST API at api.buywhere.ai/v1. MCP is an optional wrapper that makes the tools available to AI agents with zero custom integration code."
        }
      },
      {
        "@type": "Question",
        name: "What is the difference between the free tier and paid plans?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The free tier includes 1,000 API calls per month with basic search and no price history. Paid plans (Developer at $29/month for 50,000 calls, Business at $99/month for 500,000 calls with priority support and webhooks) unlock full API access including price history, priority support, and webhook integrations."
        }
      }
    ]
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Script id="faq-schema" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqSchema)}
      </Script>
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.12),_transparent_40%),linear-gradient(135deg,#0f172a_0%,#1e1b4b_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-indigo-200">
              MCP Server + REST API
            </div>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Give your AI agent a product catalog layer for Singapore commerce.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              BuyWhere exposes product search, price comparison, and deal discovery
              as tools your agent can call directly — no scraping, no HTML parsing,
              no rate-limit battles with e-commerce sites.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Get API key
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                View quickstart
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              MCP tools
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">
              6 tools available via MCP
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Each tool maps to a BuyWhere API endpoint. The MCP server handles
              authentication and returns formatted text your agent can reason over.{" "}
              <span className="font-medium text-slate-700">
                Singapore tools are live; US catalog is in preview.
              </span>
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {mcpTools.map((tool) => (
              <div
                key={tool.name}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-mono text-sm font-semibold text-indigo-600">
                      {tool.name}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {tool.description}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    tool.status === 'live'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {tool.status === 'live' ? 'Live' : 'Preview'}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl bg-slate-950 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-400">SG — Live</span>
                    </div>
                    <p className="font-mono text-xs text-slate-300">{tool.exampleSg}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-amber-800/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-400">US — Preview</span>
                    </div>
                    <p className="font-mono text-xs text-slate-300">{tool.exampleUs}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Example prompts
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">
              Prompt your agent to use BuyWhere tools
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Copy these prompts into your agent workflow. Each one triggers one or
              more BuyWhere MCP tools.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {examplePrompts.map((prompt) => (
              <div
                key={prompt.title}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {prompt.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {prompt.description}
                </p>
                <div className="mt-4 rounded-xl bg-white border border-slate-200 p-4">
                  <p className="text-sm italic leading-relaxed text-slate-700">
                    &ldquo;{prompt.prompt}&rdquo;
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {prompt.tools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Setup
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">
              Get started in three steps
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {setupSteps.map((step) => (
              <div
                key={step.step}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white font-bold">
                  {step.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {step.description}
                </p>
                <Link
                  href={step.ctaHref}
                  className="mt-4 inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {step.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-indigo-600 py-20 text-white">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold">
            Ready to power your agent with product data?
          </h2>
          <p className="mt-4 text-lg text-indigo-200">
            Get an API key and start building. The MCP server is live and ready for
            agent workflows today.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/api-keys"
              className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
            >
              Get API key
            </Link>
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center rounded-xl border border-indigo-400 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              View full quickstart
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}