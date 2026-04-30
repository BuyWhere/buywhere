'use client';

import { memo } from 'react';
import { useCompare } from '@/lib/compare-context';
import type { SearchCardProduct } from '@/app/search/SearchResultsClient';

interface CompareSelectButtonProps {
  product: SearchCardProduct;
  className?: string;
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) return null;
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

export const CompareSelectButton = memo(function CompareSelectButton({
  product,
  className = '',
}: CompareSelectButtonProps) {
  const { isInCompare, addToCompare, removeFromCompare } = useCompare();
  const active = isInCompare(product.id);

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
      onClick={handleClick}
      className={`inline-flex items-center justify-center rounded-full border text-sm font-medium transition-all ${className} ${
        active
          ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-slate-200 bg-white/95 text-slate-400 hover:border-amber-200 hover:text-amber-600'
      }`}
      aria-label={active ? `Remove ${product.name} from compare` : `Add ${product.name} to compare`}
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
