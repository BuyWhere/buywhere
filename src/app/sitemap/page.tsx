import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Sitemap — BuyWhere",
  description: "Browse BuyWhere site sections and XML sitemap files for pages, categories, products, merchants, and comparisons.",
  alternates: {
    canonical: toSiteUrl("/sitemap/"),
  },
};

const sitemapLinks = [
  { href: "/sitemap.xml", label: "Sitemap index", description: "Main XML sitemap index for search engines." },
  { href: "/sitemap-pages.xml", label: "Pages sitemap", description: "Core marketing, documentation, and utility pages." },
  { href: "/sitemap-categories.xml", label: "Categories sitemap", description: "Category landing pages by market and product type." },
  { href: "/sitemap-products.xml", label: "Products sitemap", description: "Product listing pages included in search discovery." },
  { href: "/sitemap-merchants.xml", label: "Merchants sitemap", description: "Merchant and retailer pages." },
  { href: "/sitemap-compare.xml", label: "Comparison sitemap", description: "Product and category comparison pages." },
];

const siteSections = [
  { href: "/quickstart", label: "Quickstart" },
  { href: "/api-reference", label: "API Reference" },
  { href: "/docs", label: "Documentation" },
  { href: "/pricing", label: "Pricing" },
  { href: "/merchants", label: "Merchants" },
  { href: "/partners", label: "Partners" },
  { href: "/use-cases", label: "Use Cases" },
  { href: "/contact", label: "Contact" },
];

export default function SitemapPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Sitemap</h1>
          <p className="text-sm text-gray-400 mb-10">Find BuyWhere pages and XML sitemap resources</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Browse BuyWhere</h2>
              <div className="grid sm:grid-cols-2 gap-3 not-prose">
                {siteSections.map((section) => (
                  <Link
                    key={section.href}
                    href={section.href}
                    className="block border border-gray-200 rounded-lg p-4 text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {section.label}
                  </Link>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">XML Sitemaps</h2>
              <div className="space-y-3 not-prose">
                {sitemapLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block border border-gray-200 rounded-lg p-4 hover:border-indigo-300"
                  >
                    <span className="font-semibold text-gray-900">{link.label}</span>
                    <span className="block text-sm text-gray-600 mt-1">{link.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
