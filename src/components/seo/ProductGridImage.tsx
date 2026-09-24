"use client";

import { useState } from "react";
import { stripMerchantTenantSuffix } from "@/lib/merchant-name";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  // BUY-69167: the upstream category label (e.g. "Robot Vacuums"). When the
  // <img> fires onError we fall through to the inline BrandedPlaceholder —
  // pick the category-appropriate silhouette so the fallback matches the
  // page instead of always rendering the generic laptop-looking icon.
  category?: string | null;
  className?: string;
}

// BUY-69167: light category-keyed silhouette picker. Mirrors the regex set in
// src/lib/seo-landing-pages.ts `categorySilhouette()` so the onError fallback
// visually agrees with the deterministic branded SVG the data layer already
// produces for the same category. Kept inline here so this client component
// doesn't import a server-only module.
function clientCategorySilhouette(category?: string | null, alt?: string | null): string {
  const text = `${category || ""} ${alt || ""}`.toLowerCase();
  if (/\brobot\s*vacuum|roomba|deebot|robovac/.test(text)) {
    return `
      <ellipse cx='60' cy='110' rx='95' ry='28' fill='#fde68a' stroke='#b45309' stroke-width='4'/>
      <ellipse cx='60' cy='100' rx='90' ry='22' fill='#fff7ed' stroke='#b45309' stroke-width='3'/>
      <rect x='30' y='40' width='60' height='30' rx='6' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <circle cx='60' cy='80' r='5' fill='#b45309'/>`;
  }
  if (/\bgaming\s*laptop|gaming\s*notebook/.test(text)) {
    return `
      <rect x='0' y='0' width='120' height='70' rx='6' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <rect x='10' y='8' width='100' height='54' rx='2' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <rect x='-10' y='70' width='140' height='8' rx='3' fill='#b45309'/>
      <rect x='50' y='78' width='20' height='4' rx='2' fill='#b45309'/>
      <path d='M20 30 L40 45 L60 25 L80 50 L100 30' fill='none' stroke='#b45309' stroke-width='3'/>`;
  }
  if (/\blaptop|notebook|macbook|chromebook/.test(text)) {
    return `
      <rect x='0' y='0' width='120' height='80' rx='8' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <rect x='10' y='10' width='100' height='60' rx='2' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <rect x='-10' y='80' width='140' height='8' rx='3' fill='#b45309'/>
      <rect x='50' y='88' width='20' height='4' rx='2' fill='#b45309'/>`;
  }
  if (/\bheadphone|earbud|earphone|airpod/.test(text)) {
    return `
      <path d='M-20 30 Q-20 -30 60 -30 Q140 -30 140 30' fill='none' stroke='#b45309' stroke-width='5' stroke-linecap='round'/>
      <rect x='-30' y='25' width='28' height='48' rx='8' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <rect x='122' y='25' width='28' height='48' rx='8' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <circle cx='-16' cy='73' r='9' fill='#f59e0b'/>
      <circle cx='136' cy='73' r='9' fill='#f59e0b'/>`;
  }
  if (/\bphone|iphone|galaxy\s*s|pixel/.test(text)) {
    return `
      <rect x='20' y='0' width='80' height='150' rx='14' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <rect x='30' y='20' width='60' height='100' rx='4' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <circle cx='60' cy='135' r='4' fill='#b45309'/>`;
  }
  if (/\bair\s*purifier|hepa/.test(text)) {
    return `
      <rect x='15' y='0' width='90' height='150' rx='16' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <circle cx='60' cy='40' r='10' fill='#f59e0b'/>
      <rect x='35' y='70' width='50' height='60' rx='4' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <circle cx='60' cy='130' r='6' fill='#b45309'/>`;
  }
  if (/\btv|television|qled|oled/.test(text)) {
    return `
      <rect x='-50' y='20' width='220' height='120' rx='8' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <rect x='-40' y='30' width='200' height='100' rx='4' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <rect x='40' y='140' width='40' height='10' fill='#b45309'/>
      <rect x='10' y='148' width='100' height='6' rx='3' fill='#b45309'/>`;
  }
  if (/\bcamera|dslr|mirrorless/.test(text)) {
    return `
      <rect x='-20' y='40' width='160' height='90' rx='10' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <rect x='40' y='25' width='40' height='20' rx='4' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <circle cx='60' cy='85' r='32' fill='#fff7ed' stroke='#b45309' stroke-width='3'/>
      <circle cx='60' cy='85' r='18' fill='#fde68a' stroke='#b45309' stroke-width='2'/>`;
  }
  if (/\bwatch|smartwatch|apple\s*watch/.test(text)) {
    return `
      <rect x='30' y='15' width='60' height='60' rx='10' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <rect x='40' y='25' width='40' height='40' rx='4' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <path d='M40 15 L35 -10 L85 -10 L80 15' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <path d='M40 75 L35 100 L85 100 L80 75' fill='#fef3c7' stroke='#b45309' stroke-width='3'/>
      <circle cx='60' cy='45' r='6' fill='#f59e0b'/>`;
  }
  if (/\btablet|ipad/.test(text)) {
    return `
      <rect x='-10' y='10' width='140' height='130' rx='10' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
      <rect x='0' y='22' width='120' height='100' rx='4' fill='#fff7ed' stroke='#b45309' stroke-width='2'/>
      <circle cx='60' cy='130' r='4' fill='#b45309'/>`;
  }
  // Generic product fallback — round square box. Distinct from the data-layer
  // default (which is intentionally laptop-shaped for /laptop-singapore + best
  // gaming-laptops-us) so the client onError fallback never claims a category
  // it can't actually identify.
  return `
    <rect x='20' y='20' width='80' height='80' rx='14' fill='#fef3c7' stroke='#b45309' stroke-width='4'/>
    <rect x='40' y='40' width='40' height='40' rx='6' fill='#fff7ed' stroke='#b45309' stroke-width='3'/>`;
}

function BrandedPlaceholder({ alt, brand, merchant, category }: { alt: string; brand?: string | null; merchant?: string; category?: string | null }) {
  const clean = (s: string) => String(s).replace(/[<>&"']/g, "").trim();
  const brandText = clean(brand || "").slice(0, 18) || "BuyWhere";
  const categoryText = clean(category || "").slice(0, 22) || "Featured product";
  const productLabel = clean(alt).slice(0, 26) || categoryText;
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
          <g
            transform="translate(140 80)"
            fill="none"
            stroke="#b45309"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: clientCategorySilhouette(category, alt) }}
          />
          <text x="200" y="208" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="22" fontWeight="700" fill="#0f172a">
            {brandText}
          </text>
          <text x="200" y="236" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="14" fontWeight="500" fill="#475569">
            {productLabel}
          </text>
          <text x="200" y="258" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="11" fontWeight="600" letterSpacing="2" fill="#92400e">
            BUYWHERE
          </text>
        </svg>
      </div>
      <span className="mt-1 text-xs font-medium text-slate-500">Photo unavailable</span>
      {(brand || cleanedMerchant) && (
        <span className="text-[11px] text-slate-400">{brand || cleanedMerchant}</span>
      )}
    </div>
  );
}

function isCatalogPhotoSrc(src?: string | null): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/svg")) return false;
  return src.startsWith("http") || src.startsWith("/api/image-proxy");
}

export function ProductGridImage({ src, alt, brand, merchant, category, className }: ProductGridImageProps) {
  const [hasError, setHasError] = useState(false);

  // BUY-79843: never SSR the branded SVG wireframe into Live Catalog Snapshot.
  // VidMee treats inline <svg> as an empty catalog even when titles/prices exist.
  if (hasError || !isCatalogPhotoSrc(src)) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-slate-100"
        data-missing-catalog-photo=""
        aria-hidden="true"
      />
    );
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
