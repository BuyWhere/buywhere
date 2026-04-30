'use client';

import type { USMerchantPrice } from '@/lib/us-products';
import { AffiliateLink } from '@/components/AffiliateLink';

interface PriceCardProps {
  price: USMerchantPrice;
  productId: string;
  productName?: string;
  isLowest: boolean;
  productInCompare: boolean;
  onAddToCompare: () => void;
  msrp?: string; // For savings calculation
  competitorPrices?: USMerchantPrice[]; // For comparison badges
}

function formatPrice(price: string | null, isZeroPrice?: boolean): string {
  if (price === null) return '—';
  if (isZeroPrice) return 'FREE';
  const num = parseFloat(price);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

function calculateSavings(currentPrice: string, comparisonPrice: string): { amount: number; percent: number } | null {
  const current = parseFloat(currentPrice);
  const comparison = parseFloat(comparisonPrice);
  
  if (current >= comparison) return null;
  
  const amount = comparison - current;
  const percent = (amount / comparison) * 100;
  
  return { amount, percent };
}

export default function PriceCard({
  price,
  productId,
  productName,
  isLowest,
  productInCompare,
  onAddToCompare,
  msrp,
  competitorPrices,
}: PriceCardProps) {
  const info = {
    'Amazon.com': {
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      accentColor: 'border-orange-200',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z"/>
        </svg>
      ),
    },
    Walmart: {
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      accentColor: 'border-blue-200',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18 6h-2c0-2.2-1.8-4-4-4S8 3.8 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h12v12z"/>
        </svg>
      ),
    },
    Target: {
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      accentColor: 'border-red-200',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
          <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2" fill="none"/>
          <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </svg>
      ),
    },
    'Best Buy': {
      color: 'text-blue-700',
      bgColor: 'bg-blue-50',
      accentColor: 'border-blue-300',
      icon: (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h16v2H4V4zm0 4h16v12H4V8zm2 2v8h12v-8H6zm2 2h8v4H8v-4z"/>
        </svg>
      ),
    },
  }[price.merchant];

  // Find best price among competitors for highlighting
  const bestPriceInfo = competitorPrices?.reduce((best, current) => {
    if (!best.price) return current;
    if (!current.price) return best;
    return parseFloat(current.price) < parseFloat(best.price) ? current : best;
  }, competitorPrices[0]);

  const isBestPrice = isLowest && bestPriceInfo?.merchant === price.merchant;
  
  // Calculate savings vs MSRP
  const msrpSavings = msrp && price.price ? calculateSavings(price.price, msrp) : null;
  
  // Calculate savings vs best competitor price
  const competitorSavings = competitorPrices && price.price && !isBestPrice 
    ? calculateSavings(price.price, bestPriceInfo?.price ?? '0') 
    : null;

  return (
    <div
      className={`relative flex flex-col rounded-xl md:rounded-2xl border p-3 md:p-5 transition-all hover:shadow-lg ${
        isBestPrice
          ? 'bg-green-50 border-green-200'
          : ''
      }`}
    >
      {isBestPrice && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full shadow-sm">
            BEST PRICE
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span className={`${info.color}`} aria-hidden="true">{info.icon}</span>
        <span className={`font-semibold ${info.color}`}>{price.merchant}</span>
      </div>

      {price.price === null ? (
        <div className="flex-1 flex flex-col items-center justify-center py-4 md:py-6">
          <span className="text-xl md:text-2xl text-gray-300 mb-1 md:mb-2">—</span>
          <span className="text-xs md:text-sm text-gray-500 italic text-center">
            {price.price_missing_reason === 'not_found'
              ? 'Price not found'
              : price.price_missing_reason === 'retailer_unavailable'
              ? 'Retailer unavailable'
              : price.price_missing_reason === 'scraping_failed'
              ? 'Could not fetch price'
              : price.price_missing_reason === 'product_discontinued'
              ? 'Product discontinued'
              : 'Price unavailable'}
          </span>
        </div>
      ) : (
        <div className="flex-1">
          <div className="mb-3">
            <div className={`text-2xl md:text-3xl font-bold ${
              isBestPrice ? 'text-green-600' : 'text-gray-900'
            }`}>
              {formatPrice(price.price)}
            </div>
            
            {msrpSavings && (
              <div className="flex items-center gap-2 text-sm text-green-600 mt-1">
                <span className="text-xs">Save</span>
                <span className="font-semibold">
                  ${msrpSavings.amount.toFixed(2)} ({msrpSavings.percent.toFixed(0)}%)
                </span>
              </div>
            )}
            
            {competitorSavings && !msrpSavings && (
              <div className="flex items-center gap-2 text-sm text-blue-600 mt-1">
                <span className="text-xs">Save</span>
                <span className="font-semibold">
                  ${competitorSavings.amount.toFixed(2)} ({competitorSavings.percent.toFixed(0)}%)
                </span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <span
              className={`w-2 h-2 rounded-full ${
                price.inStock ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span>{price.inStock ? 'In Stock' : 'Out of Stock'}</span>
          </div>

          {price.merchant === 'Amazon.com' && price.primeEligible && (
            <div className="flex items-center gap-1 text-xs text-orange-600 mb-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              Prime Eligible
            </div>
          )}

          {price.merchant === 'Walmart' && price.storePickup && (
            <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Store Pickup Available
            </div>
          )}

          {price.merchant === 'Target' && price.storePickup && (
            <div className="flex items-center gap-1 text-xs text-red-600 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Order Pickup Available
            </div>
          )}

          {price.merchant === 'Best Buy' && (
            <div className="flex items-center gap-1 text-xs text-blue-700 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Free Shipping on Orders $35+
            </div>
          )}

          {price.rating && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-yellow-500">★</span>
              <span className="font-medium text-gray-900">{price.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {price.price !== null ? (
          <AffiliateLink
            productId={productId}
            platform={price.merchant.toLowerCase().replace('.', '')}
            productName={productName}
            href={price.url}
            className="block w-full text-center px-4 py-3 font-semibold rounded-xl transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
          >
            View on {price.merchant}
          </AffiliateLink>
        ) : (
          <button
            disabled
            className="w-full px-4 py-3 font-semibold rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Unavailable
          </button>
        )}
        {onAddToCompare && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAddToCompare();
            }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-lg text-sm transition-all min-h-[44px] touch-manipulation active:scale-95 ${
              productInCompare
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200'
                : 'bg-gray-50 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 border border-gray-200 hover:border-indigo-200'
            }`}
          >
            <svg
              className="w-4 h-4"
              fill={productInCompare ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={productInCompare
                  ? "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  : "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                }
              />
            </svg>
            {productInCompare ? 'In Compare' : 'Add to Compare'}
          </button>
        )}
      </div>

      <div className="mt-3 text-xs text-gray-400 text-center">
        Updated {/* getFreshnessLabel(getFreshnessTier(price.lastUpdated)) */}
      </div>
    </div>
  );
}