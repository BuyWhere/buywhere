'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { AffiliateLink } from '@/components/AffiliateLink';

export interface ComparisonProduct {
  id: string;
  name: string;
  image: string;
  description?: string;
  brand?: string;
  specs?: Record<string, string>;
  prices: ComparisonPrice[];
  overallRating?: number;
  reviewCount?: number;
  lowestPrice?: string | null;
}

export interface ComparisonPrice {
  merchant: string;
  price: string | null;
  url: string;
  inStock: boolean;
  rating?: number;
  lastUpdated: string;
  primeEligible?: boolean;
  storePickup?: boolean;
  price_missing_reason?: 'not_found' | 'retailer_unavailable' | 'scraping_failed' | 'product_discontinued';
}

interface SideBySideComparisonProps {
  products: ComparisonProduct[];
  title?: string;
  stickyHeader?: boolean;
  showSpecs?: boolean;
  showPrices?: boolean;
  showBuyLinks?: boolean;
  maxHeight?: string;
}

function formatPrice(price: string | null, isZeroPrice?: boolean): string {
  if (price === null) return '—';
  if (isZeroPrice) return 'FREE';
  const num = parseFloat(price);
  if (isNaN(num)) return price;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

function getAllSpecKeys(products: ComparisonProduct[]): string[] {
  const specKeys = new Set<string>();
  products.forEach((p) => {
    if (p.specs) {
      Object.keys(p.specs).forEach((key) => specKeys.add(key));
    }
  });
  return Array.from(specKeys);
}

function MerchantBadge({ merchant }: { merchant: string }) {
  const badges: Record<string, { emoji: string; bgColor: string }> = {
    'Amazon.com': { emoji: '📦', bgColor: 'bg-orange-50' },
    Walmart: { emoji: '🛒', bgColor: 'bg-blue-50' },
    Target: { emoji: '🎯', bgColor: 'bg-red-50' },
    'Best Buy': { emoji: '🏪', bgColor: 'bg-blue-50' },
    Shopee: { emoji: '🛍️', bgColor: 'bg-orange-50' },
    Lazada: { emoji: '📮', bgColor: 'bg-blue-50' },
    'Amazon.sg': { emoji: '📦', bgColor: 'bg-orange-50' },
    Qoo10: { emoji: '🏷️', bgColor: 'bg-green-50' },
    Carousell: { emoji: '🔄', bgColor: 'bg-green-50' },
  };
  const info = badges[merchant] || { emoji: '🛒', bgColor: 'bg-gray-50' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${info.bgColor}`}>
      <span>{info.emoji}</span>
      <span>{merchant}</span>
    </span>
  );
}

export default function SideBySideComparison({
  products,
  title,
  stickyHeader = true,
  showSpecs = true,
  showPrices = true,
  showBuyLinks = true,
}: SideBySideComparisonProps) {
  const [selectedPrices, setSelectedPrices] = useState<Record<string, ComparisonPrice>>({});
  const [showAllPrices, setShowAllPrices] = useState<Record<string, boolean>>({});
  const headerRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const initialSelected: Record<string, ComparisonPrice> = {};
    const initialShowAll: Record<string, boolean> = {};
    products.forEach((p) => {
      if (p.prices.length > 0) {
        const available = p.prices.find((pr) => pr.price !== null) || p.prices[0];
        initialSelected[p.id] = available;
        initialShowAll[p.id] = false;
      }
    });
    setSelectedPrices(initialSelected);
    setShowAllPrices(initialShowAll);
  }, [products]);

  useEffect(() => {
    if (!stickyHeader) return;
    const header = headerRef.current;
    if (!header) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(header);
    return () => observer.disconnect();
  }, [stickyHeader]);

  if (products.length === 0) {
    return (
      <div className="bg-gray-50 rounded-xl p-8 text-center text-gray-500">
        No products to compare
      </div>
    );
  }

  const specKeys = getAllSpecKeys(products);
  const hasSpecs = specKeys.length > 0;

  const getLowestPrice = (product: ComparisonProduct) => {
    const available = product.prices.filter((p) => p.price !== null);
    if (available.length === 0) return null;
    return available.reduce((min, p) => {
      const minVal = parseFloat(min.price!);
      const pVal = parseFloat(p.price!);
      return pVal < minVal ? p : min;
    });
  };

  const toggleShowAllPrices = (productId: string) => {
    setShowAllPrices((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {title && (
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-full">
          <div
            ref={headerRef}
            className={`grid gap-px bg-gray-100 ${
              showSpecs && hasSpecs
                ? 'grid-cols-[200px_repeat(4,minmax(220px,1fr))]'
                : 'grid-cols-[200px_repeat(3,minmax(200px,1fr))]'
            }`}
          >
            <div className="bg-white p-4" />
            {products.map((product) => (
              <div
                key={product.id}
                className={`bg-white p-4 flex flex-col ${
                  isSticky ? 'sticky top-0 z-10 shadow-md' : ''
                }`}
              >
                <div className="relative w-full aspect-square bg-gray-100 rounded-xl overflow-hidden mb-3">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 50vw, 25vw"
                  />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">
                  {product.name}
                </h3>
                {product.brand && (
                  <p className="text-xs text-gray-500 mb-2">{product.brand}</p>
                )}
                {product.overallRating !== undefined && (
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-yellow-500 text-xs">★</span>
                    <span className="text-xs font-medium text-gray-900">
                      {product.overallRating.toFixed(1)}
                    </span>
                    {product.reviewCount !== undefined && (
                      <span className="text-xs text-gray-500">
                        ({product.reviewCount})
                      </span>
                    )}
                  </div>
                )}
                {selectedPrices[product.id] && showPrices && (
                  <div className="mt-auto pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                      <MerchantBadge merchant={selectedPrices[product.id].merchant} />
                      <span
                        className={`text-lg font-bold ${
                          selectedPrices[product.id].price === getLowestPrice(product)?.price
                            ? 'text-green-600'
                            : 'text-indigo-600'
                        }`}
                      >
                        {formatPrice(selectedPrices[product.id].price)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          selectedPrices[product.id].inStock ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-gray-500">
                        {selectedPrices[product.id].inStock ? 'In Stock' : 'Out of Stock'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {showSpecs && hasSpecs && (
            <div className="border-t border-gray-100">
              {specKeys.map((specKey) => (
                <div
                  key={specKey}
                  className="grid gap-px bg-gray-100 border-t border-gray-100"
                >
                  <div className="bg-gray-50 px-4 py-3 flex items-center">
                    <span className="text-sm font-medium text-gray-700">{specKey}</span>
                  </div>
                  {products.map((product) => (
                    <div
                      key={`${product.id}-${specKey}`}
                      className="bg-white px-4 py-3 flex items-center"
                    >
                      <span className="text-sm text-gray-900">
                        {product.specs?.[specKey] || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {showPrices && (
            <div className="border-t border-gray-100">
              <div className="bg-gray-50 px-4 py-3">
                <span className="text-sm font-medium text-gray-700">Prices</span>
              </div>
              {products.map((product) => {
                const visiblePrices = showAllPrices[product.id]
                  ? product.prices
                  : product.prices.slice(0, 3);
                const lowestPrice = getLowestPrice(product);

                return (
                  <div
                    key={`prices-${product.id}`}
                    className="grid gap-px bg-gray-100 border-t border-gray-100"
                  >
                    <div className="bg-white px-4 py-3">
                      <div className="space-y-2">
                        {visiblePrices.map((price, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                              selectedPrices[product.id]?.merchant === price.merchant
                                ? 'bg-indigo-50 border border-indigo-200'
                                : 'bg-gray-50 hover:bg-gray-100'
                            }`}
                          >
                            <button
                              onClick={() =>
                                setSelectedPrices((prev) => ({
                                  ...prev,
                                  [product.id]: price,
                                }))
                              }
                              className="flex-1 text-left"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <MerchantBadge merchant={price.merchant} />
                                  <span
                                    className={`text-sm ${
                                      price.price === null
                                        ? 'text-gray-400 italic'
                                        : 'text-gray-900 font-medium'
                                    }`}
                                  >
                                    {formatPrice(price.price)}
                                  </span>
                                </div>
                                {price.price === lowestPrice?.price && price.price !== null && (
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                    Best
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
                        ))}
                        {product.prices.length > 3 && (
                          <button
                            onClick={() => toggleShowAllPrices(product.id)}
                            className="w-full text-sm text-indigo-600 hover:text-indigo-700 font-medium py-1"
                          >
                            {showAllPrices[product.id]
                              ? 'Show fewer prices'
                              : `+${product.prices.length - 3} more prices`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {showBuyLinks && (
            <div className="border-t border-gray-100">
              <div className="bg-gray-50 px-4 py-3">
                <span className="text-sm font-medium text-gray-700">Buy</span>
              </div>
              {products.map((product) => {
                const selectedPrice = selectedPrices[product.id];
                const isLowest =
                  selectedPrice?.price === getLowestPrice(product)?.price;

                return (
                  <div
                    key={`buy-${product.id}`}
                    className="grid gap-px bg-gray-100 border-t border-gray-100"
                  >
                    <div className="bg-white px-4 py-4">
                      {selectedPrice ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <MerchantBadge merchant={selectedPrice.merchant} />
                            {isLowest && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                Best Price
                              </span>
                            )}
                          </div>
                          <div className="text-2xl font-bold text-gray-900">
                            {formatPrice(selectedPrice.price)}
                          </div>
                          <FreshnessBadge lastUpdated={selectedPrice.lastUpdated} />
                          <AffiliateLink
                            productId={product.id}
                            platform={selectedPrice.merchant.toLowerCase().replace('.', '')}
                            productName={product.name}
                            href={selectedPrice.url}
                            className="block w-full text-center px-4 py-3 font-semibold rounded-xl transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                          >
                            View on {selectedPrice.merchant}
                          </AffiliateLink>
                        </div>
                      ) : (
                        <div className="text-center text-gray-500 py-4">
                          No price available
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
            <span className="text-xs text-gray-500">
              Data sourced from multiple retailers · Updated{' '}
              {new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
