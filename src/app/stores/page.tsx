import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Stores — Shop Across Top Retailers | BuyWhere",
  description:
    "Browse stores covered by BuyWhere's product catalog. Compare prices across Shopee, Lazada, Amazon, Walmart, and more.",
  alternates: {
    canonical: toSiteUrl("/stores"),
  },
  robots: {
    index: true,
    follow: true,
  },
};

interface StoreEntry {
  name: string;
  slug: string;
  country: string;
  productCount?: number;
  url: string;
}

const stores: StoreEntry[] = [
  { name: "Shopee Singapore", slug: "shopee_sg", country: "Singapore", productCount: 820000, url: "/search?q=&source=shopee_sg&country=sg" },
  { name: "Lazada Singapore", slug: "lazada_sg", country: "Singapore", productCount: 650000, url: "/search?q=&source=lazada_sg&country=sg" },
  { name: "Amazon US", slug: "amazon_us", country: "United States", productCount: 1247500, url: "/search?q=&source=amazon_us&country=us" },
  { name: "Walmart US", slug: "walmart_us", country: "United States", productCount: 890000, url: "/search?q=&source=walmart_us&country=us" },
  { name: "Target US", slug: "target_us", country: "United States", productCount: 420000, url: "/search?q=&source=target_us&country=us" },
  { name: "Best Buy US", slug: "bestbuy_us", country: "United States", productCount: 310000, url: "/search?q=&source=bestbuy_us&country=us" },
  { name: "Carousell Singapore", slug: "carousell_sg", country: "Singapore", productCount: 185000, url: "/search?q=&source=carousell_sg&country=sg" },
  { name: "Shopee Malaysia", slug: "shopee_my", country: "Malaysia", productCount: 540000, url: "/search?q=&source=shopee_my&country=my" },
  { name: "Shopee Thailand", slug: "shopee_th", country: "Thailand", productCount: 410000, url: "/search?q=&source=shopee_th&country=th" },
  { name: "Shopee Philippines", slug: "shopee_ph", country: "Philippines", productCount: 380000, url: "/search?q=&source=shopee_ph&country=ph" },
  { name: "Shopee Indonesia", slug: "shopee_id", country: "Indonesia", productCount: 620000, url: "/search?q=&source=shopee_id&country=id" },
  { name: "Shopee Vietnam", slug: "shopee_vn", country: "Vietnam", productCount: 350000, url: "/search?q=&source=shopee_vn&country=vn" },
  { name: "Yahoo Shopping Japan", slug: "yahoo_jp", country: "Japan", productCount: 275000, url: "/search?q=&source=yahoo_jp&country=jp" },
];

export default function StoresPage() {
  const countryGroups = stores.reduce<Record<string, StoreEntry[]>>((acc, store) => {
    (acc[store.country] ??= []).push(store);
    return acc;
  }, {});

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-4">Browse Stores</h1>
          <p className="text-indigo-200 text-lg leading-relaxed max-w-2xl">
            BuyWhere indexes millions of products from top retailers across Southeast Asia, the US, Japan, and more. Compare prices across stores in one search.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {Object.entries(countryGroups).map(([country, entries]) => (
            <div key={country} className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">{country}</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {entries.map((store) => (
                  <Link
                    key={store.slug}
                    href={store.url}
                    className="block p-5 bg-gray-50 rounded-xl border border-gray-100 hover:border-indigo-200 hover:shadow-sm transition-all"
                  >
                    <h3 className="font-semibold text-gray-900">{store.name}</h3>
                    {store.productCount != null && (
                      <p className="text-sm text-gray-500 mt-1">
                        {store.productCount.toLocaleString()} products
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">All stores, one search</h2>
          <p className="text-gray-600 leading-relaxed mb-8">
            Instead of checking each store individually, use BuyWhere to search across 150,000+ retailers at once. Our catalog normalizes prices, availability, and product data so you get apples-to-apples comparisons.
          </p>
          <Link
            href="/search"
            className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Search all stores →
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
