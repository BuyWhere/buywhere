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

export function ProductGridCard({ product }: { product: LandingProduct }) {
  const isMerchantOffer =
    product.href.startsWith("http://") || product.href.startsWith("https://");
  const detailUrl =
    product.productUrl ||
    `/search?q=${encodeURIComponent(product.name)}`;

  return (
    <Link
      href={detailUrl}
      prefetch={false}
      className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.25),_rgba(248,250,252,0.92)_55%,_rgba(226,232,240,0.95))]">
        <ProductGridImage
          src={product.imageUrl || ""}
          alt={product.name}
          brand={product.brand}
          merchant={product.merchant}
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
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

        <div className="mt-auto flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
              Current price
            </p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPrice(product.price, product.currency)}
            </p>
          </div>
          {isMerchantOffer ? (
            <a
              href={product.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded-full bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600"
            >
              Buy at {product.merchant}
            </a>
          ) : (
            <span className="text-sm font-medium text-amber-700">
              View details
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
