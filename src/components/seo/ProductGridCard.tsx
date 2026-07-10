"use client";

import Image from "next/image";
import { useState } from "react";
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

function FallbackImage({ product }: { product: LandingProduct }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-500">
        {(product.brand || product.merchant || "?").charAt(0).toUpperCase()}
      </div>
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
        {product.brand || product.merchant}
      </p>
    </div>
  );
}

export function ProductGridCard({ product }: { product: LandingProduct }) {
  const [imgError, setImgError] = useState(false);

  const hasImage = product.imageUrl && !imgError;

  return (
    <a
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.25),_rgba(248,250,252,0.92)_55%,_rgba(226,232,240,0.95))]">
        {hasImage && product.imageUrl!.startsWith("data:image/svg+xml") ? (
          <Image
            src={product.imageUrl!}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
            unoptimized
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : hasImage ? (
          <Image
            src={product.imageUrl!}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={() => setImgError(true)}
          />
        ) : (
          <FallbackImage product={product} />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">{product.merchant}</span>
          {product.category ? <span>{product.category}</span> : null}
        </div>

        <div className="space-y-2">
          <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-slate-900 transition-colors group-hover:text-amber-700">
            {product.name}
          </h2>
          {product.brand ? <p className="text-sm text-slate-500">{product.brand}</p> : null}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">Current price</p>
            <p className="text-2xl font-semibold text-slate-900">{formatPrice(product.price, product.currency)}</p>
          </div>
          <span className="text-sm font-medium text-amber-700">View offer</span>
        </div>
      </div>
    </a>
  );
}
