import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Explore — Discover BuyWhere",
  description: "Browse product categories, retailer integrations, and market coverage available through the BuyWhere API.",
  alternates: {
    canonical: toSiteUrl("/explore/"),
  },
};

const categories = [
  { href: "/categories/electronics/us", label: "Electronics" },
  { href: "/categories/computers/us", label: "Computers & Laptops" },
  { href: "/categories/phones/us", label: "Phones & Tablets" },
  { href: "/categories/audio/us", label: "Audio & Headphones" },
  { href: "/categories/home-appliances/us", label: "Home Appliances" },
  { href: "/categories/gaming/us", label: "Gaming" },
  { href: "/categories/photography/us", label: "Cameras & Photography" },
  { href: "/categories/smart-home/us", label: "Smart Home" },
];

export default function ExplorePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Explore BuyWhere</h1>
          <p className="text-sm text-gray-400 mb-10">Discover products, categories, and coverage across markets</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Browse by Category</h2>
              <p>
                Explore products across these major categories, available through the BuyWhere product
                catalog API with prices from multiple retailers.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 mt-4 not-prose">
                {categories.map((cat) => (
                  <Link
                    key={cat.href}
                    href={cat.href}
                    className="block border border-gray-200 rounded-lg p-4 text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {cat.label}
                  </Link>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">API Integration</h2>
              <p>
                Use the BuyWhere API to build product discovery into your AI application. The API
                supports search, category browsing, price comparison, and affiliate link generation.
              </p>
              <div className="mt-4 flex gap-3 not-prose">
                <Link
                  href="/quickstart"
                  className="inline-flex items-center justify-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Get started
                </Link>
                <Link
                  href="/api-reference"
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:border-indigo-300"
                >
                  API reference
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
