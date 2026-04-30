import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { DealOfTheDay } from "@/components/DealOfTheDay";
import CategoryFilterSection from "@/components/CategoryFilterSection";
import { TrendingDealsGrid } from "@/components/TrendingDealsGrid";
import type { Metadata } from "next";

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
        url: "https://buywhere.ai/assets/img/og-image.png",
        width: 1200,
        height: 630,
        alt: "Top US Deals - Price Drops from Amazon, Walmart, Target & Best Buy | BuyWhere",
      },
      {
        url: "https://buywhere.ai/assets/img/og-image.svg",
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
    canonical: "https://buywhere.ai/deals/us",
  },
};

function generateMockDeals() {
  return [
    {
      id: 1,
      name: 'Apple AirPods Pro 2',
      price: 189.99,
      original_price: 249.99,
      discount_pct: 24,
      merchant: 'Amazon',
      url: 'https://amazon.com',
      image_url: 'https://via.placeholder.com/200',
    },
    {
      id: 2,
      name: 'Dyson V15 Vacuum',
      price: 549.99,
      original_price: 749.99,
      discount_pct: 27,
      merchant: 'Walmart',
      url: 'https://walmart.com',
      image_url: 'https://via.placeholder.com/200',
    },
  ];
}

export default function DealsPage() {
  const mockDeals = generateMockDeals();
  const dealOfTheDay = mockDeals.reduce((best, deal) => {
    if (!best) return deal;
    const bestDiscount = best.discount_pct || 0;
    const dealDiscount = deal.discount_pct || 0;
    return dealDiscount > bestDiscount ? deal : best;
  }, mockDeals[0]);

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main className="flex-1">
        <section className="py-12 bg-gray-50 border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-2">
              <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                LIVE DEALS
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Top US Deals
            </h1>
            <p className="text-gray-500">
              Real-time price drops from Amazon, Walmart, Target & Best Buy
            </p>
          </div>
        </section>

        <section className="py-10 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <DealOfTheDay deal={dealOfTheDay} />
          </div>
        </section>

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
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Trending Deals</h2>
              <span className="text-sm text-gray-500">12 products</span>
            </div>
            <TrendingDealsGrid deals={mockDeals} loading={false} />
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