'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AffiliateLink } from '@/components/AffiliateLink';

interface CrossMarketProduct {
  id: number;
  name: string;
  price: number;
  currency: string;
  source: string;
  buy_url: string;
  image_url?: string;
  lowest_price?: string;
  lowest_price_merchant?: string;
}

interface CrossMarketWidgetProps {
  productName: string;
  currentMarket?: string;
}

const MARKET_FLAGS: Record<string, { flag: string; label: string; currency: string }> = {
  SG: { flag: '🇸🇬', label: 'Singapore', currency: 'SGD' },
  VN: { flag: '🇻🇳', label: 'Vietnam', currency: 'VND' },
  MY: { flag: '🇲🇾', label: 'Malaysia', currency: 'MYR' },
  TH: { flag: '🇹🇭', label: 'Thailand', currency: 'THB' },
  PH: { flag: '🇵🇭', label: 'Philippines', currency: 'PHP' },
  ID: { flag: '🇮🇩', label: 'Indonesia', currency: 'IDR' },
  US: { flag: '🇺🇸', label: 'United States', currency: 'USD' },
};

function formatPrice(price: number, currency: string): string {
  const localeMap: Record<string, string> = {
    USD: 'en-US',
    SGD: 'en-SG',
    VND: 'vi-VN',
    MYR: 'en-MY',
    THB: 'th-TH',
    PHP: 'en-PH',
    IDR: 'en-ID',
  };
  const locale = localeMap[currency] || 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'VND' ? 0 : 2,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(price);
}

export function CrossMarketWidget({ productName, currentMarket = 'US' }: CrossMarketWidgetProps) {
  const [crossMarketProducts, setCrossMarketProducts] = useState<CrossMarketProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchCrossMarketProducts = async () => {
      const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || 'https://api.buywhere.ai';
      const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';

      const markets = ['SG', 'VN', 'MY', 'TH', 'PH', 'ID'].filter(m => m !== currentMarket);
      
      try {
        const fetchPromises = markets.map(async (market) => {
          const params = new URLSearchParams({
            q: productName,
            country: market,
            limit: '3',
          });

          const res = await fetch(`${baseUrl}/v1/search?${params.toString()}`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          if (!res.ok) return null;
          const data = await res.json();
          return data.items?.[0] || null;
        });

        const results = await Promise.all(fetchPromises);
        const validResults = results.filter((r): r is CrossMarketProduct => r !== null && r.price > 0);

        setCrossMarketProducts(validResults);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchCrossMarketProducts();
  }, [productName, currentMarket]);

  if (loading) {
    return (
      <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🌏</span>
          <h3 className="text-base font-semibold text-gray-900">Also Available in Other Markets</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-20 bg-gray-200 rounded-lg"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || crossMarketProducts.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌏</span>
          <h3 className="text-base font-semibold text-gray-900">Also Available in Other Markets</h3>
        </div>
        <Link
          href={`/search?q=${encodeURIComponent(productName)}`}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Compare all markets →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {crossMarketProducts.map((product) => {
          const marketInfo = MARKET_FLAGS[product.source] || MARKET_FLAGS[product.source.toUpperCase()];
          const flag = marketInfo?.flag || '🌍';
          const label = marketInfo?.label || product.source;
          const currency = marketInfo?.currency || 'USD';

          return (
            <div
              key={`${product.id}-${product.source}`}
              className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 hover:border-indigo-200 hover:shadow-sm transition-all"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-xl">
                {flag}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-medium text-gray-500">{label}</span>
                  {marketInfo && (
                    <span className="text-xs text-gray-400">•</span>
                  )}
                  <span className="text-xs text-gray-400 truncate">{product.lowest_price_merchant || product.source}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold text-gray-900">
                    {formatPrice(product.price || (product.lowest_price ? parseFloat(product.lowest_price) : 0), currency)}
                  </span>
                  <span className="text-xs text-gray-400">{currency}</span>
                </div>
              </div>
              <AffiliateLink
                productId={String(product.id)}
                platform={`${product.source.toLowerCase()}`}
                productName={productName}
                href={product.buy_url}
                className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </AffiliateLink>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CrossMarketWidget;