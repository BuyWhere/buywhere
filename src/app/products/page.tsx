import Link from "next/link";
import { buildPageMetadata } from "@/lib/page-metadata";

// /products previously called permanentRedirect("/compare/") which returns an
// HTTP 308 with an empty body, making the route's metadata invisible to
// social crawlers and SEO scrapers. Keep the page crawlable so canonical and
// og:url metadata are emitted in the HTML response.

const PRODUCTS_TITLE =
  "Discover & Compare Products Across Retailers | BuyWhere";
const PRODUCTS_DESCRIPTION =
  "Browse products across thousands of retailers with BuyWhere. Search the catalog, compare live prices side by side, and find the best deals across the US and Southeast Asia.";

export const metadata = buildPageMetadata({
  title: PRODUCTS_TITLE,
  description: PRODUCTS_DESCRIPTION,
  path: "/products",
});

export default function ProductsIndexPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <section className="max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Product discovery
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Discover and compare products across retailers.
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
          Browse BuyWhere&rsquo;s comparison hub to search products, compare live prices,
          and find deals across the US and Southeast Asia.
        </p>
        <Link
          href="/compare/"
          className="mt-8 inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Browse product comparisons
        </Link>
      </section>
    </main>
  );
}
