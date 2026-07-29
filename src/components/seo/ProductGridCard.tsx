"use client";

import Link from "next/link";
import { ProductGridImage } from "@/components/seo/ProductGridImage";
import type { LandingProduct } from "@/lib/seo-landing-pages";

function formatPrice(price: number | null, currency: string) {
  if (price === null) {
    return "Price unavailable";
  }

  return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

export function ProductGridCard({ product, compact = false }: { product: LandingProduct; compact?: boolean }) {
  const isMerchantOffer =
    product.href.startsWith("http://") || product.href.startsWith("https://");
  const detailUrl =
    product.productUrl || `/search?q=${encodeURIComponent(product.name)}`;

  function handleMerchantClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.open(product.href, "_blank", "noopener,noreferrer");
  }

  function handleMerchantKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      window.open(product.href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Link
      href={detailUrl}
      prefetch={false}
      className={`group grid h-full min-w-0 rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl ${
        compact ? "grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]" : "grid-rows-[auto_1fr]"
      }`}
    >
      <div className={`relative overflow-hidden bg-slate-100 ${compact ? "min-h-64 rounded-l-[27px]" : "aspect-[4/3] rounded-t-[27px]"}`}>
        <ProductGridImage
          src={product.imageUrl || ""}
          alt={product.name}
          brand={product.brand}
          merchant={product.merchant}
        />
      </div>

      <div className={`flex min-w-0 flex-1 flex-col gap-4 ${compact ? "p-4" : "p-5"}`}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">
            {product.merchant}
          </span>
          {product.category ? <span>{product.category}</span> : null}
        </div>

        <div className="space-y-2">
          <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-slate-900 transition-colors group-hover:text-amber-700">
            {product.name}
          </h2>
          {product.brand ? (
            <p className="text-sm text-slate-500">{product.brand}</p>
          ) : null}
        </div>

        <div className={`mt-auto ${compact ? "grid gap-3" : "flex items-end justify-between gap-4"}`}>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
              Current price
            </p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPrice(product.price, product.currency)}
            </p>
          </div>
          {isMerchantOffer ? (
            <span
              role="button"
              tabIndex={0}
              onClick={handleMerchantClick}
              onKeyDown={handleMerchantKeyDown}
              className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-amber-700 px-4 py-2.5 text-center font-semibold text-white shadow-sm transition-colors hover:bg-amber-800 ${compact ? "w-full text-xs" : "text-sm"}`}
            >
              Buy at {product.merchant}
            </span>
          ) : (
            <span className="inline-flex min-h-11 items-center text-sm font-medium text-amber-700">
              View details
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
