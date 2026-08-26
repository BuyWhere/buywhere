import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Coupons & Deals — Save More with BuyWhere",
  description:
    "Find the best coupons and deals across retailers. BuyWhere tracks price drops, discounts, and promotions so you never overpay.",
  alternates: {
    canonical: toSiteUrl("/coupons"),
  },
  robots: {
    index: true,
    follow: true,
  },
};

interface CouponCategory {
  name: string;
  description: string;
  url: string;
  icon: string;
}

const categories: CouponCategory[] = [
  {
    name: "Electronics Deals",
    description: "Discounts on phones, laptops, headphones, and more from Amazon, Best Buy, and Shopee.",
    url: "/deals",
    icon: "💻",
  },
  {
    name: "Fashion & Beauty",
    description: "Style and beauty deals from Lazada, Shopee Mall, and marketplace sellers.",
    url: "/deals",
    icon: "👗",
  },
  {
    name: "Home & Living",
    description: "Appliances, furniture, and home improvement deals across the retailers we track.",
    url: "/deals",
    icon: "🏠",
  },
  {
    name: "Grocery & Daily Essentials",
    description: "Fresh deals on daily needs from Lazada, Shopee, and local stores.",
    url: "/deals",
    icon: "🛒",
  },
];

export default function CouponsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <section className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-4">Coupons & Deals</h1>
          <p className="text-amber-100 text-lg leading-relaxed max-w-2xl">
            BuyWhere tracks price drops and promotions across all covered retailers. Find the best deals, compare prices, and save more.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Browse by category</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {categories.map((cat) => (
              <Link
                key={cat.name}
                href={cat.url}
                className="block p-6 bg-gray-50 rounded-xl border border-gray-100 hover:border-amber-200 hover:shadow-sm transition-all"
              >
                <div className="text-3xl mb-3">{cat.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{cat.name}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{cat.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Never miss a deal</h2>
          <p className="text-gray-600 leading-relaxed mb-8">
            BuyWhere continuously monitors prices across the retailers we track. When prices drop, you see it immediately. Set up alerts to get notified when products you care about go on sale.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/deals"
              className="inline-flex items-center justify-center px-6 py-3 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 transition-colors"
            >
              View today&apos;s deals →
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
            >
              Search for a product
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
