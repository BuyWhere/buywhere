"use client";

import { useState } from "react";
import { stripMerchantTenantSuffix } from "@/lib/merchant-name";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  category?: string | null;
  className?: string;
}

/**
 * Pick an SVG silhouette that visually represents the product's category.
 * Mirrors the regex set used by categorySilhouette() in seo-landing-pages.ts
 * so the consumer-side BrandedPlaceholder matches the SSR-side category icon.
 * Without this, the live site falls through to the legacy laptop/monitor icon
 * on robot-vacuum (and other) cards because every product's imageUrl ends up
 * empty on pages where the live search API has degraded (BUY-67242).
 */
function placeholderSilhouette(category?: string | null, alt?: string | null): string {
  const text = `${category || ""} ${alt || ""}`.toLowerCase();
  if (/\brobot\s*vacuum|roomba|deebot|robovac/.test(text)) {
    return `
      <ellipse cx='60' cy='110' rx='95' ry='28' fill='#fde68a' stroke='#b45309' strokeWidth='4'/>
      <ellipse cx='60' cy='100' rx='90' ry='22' fill='#fff7ed' stroke='#b45309' strokeWidth='3'/>
      <rect x='30' y='40' width='60' height='30' rx='6' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <circle cx='60' cy='80' r='5' fill='#b45309'/>`;
  }
  if (/\bheadphone|earbud|earphone|airpod/.test(text)) {
    return `
      <path d='M-20 30 Q-20 -30 60 -30 Q140 -30 140 30' fill='none' stroke='#b45309' strokeWidth='5' strokeLinecap='round'/>
      <rect x='-30' y='25' width='28' height='48' rx='8' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <rect x='122' y='25' width='28' height='48' rx='8' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <circle cx='-16' cy='73' r='9' fill='#f59e0b'/>
      <circle cx='136' cy='73' r='9' fill='#f59e0b'/>`;
  }
  if (/\bphone|iphone|galaxy\s*s|pixel/.test(text)) {
    return `
      <rect x='20' y='0' width='80' height='150' rx='14' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='30' y='20' width='60' height='100' rx='4' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <circle cx='60' cy='135' r='4' fill='#b45309'/>`;
  }
  if (/\bair\s*purifier|hepa/.test(text)) {
    return `
      <rect x='15' y='0' width='90' height='150' rx='16' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <circle cx='60' cy='40' r='10' fill='#f59e0b'/>
      <rect x='35' y='70' width='50' height='60' rx='4' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <circle cx='60' cy='130' r='6' fill='#b45309'/>`;
  }
  if (/\btv|television|qled|oled/.test(text)) {
    return `
      <rect x='-50' y='20' width='220' height='120' rx='8' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='-40' y='30' width='200' height='100' rx='4' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <rect x='40' y='140' width='40' height='10' fill='#b45309'/>
      <rect x='10' y='148' width='100' height='6' rx='3' fill='#b45309'/>`;
  }
  if (/\bcamera|dslr|mirrorless/.test(text)) {
    return `
      <rect x='-20' y='40' width='160' height='90' rx='10' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='40' y='25' width='40' height='20' rx='4' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <circle cx='60' cy='85' r='32' fill='#fff7ed' stroke='#b45309' strokeWidth='3'/>
      <circle cx='60' cy='85' r='18' fill='#fde68a' stroke='#b45309' strokeWidth='2'/>`;
  }
  if (/\bwatch|smartwatch|apple\s*watch/.test(text)) {
    return `
      <rect x='30' y='15' width='60' height='60' rx='10' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='40' y='25' width='40' height='40' rx='4' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <path d='M40 15 L35 -10 L85 -10 L80 15' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <path d='M40 75 L35 100 L85 100 L80 75' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
      <circle cx='60' cy='45' r='6' fill='#f59e0b'/>`;
  }
  if (/\btablet|ipad/.test(text)) {
    return `
      <rect x='-10' y='10' width='140' height='130' rx='10' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='0' y='22' width='120' height='100' rx='4' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <circle cx='60' cy='130' r='4' fill='#b45309'/>`;
  }
  if (/\bshoe|sneaker|running/.test(text)) {
    return `
      <path d='M-40 130 Q-30 90 20 90 L80 90 Q120 90 150 130 Z' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <path d='M-40 130 L150 130 L140 145 L-30 145 Z' fill='#b45309'/>
      <path d='M30 90 L35 75 L55 75 L60 90' fill='none' stroke='#b45309' strokeWidth='3'/>`;
  }
  if (/\bcoffee|espresso|kitchen|blender|toaster|airfryer/.test(text)) {
    return `
      <rect x='10' y='30' width='100' height='110' rx='8' fill='#fef3c7' stroke='#b45309' strokeWidth='4'/>
      <rect x='10' y='45' width='100' height='10' fill='#b45309'/>
      <circle cx='60' cy='100' r='22' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
      <path d='M110 60 Q135 60 135 90 Q135 115 110 115' fill='none' stroke='#b45309' strokeWidth='4'/>`;
  }
  // legacy default: laptop silhouette — kept so uncategorised products still
  // show a recognisable card rather than a blank box.
  return `
    <rect x='0' y='0' width='120' height='80' rx='8' fill='#fef3c7' stroke='#b45309' strokeWidth='3'/>
    <rect x='10' y='10' width='100' height='60' rx='2' fill='#fff7ed' stroke='#b45309' strokeWidth='2'/>
    <rect x='-10' y='80' width='140' height='8' rx='3' fill='#b45309'/>
    <rect x='50' y='88' width='20' height='4' rx='2' fill='#b45309'/>`;
}

function BrandedPlaceholder({ alt, brand, merchant, category }: { alt: string; brand?: string | null; merchant?: string; category?: string | null }) {
  const clean = (s: string) => String(s).replace(/[<>&"']/g, "").trim();
  const brandText = clean(brand || "").slice(0, 18) || "BuyWhere";
  const productLabel = clean(alt).slice(0, 26) || "Featured product";
  // BUY-66324: defensive cleanup in case a caller passes a raw merchant
  // string that bypassed `formatMerchantName` upstream.
  const cleanedMerchant = stripMerchantTenantSuffix(merchant);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-slate-100 p-4 text-center">
      <div className="mb-3 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" className="w-full max-w-[180px] drop-shadow-sm">
          <defs>
            <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#fff7ed" />
              <stop offset="1" stopColor="#fde68a" />
            </linearGradient>
          </defs>
          <rect width="400" height="300" fill="url(#bg)" />
          <rect x="40" y="40" width="320" height="220" rx="24" fill="#ffffff" stroke="#fcd34d" strokeWidth="3" />
          <g transform="translate(140 80)" fill="none" stroke="#b45309" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">{placeholderSilhouette(category, alt)}
          </g>
          <text x="200" y="218" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="20" fontWeight="700" fill="#0f172a">
            {brandText}
          </text>
          <text x="200" y="244" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="13" fontWeight="500" fill="#475569">
            {productLabel}
          </text>
          <text x="200" y="262" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="11" fontWeight="600" letterSpacing="2" fill="#92400e">
            BUYWHERE
          </text>
        </svg>
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
