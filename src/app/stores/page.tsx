import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { commerceStores, type CommerceStoreEntry } from "@/lib/commerce-routes";
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
  openGraph: {
    title: "Stores — Shop Across Top Retailers | BuyWhere",
    description:
      "Browse stores covered by BuyWhere's product catalog. Compare prices across Shopee, Lazada, Amazon, Walmart, and more.",
    url: toSiteUrl("/stores"),
    siteName: "BuyWhere",
    type: "website",
    images: [
      {
        url: "/stores/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Browse Stores — BuyWhere",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stores — Shop Across Top Retailers | BuyWhere",
    description:
      "Browse stores covered by BuyWhere's product catalog. Compare prices across top retailers.",
    images: ["/stores/opengraph-image"],
  },
};

const stores = commerceStores;

export default function StoresPage() {
  const countryGroups = stores.reduce<Record<string, CommerceStoreEntry[]>>((acc, store) => {
    (acc[store.country] ??= []).push(store);
    return acc;
  }, {});

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Browse Stores',
    description: 'Browse stores covered by BuyWhere\'s product catalog. Compare prices across Shopee, Lazada, Amazon, Walmart, and more.',
    url: toSiteUrl('/stores'),
    numberOfItems: stores.length,
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main id="main-content">
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
                    href={`/stores/${store.slug}`}
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
            Instead of checking each store individually, use BuyWhere to search across all retailers at once. Our catalog normalizes prices, availability, and product data so you get apples-to-apples comparisons.
          </p>
          <Link
            href="/search"
            className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Search all stores →
          </Link>
        </div>
      </section>

      </main>
      <Footer />
    </div>
  );
}
