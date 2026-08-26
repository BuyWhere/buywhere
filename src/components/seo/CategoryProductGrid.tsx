/**
 * SSR-only product grid for category landing pages.
 *
 * BUY-75418 — replaces the thin /us/<category>, /us, and /categories/{slug}
 * pages (0 product links) with a server-rendered, crawler-readable grid that
 * includes the name, formatted price, currency, retailer, and the /r redirect
 * with rel="nofollow sponsored". The component is a server component so the
 * HTML is part of the initial response (no JS execution required).
 */

// Server component (no "use client" directive) — required for SSR HTML.
// See ../lib/category-products.ts for the server-only data fetcher.

import Link from "next/link";
import {
  fetchCategoryGridProducts,
  type CategoryGridProduct,
  type CategoryGridResult,
} from "@/lib/category-products";

interface CategoryProductGridProps {
  category: string;
  countryCode: string;
  /** Section heading shown above the grid (e.g. "Top Electronics in the US"). */
  heading: string;
  /** Optional subhead / one-sentence description under the heading. */
  subheading?: string;
  /** Section anchor id (for in-page nav + sitemap). */
  sectionId?: string;
  /** Visible limit — must be >= 12 to satisfy the BUY-75418 acceptance check. */
  limit?: number;
  /** Tailwind class overrides for the outer section wrapper. */
  className?: string;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `$${price.toFixed(0)}`;
  }
}

function ProductCard({ product }: { product: CategoryGridProduct }) {
  const detailHref = product.detailUrl;

  return (
    <article
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
      data-product-id={product.id}
      data-merchant={product.merchant}
    >
      <div
        className="relative isolate flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-slate-100"
        style={{ overflow: "hidden", maxWidth: "100%" }}
      >
        <Link href={detailHref} prefetch={false} className="block h-full w-full">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-5xl text-slate-300" aria-hidden="true">
              🛍️
            </span>
          )}
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">
            {product.merchant}
          </span>
          {product.availability === "in_stock" ? (
            <span className="text-emerald-700">In stock</span>
          ) : null}
        </div>

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900 transition-colors group-hover:text-indigo-700">
          <Link href={detailHref} prefetch={false}>
            {product.name}
          </Link>
        </h3>

        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
              Current price
            </p>
            <p
              className="text-xl font-semibold text-slate-900"
              data-testid="category-grid-price"
              data-amount={product.price}
              data-currency={product.currency}
            >
              {formatPrice(product.price, product.currency)}
            </p>
          </div>
          {/* Merchant outbound — affiliate /r/ link. rel="nofollow sponsored"
              satisfies the SEO-GATE requirement on /r/* redirects. */}
          <a
            href={product.affiliateRedirectUrl}
            target="_blank"
            rel="nofollow sponsored noopener noreferrer"
            className="inline-flex min-h-[2.5rem] items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
            data-product-outbound="true"
            data-merchant-slug={product.merchantSlug ?? ""}
          >
            Buy at {product.merchant}
          </a>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ heading }: { heading: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">
      <p className="font-medium">
        We could not load live {heading.toLowerCase()} prices right now.
      </p>
      <p className="mt-2 text-sm">
        Try the search above or come back in a few minutes — prices are
        re-pulled continuously.
      </p>
    </div>
  );
}

export async function CategoryProductGrid({
  category,
  countryCode,
  heading,
  subheading,
  sectionId,
  limit = 12,
  className,
}: CategoryProductGridProps) {
  let result: CategoryGridResult;
  try {
    result = await fetchCategoryGridProducts({ category, countryCode, limit });
  } catch {
    result = { products: [], fetchedAt: new Date().toISOString(), source: "fallback-empty" };
  }

  const products = result.products;
  const visibleHeading = heading;

  return (
    <section
      id={sectionId}
      data-ssr-product-grid="true"
      data-category={category}
      data-country={countryCode}
      data-product-count={products.length}
      data-source={result.source}
      className={
        className ??
        "py-12 md:py-16 bg-white border-t border-slate-100"
      }
      aria-label={visibleHeading}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              {visibleHeading}
            </h2>
            {subheading ? (
              <p className="mt-1 text-sm text-slate-600 md:text-base">
                {subheading}
              </p>
            ) : null}
          </div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Live catalog · {products.length} of {limit} priced
          </p>
        </div>

        {products.length === 0 ? (
          <EmptyState heading={visibleHeading} />
        ) : (
          <div
            className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
            data-ssr-grid-rows={Math.ceil(products.length / 4)}
          >
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default CategoryProductGrid;