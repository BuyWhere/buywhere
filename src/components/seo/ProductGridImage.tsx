"use client";

import { useState } from "react";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  className?: string;
}

function BrandedPlaceholder({ alt, brand, merchant }: { alt: string; brand?: string | null; merchant?: string }) {
  const clean = (s: string) => String(s).replace(/[<>&"']/g, "").trim();
  const brandText = clean(brand || "").slice(0, 18) || "BuyWhere";
  const productLabel = clean(alt).slice(0, 26) || "Featured product";

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
          <g transform="translate(140 80)" fill="none" stroke="#b45309" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="0" y="0" width="120" height="90" rx="12" fill="#fef3c7" />
            <circle cx="60" cy="40" r="14" fill="#f59e0b" stroke="none" />
            <path d="M0 70 L40 35 L80 60 L120 25" stroke="#b45309" />
          </g>
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
      {(brand || merchant) && (
        <span className="mt-1 text-xs text-slate-400">{brand || merchant}</span>
      )}
    </div>
  );
}

export function ProductGridImage({ src, alt, brand, merchant, className }: ProductGridImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return <BrandedPlaceholder alt={alt} brand={brand} merchant={merchant} />;
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
