import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { PopularComparisons } from "@/components/PopularComparisons";

import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Use Cases — BuyWhere",
  description:
    "Explore use cases for BuyWhere's product catalog API: shopping assistants, price comparison agents, and more.",
  path: "/use-cases/",
});

const useCases = [
  {
    number: "01",
    title: "Shopping Assistant",
    description:
      "Give your AI assistant real product data to back up every recommendation. When a user asks \"find me a wireless keyboard under $80,\" your agent queries BuyWhere, receives structured SKUs with prices, specs, and purchase URLs, and returns a ranked shortlist — not a hallucinated product list. No scraping, no stale data.",
    code: `import requests

API_KEY = "bw_live_your_key_here"

resp = requests.get(
    "https://api.buywhere.ai/v1/products/search",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={"q": "wireless keyboard under $80", "limit": 5},
)
products = resp.json()["items"]

for p in products:
    print(p["name"], p["price"], p["currency"])
    print("Buy:", p["url"])`,
    lang: "python",
  },
  {
    number: "02",
    title: "Price Comparison Agent",
    description:
      "Build an agent that compares prices across Singapore's retail landscape without maintaining integrations with ten different retailer APIs. BuyWhere normalises product data across merchants into a consistent schema — same fields, same units, same structure — so your agent can sort, filter, and present comparisons without parsing mismatched responses.",
    code: `import requests

API_KEY = "bw_live_your_key_here"

resp = requests.get(
    "https://api.buywhere.ai/v1/products/search",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={"q": "MacBook Pro M3", "limit": 20},
)
items = resp.json()["items"]

# Sort by price across the catalog
sorted_items = sorted(items, key=lambda x: x["price"])
for item in sorted_items:
    print(f"{item['source']:15} {item['currency']} {item['price']:>8.2f}  {item['name'][:40]}")`,
    lang: "python",
  },
  {
    number: "03",
    title: "Gift Recommender",
    description:
      "Context-aware gift finders need catalog depth and attribute richness, not just a list of popular items. Query BuyWhere with intent-style parameters — category, budget, recipient persona — and receive products with enough metadata for your agent to reason about fit. Purchase URLs are included so every recommendation links to a real product.",
    code: `import requests

API_KEY = "bw_live_your_key_here"

# LLM resolves "gifts for tech-savvy teenager under $50"
# → structured query to BuyWhere
resp = requests.get(
    "https://api.buywhere.ai/v1/products/search",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={
        "q": "tech gadgets gifts under $50",
        "limit": 10,
    },
)
gifts = resp.json()["items"]

# Return gifts with purchase URLs
recommendations = [
    {"name": g["name"], "price": g["price"], "buy": g["url"]}
    for g in gifts
    if g["price"] <= 50 and g["is_available"]
]`,
    lang: "python",
  },
  {
    number: "04",
    title: "Inventory & Availability Checker",
    description:
      "Let users ask \"is this in stock?\" and get a real answer. BuyWhere indexes availability signals alongside price and product metadata, so your agent can surface in-stock alternatives when a product is unavailable or flag restocks as they happen. No manual polling of individual merchant pages required.",
    code: `import requests

API_KEY = "bw_live_your_key_here"

def find_available(product_name: str) -> list:
    resp = requests.get(
        "https://api.buywhere.ai/v1/products/search",
        headers={"Authorization": f"Bearer {API_KEY}"},
        params={"q": product_name, "limit": 20},
    )
    items = resp.json()["items"]

    in_stock = [i for i in items if i["is_available"]]
    out_of_stock = [i for i in items if not i["is_available"]]

    if in_stock:
        return in_stock
    # Surface alternatives when primary is unavailable
    return [{"message": "Out of stock. Showing similar items."}, *out_of_stock[:3]]`,
    lang: "python",
  },
  {
    number: "05",
    title: "Deal Alert Bot",
    description:
      "Build price-drop and deal notification agents without managing your own price history infrastructure. Poll BuyWhere for a product set on a schedule, compare against a stored baseline, and trigger alerts when prices move. BuyWhere handles the catalog layer; you own the notification logic.",
    code: `import requests, json, pathlib

API_KEY = "bw_live_your_key_here"
BASELINE_FILE = pathlib.Path("price_baseline.json")

def check_price_drops(queries: list[str]) -> list[dict]:
    baseline = json.loads(BASELINE_FILE.read_text()) if BASELINE_FILE.exists() else {}
    alerts = []

    for q in queries:
        resp = requests.get(
            "https://api.buywhere.ai/v1/products/search",
            headers={"Authorization": f"Bearer {API_KEY}"},
            params={"q": q, "limit": 1},
        )
        item = resp.json()["items"][0]
        prev_price = baseline.get(item["id"], item["price"])

        if item["price"] < prev_price:
            alerts.append({
                "name": item["name"],
                "was": prev_price,
                "now": item["price"],
                "buy": item["url"],
            })
        baseline[item["id"]] = item["price"]

    BASELINE_FILE.write_text(json.dumps(baseline))
    return alerts`,
    lang: "python",
  },
];

export default function UseCasesPage() {
  const schema = buildWebPageSchema({
    path: "/use-cases",
    name: "Use Cases — BuyWhere",
    description:
      "Explore use cases for BuyWhere's product catalog API: shopping assistants, price comparison agents, deal bots, and more.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Use Cases", path: "/use-cases" },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" tabIndex={-1}>
      {/* Hero */}
      <section className="bg-gray-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-indigo-400 text-sm font-mono mb-4">&#47;&#47; use cases</div>
            <h1 className="text-4xl font-bold mb-4">What developers build with BuyWhere API</h1>
            <p className="text-gray-300 text-lg leading-relaxed">
              From shopping assistants to deal bots — real patterns, working code.
            </p>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-20">
          {useCases.map((uc) => (
            <div key={uc.number} className="grid md:grid-cols-2 gap-12 items-start">
              {/* Description */}
              <div>
                <div className="text-indigo-500 text-sm font-mono font-bold mb-2">{uc.number}</div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">{uc.title}</h2>
                <p className="text-gray-600 leading-relaxed">{uc.description}</p>
              </div>

              {/* Code */}
              <div className="bg-gray-900 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-700">
                  <span className="w-3 h-3 rounded-full bg-red-500/60"></span>
                  <span className="w-3 h-3 rounded-full bg-yellow-500/60"></span>
                  <span className="w-3 h-3 rounded-full bg-green-500/60"></span>
                  <span className="ml-3 text-gray-400 text-xs font-mono">{uc.lang}</span>
                </div>
                <pre className="p-5 overflow-x-auto text-sm">
                  <code className="text-gray-300 font-mono leading-relaxed whitespace-pre">{uc.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-indigo-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to build?</h2>
          <p className="text-indigo-200 mb-8 text-lg">
            Get an API key and make your first query in under 5 minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-600 font-semibold rounded-xl hover:bg-indigo-50 transition-colors"
            >
              View API docs →
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center px-6 py-3 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <PopularComparisons variant="footer" />

      </main>
      <Footer />
    </div>
  </>
  );
}
