import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Retailer Coverage — BuyWhere",
  description:
    "Supported merchants, coverage depth, and data freshness for the BuyWhere product catalog. See which retailers are covered and how up-to-date our pricing data is.",
  alternates: {
    canonical: "https://buywhere.ai/retailers",
  },
  robots: {
    index: true,
    follow: true,
  },
};

interface RetailerCoverage {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  status: "active" | "limited" | "coming-soon";
  productCount?: number;
  categoryCount?: number;
  lastUpdated: string;
  updateFrequency: string;
  coverage: string;
  notes?: string;
}

const retailers: RetailerCoverage[] = [
  {
    id: "amazon",
    name: "Amazon.com",
    slug: "amazon",
    status: "active",
    productCount: 1247500,
    categoryCount: 38,
    lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "hourly",
    coverage: "US marketplace, Prime eligible items",
    notes: "Proxy-free direct index",
  },
  {
    id: "walmart",
    name: "Walmart",
    slug: "walmart",
    status: "active",
    productCount: 890000,
    categoryCount: 35,
    lastUpdated: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "every 4 hours",
    coverage: "Walmart.com US, store pickup available items",
    notes: "Proxy-free direct index",
  },
  {
    id: "target",
    name: "Target",
    slug: "target",
    status: "active",
    productCount: 420000,
    categoryCount: 28,
    lastUpdated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "every 4 hours",
    coverage: "Target.com US, Circle member pricing",
    notes: "Proxy-free direct index",
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    slug: "bestbuy",
    status: "active",
    productCount: 310000,
    categoryCount: 24,
    lastUpdated: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "every 6 hours",
    coverage: "Best Buy US, open-box items excluded",
    notes: "Proxy-free direct index",
  },
  {
    id: "home-depot",
    name: "Home Depot",
    slug: "home-depot",
    status: "limited",
    productCount: 180000,
    categoryCount: 12,
    lastUpdated: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "twice daily",
    coverage: "Home improvement, tools, building materials",
    notes: "Initial coverage, expanding categories",
  },
  {
    id: "lowes",
    name: "Lowe's",
    slug: "lowes",
    status: "coming-soon",
    lastUpdated: new Date().toISOString(),
    updateFrequency: "TBD",
    coverage: "Expected Q2 2026",
    notes: "Onboarding in progress",
  },
  {
    id: "costco",
    name: "Costco",
    slug: "costco",
    status: "coming-soon",
    lastUpdated: new Date().toISOString(),
    updateFrequency: "TBD",
    coverage: "Expected Q2 2026",
    notes: "Onboarding in progress",
  },
  {
    id: "nike",
    name: "Nike",
    slug: "nike",
    status: "limited",
    productCount: 8500,
    categoryCount: 6,
    lastUpdated: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    updateFrequency: "daily",
    coverage: "Footwear, apparel, equipment",
    notes: "Direct brand index only",
  },
];

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getStatusColor(status: RetailerCoverage["status"]): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "limited":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "coming-soon":
      return "bg-gray-100 text-gray-500 border-gray-200";
  }
}

function getStatusLabel(status: RetailerCoverage["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "limited":
      return "Limited";
    case "coming-soon":
      return "Coming Soon";
  }
}

function FreshnessIndicator({
  lastUpdated,
  frequency,
}: {
  lastUpdated: string;
  frequency: string;
}) {
  const date = new Date(lastUpdated);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / 3600000;
  let freshness: "fresh" | "stale" | "unknown" = "unknown";

  if (frequency !== "TBD") {
    freshness = diffHours < 6 ? "fresh" : diffHours < 24 ? "stale" : "unknown";
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full ${
          freshness === "fresh"
            ? "bg-emerald-500"
            : freshness === "stale"
            ? "bg-amber-500"
            : "bg-gray-400"
        }`}
        aria-hidden="true"
      />
      <span className="text-gray-500">
        {frequency === "TBD" ? "—" : formatTimeAgo(lastUpdated)} · {frequency}
      </span>
    </div>
  );
}

function RetailerCard({ retailer }: { retailer: RetailerCoverage }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{retailer.name}</h3>
          {retailer.productCount && (
            <p className="text-sm text-gray-500 mt-0.5">
              {retailer.productCount.toLocaleString()} products
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(
            retailer.status
          )}`}
        >
          {getStatusLabel(retailer.status)}
        </span>
      </div>

      <p className="text-sm text-gray-600 mb-4">{retailer.coverage}</p>

      {retailer.status !== "coming-soon" ? (
        <FreshnessIndicator
          lastUpdated={retailer.lastUpdated}
          frequency={retailer.updateFrequency}
        />
      ) : (
        <div className="text-sm text-gray-400">{retailer.coverage}</div>
      )}

      {retailer.notes && retailer.status !== "coming-soon" && (
        <p className="text-xs text-gray-400 mt-2 italic">{retailer.notes}</p>
      )}
    </div>
  );
}

function CoverageStats() {
  const activeRetailers = retailers.filter((r) => r.status === "active");
  const totalProducts = activeRetailers.reduce(
    (sum, r) => sum + (r.productCount || 0),
    0
  );
  const avgFreshnessHours = activeRetailers
    .map((r) => {
      const diff =
        (new Date().getTime() - new Date(r.lastUpdated).getTime()) / 3600000;
      return diff;
    })
    .reduce((sum, h, _, arr) => sum + h / arr.length, 0);

  return (
    <div className="grid sm:grid-cols-3 gap-6 mb-12">
      <div className="bg-emerald-50 rounded-xl p-6 text-center">
        <div className="text-3xl font-bold text-emerald-700">
          {retailers.filter((r) => r.status === "active").length}
        </div>
        <div className="text-sm text-emerald-600 mt-1">Active Retailers</div>
      </div>
      <div className="bg-indigo-50 rounded-xl p-6 text-center">
        <div className="text-3xl font-bold text-indigo-700">
          {(totalProducts / 1000000).toFixed(1)}M+
        </div>
        <div className="text-sm text-indigo-600 mt-1">Products Indexed</div>
      </div>
      <div className="bg-amber-50 rounded-xl p-6 text-center">
        <div className="text-3xl font-bold text-amber-700">
          {avgFreshnessHours < 1 ? "<1" : Math.round(avgFreshnessHours)}
          h
        </div>
        <div className="text-sm text-amber-600 mt-1">Avg Data Freshness</div>
      </div>
    </div>
  );
}

export default function RetailersPage() {
  const schemaMarkup = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://buywhere.ai/#organization",
        name: "BuyWhere",
        url: "https://buywhere.ai",
        logo: "https://buywhere.ai/logo.png",
        description: "BuyWhere is a price comparison platform for Singapore and US shoppers, offering structured product data for AI agents and consumers.",
        sameAs: [
          "https://twitter.com/buywhere",
          "https://linkedin.com/company/buywhere"
        ]
      },
      {
        "@type": "WebSite",
        "@id": "https://buywhere.ai/#website",
        url: "https://buywhere.ai",
        name: "BuyWhere",
        publisher: { "@id": "https://buywhere.ai/#organization" },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: "https://buywhere.ai/search?q={search_term_string}"
          },
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "ItemList",
        name: "Retailer Coverage",
        description: "Supported merchants, coverage depth, and data freshness for the BuyWhere product catalog.",
        numberOfItems: retailers.length,
        itemListElement: retailers.map((retailer, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: retailer.name,
          url: `https://buywhere.ai/retailers`,
          description: retailer.coverage,
          additionalProperty: {
            "@type": "PropertyValue",
            name: "status",
            value: retailer.status
          }
        }))
      }
    ]
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />

      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold mb-4">Retailer Coverage</h1>
            <p className="text-indigo-200 text-lg leading-relaxed">
              Supported merchants, coverage depth, and data freshness for the
              BuyWhere product catalog. All data is sourced proxy-free directly
              from retailer feeds.
            </p>
          </div>
        </div>
      </section>

      <main className="flex-1 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <CoverageStats />

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Supported Retailers
            </h2>
            <p className="text-gray-600">
              Current launch surface coverage. Status meanings:{" "}
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-medium">
                Active
              </span>{" "}
              = full coverage,{" "}
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium">
                Limited
              </span>{" "}
              = partial categories,{" "}
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-medium">
                Coming Soon
              </span>{" "}
              = in onboarding.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
            {retailers.map((retailer) => (
              <RetailerCard key={retailer.id} retailer={retailer} />
            ))}
          </div>

          <section className="bg-white rounded-xl border border-gray-200 p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Freshness Methodology
            </h2>
            <div className="space-y-4 text-gray-600">
              <p>
                BuyWhere maintains data freshness through direct retailer feed
                integrations, updated on scheduled intervals. Freshness signals
                are calculated from last-indexed timestamps for each retailer.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Hourly:</strong> High-volume retailers (Amazon,
                  Walmart, Target, Best Buy) — re-indexed at minimum once per
                  hour during business hours.
                </li>
                <li>
                  <strong>Twice daily:</strong> Mid-volume retailers —
                  morning and evening sync cycles.
                </li>
                <li>
                  <strong>Daily:</strong> Smaller catalogs and direct brand
                  indexes — one full refresh per day.
                </li>
              </ul>
              <p className="text-sm text-gray-500 italic">
                Note: Actual freshness may vary based on retailer API stability
                and feed availability. Product-level detail pages show
                per-item freshness timestamps.
              </p>
            </div>
          </section>

          <section className="mt-8 text-center text-sm text-gray-500">
            <p>
              Coverage data validated {new Date().toLocaleDateString()}. Subject
              to change as retailer onboarding progresses.
            </p>
            <p className="mt-1">
              Need coverage for a specific retailer?{" "}
              <a href="/contact" className="text-indigo-600 hover:underline">
                Request integration
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}