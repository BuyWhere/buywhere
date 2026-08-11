// Server-safe SearchCard — pure presentational, no 'use client'. Used by the
// server-rendered first page (page.tsx) so the initial HTML for /search
// contains product name, merchant, price, brand, category, and CTA copy on
// first paint (before any JS bundle executes). BUY-67120.
//
// The client tree also imports this same component so the initial markup is
// byte-identical to the post-hydration DOM — no React hydration mismatches.

import { ExternalLink } from 'lucide-react';
import { MerchantBadge } from '@/components/ui/MerchantBadge';
import { CompareSelectButton } from '@/components/compare/CompareSelectButton';

export type SearchCardProduct = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  merchant: string;
  imageUrl: string | null;
  href: string;
  brand: string | null;
  category: string | null;
};

function formatPrice(price: number | null, currency: string) {
  if (price === null || !Number.isFinite(price)) return 'Price unavailable';

  try {
    return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

export default function SearchCard({ product }: { product: SearchCardProduct }) {
  return (
    <a
      data-testid="search-product-card"
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex h-full min-h-[460px] min-w-0 flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div
        className="relative w-full max-h-[220px] shrink-0 overflow-hidden border-b border-slate-100 bg-slate-100"
        style={{ aspectRatio: '4/3', maxHeight: '220px' }}
        data-testid="search-product-media"
      >
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_rgba(248,250,252,0.96)_55%,_rgba(226,232,240,0.96))] text-sm font-semibold text-slate-600">
          Product image
        </div>
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            // BUY-64266: keep max-h-[220px] / max-w-full / object-contain so the
            // image can never exceed its 220px-tall card frame.
            className="relative z-10 block h-full w-full max-h-[220px] max-w-full object-contain p-2"
            style={{ maxHeight: '220px', width: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div className="relative z-10 flex h-full items-center justify-center text-4xl text-slate-600">◎</div>
        )}
        <div className="absolute right-2 top-2 z-20">
          <CompareSelectButton product={product} className="h-9 w-9" />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2.5 bg-white p-3.5" data-testid="search-product-details">
        <div className="flex min-h-7 items-start justify-between gap-2">
          <MerchantBadge merchant={product.merchant} className="min-w-0 flex-1 basis-0" />
          <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
            Shop
            <ExternalLink className="h-3 w-3" />
          </span>
        </div>

        <div className="space-y-1.5">
          <h2 className="line-clamp-3 text-base font-semibold leading-snug text-slate-950 transition-colors group-hover:text-amber-700">
            {product.name}
          </h2>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            {product.brand ? <span>{product.brand}</span> : null}
            {product.category ? <span>{product.category}</span> : null}
          </div>
        </div>

        <div className="mt-auto space-y-2.5 border-t border-slate-100 pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current price</p>
            <p className="text-xl font-bold tracking-tight text-slate-950">{formatPrice(product.price, product.currency)}</p>
          </div>
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-amber-600">
            View Deal
            <ExternalLink className="h-4 w-4" />
          </span>
        </div>
      </div>
    </a>
  );
}