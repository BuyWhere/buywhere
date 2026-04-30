'use client';

import React from 'react';
import Image from 'next/image';
import { useCompare, CompareProduct } from '@/lib/compare-context';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { MerchantBadge, getMerchantConfig } from '@/components/ui/MerchantBadge';
import WishlistButton from '@/components/WishlistButton';
import ShareDealActions from '@/components/share/ShareDealActions';

interface ProductCardProps {
  deal: {
    id: number;
    name: string;
    price: number;
    original_price?: number;
    discount_pct?: number;
    merchant: string;
    url: string;
    is_exclusive?: boolean;
    image_url?: string;
    rating?: number;
    review_count?: number;
    stock_status?: 'in_stock' | 'low_stock' | 'out_of_stock';
    shipping_info?: string;
    lastUpdated?: string;
  };
  comparisonEnabled?: boolean;
}

function CompareButton({ deal }: { deal: ProductCardProps['deal'] }) {
  const { addToCompare, removeFromCompare, isInCompare } = useCompare();
  const inCompare = isInCompare(String(deal.id));

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (inCompare) {
      removeFromCompare(String(deal.id));
    } else {
      const product: CompareProduct = {
        id: String(deal.id),
        name: deal.name,
        image: deal.image_url || '',
        prices: [{ merchant: deal.merchant, price: String(deal.price), url: deal.url }],
        lowestPrice: String(deal.price),
      };
      addToCompare(product);
    }
  };

  return (
    <button
      onClick={handleToggle}
      aria-label={inCompare ? 'Remove from compare' : 'Add to compare'}
      className={`
        flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm
        transition-all duration-200 touch-manipulation select-none
        active:scale-95 min-h-[44px] min-w-[44px]
        ${inCompare
          ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
          : 'bg-white/95 text-gray-700 shadow-md hover:bg-indigo-600 hover:text-white border border-gray-200 hover:border-indigo-600'
        }
      `}
    >
      <svg
        className="w-5 h-5 flex-shrink-0"
        fill={inCompare ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={inCompare 
            ? "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            : "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          }
        />
      </svg>
      <span className="hidden sm:inline">{inCompare ? 'Remove' : 'Compare'}</span>
    </button>
  );
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          className={`w-3 h-3 ${i < fullStars ? 'text-yellow-400' : i === fullStars && hasHalfStar ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          {i === fullStars && hasHalfStar ? (
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          ) : (
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          )}
        </svg>
      ))}
    </div>
  );
}

function StockStatus({ status }: { status: 'in_stock' | 'low_stock' | 'out_of_stock' }) {
  const config = {
    in_stock: { label: 'In Stock', className: 'text-green-600 bg-green-50' },
    low_stock: { label: 'Low Stock', className: 'text-amber-600 bg-amber-50' },
    out_of_stock: { label: 'Out of Stock', className: 'text-red-600 bg-red-50' },
  }[status];

  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.className}`}>
      {config.label}
    </span>
  );
}

function formatUSD(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export const ProductCard = React.memo(function ProductCard({ deal, comparisonEnabled }: ProductCardProps) {
  const config = getMerchantConfig(deal.merchant);

  return (
    <a
      href={deal.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
    >
      <div className="aspect-square bg-gray-50 relative overflow-hidden" style={{ aspectRatio: '1/1'}}>
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-50">
          {deal.image_url ? (
            <Image
              src={deal.image_url}
              alt={deal.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              loading={deal.id <= 4 ? 'eager' : 'lazy'}
              priority={deal.id <= 2}
            />
          ) : (
            <span className="text-5xl opacity-50">{config.icon}</span>
          )}
        </div>
        {deal.discount_pct && deal.discount_pct > 0 && (
          <div className="absolute top-2 right-2">
            <span className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm">
              {deal.discount_pct}% OFF
            </span>
          </div>
        )}
        {deal.is_exclusive && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-sm">
              EXCLUSIVE
            </span>
          </div>
        )}
        {deal.lastUpdated && (
          <div className="absolute bottom-2 left-2">
            <FreshnessBadge lastUpdated={deal.lastUpdated} />
          </div>
        )}
        <div className="absolute right-2 top-2">
          <WishlistButton
            product={{
              id: String(deal.id),
              name: deal.name,
              image: deal.image_url || '',
              currentPrice: String(deal.price),
              merchant: deal.merchant,
              buyUrl: deal.url,
              productUrl: deal.url,
              apiProductId: deal.id,
            }}
          />
        </div>
        <div className="absolute right-2 top-14 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <ShareDealActions
            variant="menu"
            productId={deal.id}
            productName={deal.name}
            productUrl={`/products/us/${deal.id}`}
            merchant={deal.merchant}
            priceText={formatUSD(deal.price)}
          />
        </div>
        {comparisonEnabled && (
          <div className="absolute bottom-2 left-2 right-2">
            <CompareButton deal={deal} />
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {deal.name}
        </h3>
        <MerchantBadge merchant={deal.merchant} className="mb-2" />
        {(deal.rating || deal.stock_status || deal.shipping_info) && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {deal.rating && (
              <div className="flex items-center gap-1">
                <StarRating rating={deal.rating} />
                <span className="text-xs text-gray-500">{deal.rating.toFixed(1)}</span>
                {deal.review_count && (
                  <span className="text-xs text-gray-400">({deal.review_count > 999 ? `${(deal.review_count / 1000).toFixed(1)}k` : deal.review_count})</span>
                )}
              </div>
            )}
            {deal.stock_status && <StockStatus status={deal.stock_status} />}
          </div>
        )}
        {deal.shipping_info && (
          <div className="flex items-center gap-1 mb-2">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span className="text-xs text-gray-500">{deal.shipping_info}</span>
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-indigo-600">
            {formatUSD(deal.price)}
          </span>
          {deal.original_price && deal.original_price > deal.price && (
            <span className="text-sm text-gray-400 line-through">
              {formatUSD(deal.original_price)}
            </span>
          )}
        </div>
      </div>
    </a>
  );
});

export default ProductCard;
