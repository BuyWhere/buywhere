'use client';

import React, { memo, useState } from 'react';
import Image from 'next/image';
import { AffiliateLink } from '@/components/AffiliateLink';
import { MerchantBadge } from '@/components/ui/MerchantBadge';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { CompareBarChart } from '@/components/compare/CompareBarChart';
import { CompareSpecTable } from '@/components/compare/CompareSpecTable';
import { DealScoreBadge } from '@/components/compare/DealScoreBadge';
import { useCompare } from '@/lib/compare-context';
import { type DataFreshness } from '@/lib/freshness';
import ComparisonShareButton from '@/components/compare/ComparisonShareButton';

export interface CompareProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  merchant: string;
  availability: string;
  inStock: boolean | null;
  href: string;
  brand: string | null;
  category: string | null;
  lastUpdated: string | null;
  dataFreshness?: DataFreshness;
  matchScore?: number;
  savingsVsMostExpensive?: number | null;
  savingsPct?: number | null;
  dealScore?: 'great_deal' | 'good_deal' | 'fair_price' | 'high_price';
  percentVsAvg?: number;
  specs?: Record<string, string>;
  priceHistory?: Array<{ date: string; price: number }>;
  market?: string;
}

interface CompareProductsGridProps {
  products: CompareProduct[];
  title?: string;
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return 'Price unavailable';
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

function getFreshnessTier(lastUpdated: string | null): DataFreshness {
  if (!lastUpdated) return 'stale';
  const now = Date.now();
  const updated = new Date(lastUpdated).getTime();
  const hoursSince = (now - updated) / (1000 * 60 * 60);
  if (hoursSince <= 24) return 'fresh';
  if (hoursSince <= 72) return 'recent';
  if (hoursSince <= 168) return 'stale';
  return 'very_stale';
}

export const CompareProductsGrid = memo(function CompareProductsGrid({
  products,
  title = 'Product Comparison',
}: CompareProductsGridProps) {
  const { addToCompare, removeFromCompare, isInCompare } = useCompare();
  const [selectCount, setSelectCount] = useState(Math.min(products.length, 4));
  const [isPartial, setIsPartial] = useState(false);
  const [staleCount, setStaleCount] = useState(0);
  const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);

  const bestOffer = products.find((p) => p.price !== null) || null;

  React.useEffect(() => {
    const priced = products.filter((p) => p.price !== null);
    let cheapest: CompareProduct | null = null;
    for (const p of priced) {
      if (cheapest === null || (p.price !== null && cheapest.price !== null && p.price < cheapest.price)) {
        cheapest = p;
      }
    }
    if (cheapest) {
      setIsPartial(products.length < selectCount);
    }

    const staleProducts = products.filter((p) => {
      const freshness = p.dataFreshness ?? getFreshnessTier(p.lastUpdated);
      return freshness === 'stale' || freshness === 'very_stale';
    });
    setStaleCount(staleProducts.length);

    if (staleProducts.length > 0) {
      const oldest = staleProducts.reduce((oldest, p) => {
        if (!p.lastUpdated) return oldest;
        if (!oldest) return p.lastUpdated;
        return new Date(p.lastUpdated) < new Date(oldest) ? p.lastUpdated : oldest;
      }, null as string | null);
      setOldestTimestamp(oldest);
    }
  }, [products, selectCount]);

  const merchantLabels = products.map((p) => p.merchant);

  const specRows = React.useMemo(() => {
    const allKeys = new Set<string>();
    products.forEach((p) => {
      if (p.specs) {
        Object.keys(p.specs).forEach((k) => allKeys.add(k));
      }
    });
    return Array.from(allKeys).map((label) => ({
      label,
      values: Object.fromEntries(
        merchantLabels.map((m) => {
          const product = products.find((p) => p.merchant === m);
          const val = product?.specs?.[label] ?? null;
          return [m, val];
        })
      ),
    }));
  }, [products, merchantLabels]);

  if (products.length === 0) {
    return (
      <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-950">No Products Found for Comparison</h2>
        <p className="mt-3 text-sm text-slate-600">
          We could not find other retailers selling this product. This could mean it is exclusive to one retailer or new to the market.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {staleCount > 0 && (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
          role="alert"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-amber-800">
            Price data may be outdated{oldestTimestamp ? ` — last verified ${Math.round((Date.now() - new Date(oldestTimestamp).getTime()) / 86400000)} days ago` : ''}.{' '}
            <button className="underline hover:no-underline">Refresh prices</button>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
          <ComparisonShareButton title={title} />
        </div>
        <div className="flex items-center gap-2">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setSelectCount(n)}
              disabled={n > products.length}
              aria-disabled={n > products.length}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                selectCount === n
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'
              } ${n > products.length ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {n} Products
            </button>
          ))}
        </div>
      </div>

      {isPartial && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-amber-800">
            Only {products.length} retailers available for comparison. Showing all available options.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] rounded-2xl border border-slate-200 bg-white shadow-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Product
              </th>
              {products.slice(0, selectCount).map((product) => (
                <th
                  key={product.id}
                  className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 min-w-[180px]"
                >
                  <div className="flex flex-col items-center gap-2">
                    <MerchantBadge merchant={product.merchant} />
                    {product.price !== null && bestOffer?.id === product.id && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                        Best price
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {selectCount < products.length && (
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  +{products.length - selectCount} more
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Image</span>
              </td>
              {products.slice(0, selectCount).map((product) => (
                <td key={product.id} className="px-4 py-4 align-top">
                  <div className="mx-auto w-24">
                    {product.imageUrl ? (
                      <div className="relative h-24 w-24 overflow-hidden rounded-xl bg-slate-100">
                        <Image
                          src={product.imageUrl}
                          alt={product.name}
                          fill
                          sizes="96px"
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-slate-100 text-3xl text-slate-400">
                        ◎
                      </div>
                    )}
                  </div>
                </td>
              ))}
              {selectCount < products.length && <td />}
            </tr>

            <tr className={bestOffer ? 'bg-emerald-50/50' : 'bg-white'}>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Price</span>
              </td>
              {products.slice(0, selectCount).map((product) => {
                const isBest = bestOffer?.id === product.id;
                return (
                  <td key={product.id} className="px-4 py-4 align-top">
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className={`text-xl font-semibold ${isBest ? 'text-emerald-700' : 'text-slate-950'}`}
                      >
                        {formatPrice(product.price, product.currency)}
                      </span>
                      {isBest && <span className="text-xs text-emerald-600 font-medium">★ Cheapest</span>}
                      {product.savingsPct !== null && product.savingsPct !== undefined && (
                        <span className="text-xs text-slate-500">
                          Save {product.savingsPct.toFixed(0)}%
                        </span>
                      )}
                      {product.lastUpdated && (
                        <FreshnessBadge freshness={product.dataFreshness ?? getFreshnessTier(product.lastUpdated)} />
                      )}
                    </div>
                  </td>
                );
              })}
              {selectCount < products.length && <td />}
            </tr>

            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Deal Score</span>
              </td>
              {products.slice(0, selectCount).map((product) => (
                <td key={product.id} className="px-4 py-4 align-top">
                  <div className="flex justify-center">
                    {product.dealScore ? (
                      <DealScoreBadge
                        score={product.dealScore}
                        percentVsAvg={product.percentVsAvg ?? 0}
                        currency={product.currency}
                      />
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                </td>
              ))}
              {selectCount < products.length && <td />}
            </tr>

            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Market</span>
              </td>
              {products.slice(0, selectCount).map((product) => (
                <td key={product.id} className="px-4 py-4 align-top">
                  <div className="flex justify-center text-sm text-slate-600">
                    {product.market ?? '—'}
                  </div>
                </td>
              ))}
              {selectCount < products.length && <td />}
            </tr>

            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Price History</span>
              </td>
              {products.slice(0, selectCount).map((product) => (
                <td key={product.id} className="px-4 py-4 align-top">
                  <div className="flex justify-center">
                    {product.priceHistory && product.priceHistory.length > 0 ? (
                      <CompareBarChart
                        history={product.priceHistory}
                        currency={product.currency}
                        height={48}
                        className="w-32"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">No history</span>
                    )}
                  </div>
                </td>
              ))}
              {selectCount < products.length && <td />}
            </tr>

            {specRows.length > 0 && (
              <tr>
                <td className="px-4 py-4 align-top" colSpan={selectCount + 2}>
                  <div className="mt-2">
                    <CompareSpecTable specs={specRows} merchantLabels={merchantLabels.slice(0, selectCount)} />
                  </div>
                </td>
              </tr>
            )}

            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Availability</span>
              </td>
              {products.slice(0, selectCount).map((product) => (
                <td key={product.id} className="px-4 py-4 align-top">
                  <div className="flex justify-center">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                        product.inStock === true
                          ? 'bg-emerald-100 text-emerald-800'
                          : product.inStock === false
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {product.availability}
                    </span>
                  </div>
                </td>
              ))}
              {selectCount < products.length && <td />}
            </tr>

            <tr>
              <td className="px-4 py-4 align-top">
                <span className="text-sm font-medium text-slate-700">Action</span>
              </td>
              {products.slice(0, selectCount).map((product) => {
                const isBest = bestOffer?.id === product.id;
                return (
                  <td key={product.id} className="px-4 py-4 align-top">
                    <div className="flex flex-col items-center gap-2">
                      <AffiliateLink
                        href={product.href}
                        productId={product.id}
                        platform={product.merchant.toLowerCase().replace(/[^a-z0-9]+/g, '_')}
                        productName={product.name}
                        utmCampaign="compare_page"
                        className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          isBest
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        Open retailer
                      </AffiliateLink>
                      <button
                        onClick={() => isInCompare(product.id) ? removeFromCompare(product.id) : addToCompare({
                          id: product.id,
                          name: product.name,
                          image: product.imageUrl || '',
                          prices: [{ merchant: product.merchant, price: product.price !== null ? formatPrice(product.price, product.currency) : null, url: product.href }],
                          lowestPrice: product.price !== null ? formatPrice(product.price, product.currency) : null,
                        })}
                        className={`text-xs ${isInCompare(product.id) ? 'text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        {isInCompare(product.id) ? '✓ In compare' : '+ Add to compare'}
                      </button>
                    </div>
                  </td>
                );
              })}
              {selectCount < products.length && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        BuyWhere uses affiliate links. We may earn a commission when you purchase through retailer links, at no extra cost to you. This helps support our free price-comparison service.
      </div>
    </div>
  );
});

export default CompareProductsGrid;