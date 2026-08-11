"use client";

import { useState } from "react";
import { stripMerchantTenantSuffix } from "@/lib/merchant-name";
import { categorySilhouette } from "@/lib/seo-landing-pages";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  category?: string | null;
  className?: string;
}

function BrandedPlaceholder({
  alt,
  brand,
  merchant,
  category,
}: {
  alt: string;
  brand?: string | null;
  merchant?: string;
  category?: string | null;
}) {
  const clean = (s: string) => String(s).replace(/[<>&"']/g, "").trim();
  const brandText = clean(brand || "").slice(0, 18) || "BuyWhere";
  const productLabel = clean(alt).slice(0, 26) || "Featured product";
  // BUY-66324: defensive cleanup in case a caller passes a raw merchant
  // string that bypassed `formatMerchantName` upstream.
  const cleanedMerchant = stripMerchantTenantSuffix(merchant);
  // BUY-68366: the previous hardcoded laptop silhouette was reused for every
  // category, so a robot vacuum card on /best-robot-vacuums-2026 still showed
  // a laptop. Render a category-specific icon (falling back to the generic
  // laptop shape only when the category is unknown).
  const icon = categorySilhouette(category);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-slate-100 p-4 text-center">
      <div className="mb-3 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 400 300"
          className="w-full max-w-[180px] drop-shadow-sm"
          // categorySilhouette returns a static set of <g>/<rect>/<circle>/<line>/<path>
          // tags — no user-controlled text — so innerHTML here is safe.
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      </div>
      <div className="px-3 text-center">
        <div className="truncate text-base font-semibold text-slate-900">{brandText}</div>
        <div className="truncate text-xs text-slate-500">{productLabel}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">BUYWHERE</div>
      </div>
      {(brand || cleanedMerchant) && (
        <span className="mt-1 text-xs text-slate-400">{brand || cleanedMerchant}</span>
      )}
    </div>
  );
}

export function ProductGridImage({ src, alt, brand, merchant, category, className }: ProductGridImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return <BrandedPlaceholder alt={alt} brand={brand} merchant={merchant} category={category} />;
  }

  // BUY-65158: Use a plain <img> (not next/image) so the SSR HTML shows the
  // image directly on first paint. next/image + loading="lazy" causes a visible
  // loading flash where the background gradient (or empty box) is rendered
  // before the image resolves — QA saw this as "static noise/wireframe" on
  // /best-gaming-laptops-us and /air-purifier-singapore.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer-when-downgrade"
      className={className ?? "h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"}
      onError={() => setHasError(true)}
    />
  );
}
