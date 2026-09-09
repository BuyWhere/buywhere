import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { DealOfTheDay } from "@/components/DealOfTheDay";
import CategoryFilterSection from "@/components/CategoryFilterSection";
import { TrendingDealsGrid } from "@/components/TrendingDealsGrid";
import Schema from "@/components/Schema";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import { buildCollectionPageSchema } from "@/lib/page-schema";

export const metadata: Metadata = {
  title: "Top US Deals - Price Drops from Amazon, Walmart, Target & Best Buy | BuyWhere",
  description: "Find the latest price drops and deals on electronics, home goods, fashion, and more from Amazon, Walmart, Target, and Best Buy.",
  openGraph: {
    title: "Top US Deals - Price Drops from Amazon, Walmart, Target & Best Buy | BuyWhere",
    description: "Find the latest price drops and deals on electronics, home goods, fashion, and more from Amazon, Walmart, Target, and Best Buy.",
    type: "website",
    locale: "en_US",
    siteName: "BuyWhere US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Top US Deals - Price Drops from Amazon, Walmart, Target & Best Buy | BuyWhere",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Top US Deals - Price Drops from Amazon, Walmart, Target & Best Buy | BuyWhere",
    description: "Find the latest price drops and deals on electronics, home goods, fashion, and more from Amazon, Walmart, Target, and Best Buy.",
  },
  alternates: {
    canonical: toSiteUrl("/deals/us"),
  },
  robots: {
    index: true,
    follow: true,
  },
};

interface Deal {
  id: number;
  name: string;
  price: number;
  original_price?: number;
  discount_pct?: number;
  merchant: string;
  url: string;
  image_url?: string;
  is_exclusive?: boolean;
  rating?: number;
  review_count?: number;
}

interface DealsApiResponse {
  deals?: Deal[];
  data?: Deal[];
}

const API_BASE_URL =
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

const DEALS_API_KEY =
  process.env.BUYWHERE_API_KEY ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
  "";

// BUY-60872 (governance rule #10): no invented catalog data on any production surface.
// This page fetches live deals from the API and renders an honest empty state when
// no deals are available — never a hardcoded fallback.
async function getDeals(): Promise<Deal[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/deals?country=US&limit=12`, {
      headers: DEALS_API_KEY ? { Authorization: `Bearer ${DEALS_API_KEY}` } : {},
      next: { revalidate: 900 }, // 15-minute cache — mirrors server refresh cadence
    });
    if (!res.ok) return [];
    const data: DealsApiResponse = await res.json().catch(() => ({}));
    const deals: Deal[] = Array.isArray(data.deals)
      ? data.deals
      : Array.isArray(data.data)
        ? data.data
        : [];
    return deals;
  } catch {
    return [];
  }
}

export default async function DealsPage() {
  const deals = await getDeals();
  const schema = buildCollectionPageSchema({
    path: "/deals/us",
    name: "Top US Deals | BuyWhere",
    description:
      "Find the latest price drops and deals on electronics, home goods, fashion, and more from Amazon, Walmart, Target, and Best Buy.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Deals", path: "/deals/us" },
    ],
  });
  const dealOfTheDay = deals.length > 0
    ? deals.reduce<Deal | null>((best, deal) => {
        if (!best) return deal;
        const bestDiscount = best.discount_pct || 0;
        const dealDiscount = deal.discount_pct || 0;
        return dealDiscount > bestDiscount ? deal : best;
      }, null)
    : null;

  return (
    <div className="flex flex-col min-h-screen">
      <Schema data={schema} />
      <Nav />

      <main id="main-content" className="flex-1">
        <section className="py-12 bg-gray-50 border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-2">
              {deals.length > 0 ? (
                <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                  LIVE DEALS
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-medium rounded-full">
                  NO LIVE DEALS AVAILABLE
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Top US Deals
            </h1>
            <p className="text-gray-500">
              Real-time price drops from Amazon, Walmart, Target &amp; Best Buy
            </p>
          </div>
        </section>

        {dealOfTheDay && (
          <section className="py-10 bg-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <DealOfTheDay deal={dealOfTheDay} />
            </div>
          </section>
        )}

        <section className="py-10 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Browse by Category</h2>
              <CategoryFilterSection />
            </div>
          </div>
        </section>

        <section className="py-10 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {deals.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-gray-900">Trending Deals</h2>
                  <span className="text-sm text-gray-500">{deals.length} products</span>
                </div>
                <TrendingDealsGrid deals={deals} loading={false} />
              </>
            ) : (
              <div className="text-center py-16 rounded-3xl border border-dashed border-gray-300 bg-gray-50">
                <p className="text-gray-500 text-base font-medium">
                  No live deals are available right now.
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Deals are sourced directly from Amazon, Walmart, Target, and Best Buy.
                  Check back shortly or browse products on the{" "}
                  <a href="/compare/us" className="text-indigo-600 hover:underline">
                    comparison page
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="py-10 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <p className="text-xs text-gray-400">
              Auto-refreshes every 15 minutes · Prices and availability may vary
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
