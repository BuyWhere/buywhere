import Link from "next/link";
import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";
import Schema from "@/components/Schema";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

// BUY-68471: /products previously called permanentRedirect("/compare/"), which
// self-hosted standalone Next 14 (skipTrailingSlashRedirect + trailingSlash:
// false) renders as a client-side __next-page-redirect shell served as HTTP
// 200. That shell inherited root-layout homepage metadata (canonical "/", the
// homepage title/OG) and had no H1, and every ?query variant hit the same
// broken shell. Replace it with a real server-rendered product-discovery
// landing page so the route has its own title/description/canonical/H1 and the
// parameterized variants (?category=, ?search=, ?page=) canonicalize to
// /products with noindex,follow instead of competing as separate index URLs
// (same approach /search takes for its own query params).

const PRODUCTS_TITLE =
  "Discover & Compare Products Across Retailers | BuyWhere";
const PRODUCTS_DESCRIPTION =
  "Browse products across thousands of retailers with BuyWhere. Search the catalog, compare live prices side by side, and find the best deals across the US and Southeast Asia.";
const PRODUCTS_PATH = "/products";

const SEARCH_LINKS: { href: string; label: string; description: string }[] = [
  {
    href: "/search",
    label: "Search products",
    description: "Full-text search across the BuyWhere catalog.",
  },
  {
    href: "/compare",
    label: "Compare prices",
    description: "Line up the same product across retailers.",
  },
  {
    href: "/categories",
    label: "Browse categories",
    description: "Electronics, fashion, home, beauty and more.",
  },
  {
    href: "/deals/us",
    label: "Today's deals",
    description: "Current discounts and price drops.",
  },
];

const REGION_LINKS: { href: string; label: string }[] = [
  { href: "/us", label: "United States" },
  { href: "/sg", label: "Singapore" },
];

const CATEGORY_LINKS: { href: string; label: string }[] = [
  { href: "/categories/electronics", label: "Electronics" },
  { href: "/categories/fashion", label: "Fashion" },
  { href: "/categories/home-living", label: "Home & Living" },
  { href: "/categories/beauty-health", label: "Beauty & Health" },
  { href: "/categories/grocery", label: "Grocery" },
];

type ProductsIndexProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

// Any query/facet parameter (?category=, ?search=, ?page=, ?sort=, …) makes the
// URL a faceted variant. Canonicalize every variant to /products and mark it
// noindex,follow so only the bare landing page is indexed and none of the
// variants inherit homepage metadata.
function hasSearchParams(
  searchParams?: Record<string, string | string[] | undefined>,
): boolean {
  if (!searchParams) return false;
  return Object.values(searchParams).some(
    (v) => v !== undefined && v !== null && v !== "",
  );
}

export function generateMetadata({
  searchParams,
}: ProductsIndexProps): Metadata {
  const metadata = buildPageMetadata({
    title: PRODUCTS_TITLE,
    description: PRODUCTS_DESCRIPTION,
    path: PRODUCTS_PATH,
  });

  if (hasSearchParams(searchParams)) {
    return {
      ...metadata,
      robots: { index: false, follow: true },
      alternates: { canonical: toSiteUrl(PRODUCTS_PATH) },
    };
  }

  return metadata;
}

export default function ProductsIndexPage() {
  const schema = buildWebPageSchema({
    path: PRODUCTS_PATH,
    name: "Discover & Compare Products — BuyWhere",
    description: PRODUCTS_DESCRIPTION,
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Products", path: PRODUCTS_PATH },
    ],
  });

  return (
    <div className="flex flex-col min-h-screen">
      <Schema data={schema} />
      <Header />
      <main id="main-content" className="flex-1">
        <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600 mb-3">
            Product discovery
          </p>
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl mb-4">
            Discover and compare products across retailers
          </h1>
          <p className="text-lg leading-relaxed text-gray-600 mb-10 max-w-2xl">
            Search the BuyWhere catalog, compare live prices side by side, and
            find where to buy across thousands of retailers in the US and
            Southeast Asia.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-14">
            <Link href="/search">
              <Button size="lg">Search products</Button>
            </Link>
            <Link href="/compare">
              <Button variant="secondary" size="lg">
                Compare prices
              </Button>
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 mb-14">
            {SEARCH_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-2xl border border-gray-200 bg-white p-6 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <h2 className="text-base font-semibold text-gray-900 mb-1">
                  {link.label}
                </h2>
                <p className="text-sm text-gray-500">{link.description}</p>
              </Link>
            ))}
          </div>

          <div className="mb-10">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Popular categories
            </h2>
            <ul className="flex flex-wrap gap-2">
              {CATEGORY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Shop by region
            </h2>
            <ul className="flex flex-wrap gap-2">
              {REGION_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
