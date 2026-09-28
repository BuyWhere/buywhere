'use client';

import { memo } from 'react';
import { useCompare } from '@/lib/compare-context';
import type { SearchCardProduct } from '@/app/search/SearchResultsClient';
import { formatPriceWithDecimals } from '@/lib/currency';

interface CompareSelectButtonProps {
  product: SearchCardProduct;
  className?: string;
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) return null;
  return formatPriceWithDecimals(price, currency);
}

export const CompareSelectButton = memo(function CompareSelectButton({
  product,
  className = '',
}: CompareSelectButtonProps) {
  const { isInCompare, addToCompare, removeFromCompare } = useCompare();
  const active = isInCompare(product.id);
  const label = active
    ? `Remove ${product.name} from compare`
    : `Add ${product.name} to compare`;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (active) {
      removeFromCompare(product.id);
    } else {
      addToCompare({
        id: product.id,
        name: product.name,
        image: product.imageUrl || '',
        prices: [
          {
            merchant: product.merchant,
            price: product.price !== null ? formatPrice(product.price, product.currency) : null,
            url: product.href,
          },
        ],
        lowestPrice: product.price !== null ? formatPrice(product.price, product.currency) : null,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // BUY-82741: keep the VidMee/axe `.product-card__action-btn` hook and
      // expose both aria-label + title so icon-only compare control is named
      // for AT and hover/tooltip users.
      className={`product-card__action-btn inline-flex items-center justify-center rounded-full border text-sm font-medium transition-all ${className} ${
        active
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          : 'border-slate-200 bg-white/95 text-slate-700 hover:border-amber-200 hover:text-amber-800'
      }`}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    </button>
  );
});
