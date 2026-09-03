'use client';

import { USProduct } from '@/components/USPriceComparison';

interface PriceComparisonMatrixProps {
  product: USProduct;
  highlightBestPrice: boolean;
  showSavings: boolean;
  showAvailability: boolean;
}

function formatPrice(price: string | null): string {
  if (price === null) return '—';
  const num = parseFloat(price);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

function calculateSavings(currentPrice: string, bestPrice: string): { amount: number; percent: number } | null {
  const current = parseFloat(currentPrice);
  const best = parseFloat(bestPrice);
  
  if (current <= best) return null;
  
  const amount = current - best;
  const percent = (amount / best) * 100;
  
  return { amount, percent };
}

export default function PriceComparisonMatrix({
  product,
  highlightBestPrice = true,
  showSavings = true,
  showAvailability = true,
}: PriceComparisonMatrixProps) {
  const availablePrices = product.prices.filter((p) => p.price !== null);
  
  if (availablePrices.length === 0) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-500">
        No price data available
      </div>
    );
  }
  
  // Find best price
  const lowestPrice = availablePrices.reduce((min, p) => 
    parseFloat(p.price!) < parseFloat(min.price!) ? p : min
  );
  
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Attribute
              </th>
              {product.prices.map((price) => (
                <th 
                  key={price.merchant} 
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${
                    highlightBestPrice && lowestPrice.merchant === price.merchant 
                      ? 'bg-green-50' 
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {{
                        'Amazon.com': '📦',
                        Walmart: '🛒',
                        Target: '🎯',
                        'Best Buy': '🏪',
                      }[price.merchant] || '🛒'}
                    </span>
                    <span className="font-medium">{price.merchant}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Price Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                Price
              </td>
              {product.prices.map((price) => {
                const isBest = highlightBestPrice && lowestPrice.merchant === price.merchant;
                const savings = showSavings && price.price && lowestPrice.price && price.merchant !== lowestPrice.merchant
                  ? calculateSavings(price.price, lowestPrice.price!)
                  : null;
                
                return (
                  <td 
                    key={price.merchant} 
                    className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                      isBest 
                        ? 'text-green-600' 
                        : price.price === null 
                        ? 'text-gray-400' 
                        : 'text-gray-900'
                    }`}
                  >
                    {price.price === null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        <span className={`${isBest ? 'font-semibold' : ''} block`}>
                          {formatPrice(price.price)}
                        </span>
                        {savings && (
                          <div className="text-xs mt-1 flex items-center gap-1 text-green-600">
                            <span>−</span>
                            <span className="font-medium">
                              ${savings.amount.toFixed(2)} ({savings.percent.toFixed(0)}%)
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
            
            {/* Savings Row */}
            {showSavings && (
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                  Savings vs Best
                </td>
                {product.prices.map((price) => {
                  const isBest = highlightBestPrice && lowestPrice.merchant === price.merchant;
                  const savings = price.price && lowestPrice.price && price.merchant !== lowestPrice.merchant
                    ? calculateSavings(price.price, lowestPrice.price!)
                    : null;
                  
                  return (
                    <td 
                      key={price.merchant} 
                      className={`px-6 py-4 whitespace-nowrap text-sm ${
                        isBest 
                          ? 'text-green-600' 
                          : savings 
                          ? 'text-green-600' 
                          : 'text-gray-400'
                      }`}
                    >
                      {isBest ? (
                        <span className="font-semibold">Best Price</span>
                      ) : savings ? (
                        <>
                          <span className="block">−</span>
                          <span className="font-medium block">
                            ${savings.amount.toFixed(2)} ({savings.percent.toFixed(0)}%)
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
            
            {/* Availability Row */}
            {showAvailability && (
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                  Availability
                </td>
                {product.prices.map((price) => (
                  <td 
                    key={price.merchant} 
                    className={`px-6 py-4 whitespace-nowrap text-sm ${
                      highlightBestPrice && lowestPrice.merchant === price.merchant 
                        ? 'bg-green-50' 
                        : ''
                    }`}
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        price.inStock ? 'text-green-700' : 'text-red-700'
                      }`}
                      aria-label={price.inStock ? 'In stock' : 'Out of stock'}
                    >
                      {price.inStock ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span>{price.inStock ? 'In Stock' : 'Out of Stock'}</span>
                    </span>
                  </td>
                ))}
              </tr>
            )}
            
            {/* Shipping Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                Shipping
              </td>
              {product.prices.map((price) => {
                let shippingText = 'Standard';
                let shippingClass = 'text-gray-600';
                
                if (price.merchant === 'Amazon.com' && price.primeEligible) {
                  shippingText = 'Prime';
                  shippingClass = 'text-orange-600';
                } else if (
                  price.merchant === 'Walmart' && 
                  price.storePickup
                ) {
                  shippingText = 'Store Pickup';
                  shippingClass = 'text-blue-600';
                } else if (
                  price.merchant === 'Target' && 
                  price.storePickup
                ) {
                  shippingText = 'Order Pickup';
                  shippingClass = 'text-red-600';
                } else if (
                  price.merchant === 'Best Buy' && 
                  price.price !== null && 
                  parseFloat(price.price!) >= 35
                ) {
                  shippingText = 'Free';
                  shippingClass = 'text-blue-600';
                }
                
                return (
                  <td 
                    key={price.merchant} 
                    className={`px-6 py-4 whitespace-nowrap text-sm ${shippingClass} ${
                      highlightBestPrice && lowestPrice.merchant === price.merchant 
                        ? 'bg-green-50' 
                        : ''
                    }`}
                  >
                    {shippingText}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}