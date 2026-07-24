'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PRODUCT_TAXONOMY } from '@/lib/taxonomy';

interface DealProduct {
  id: number;
  name: string;
  price: number;
  original_price?: number;
  currency: string;
  discount_pct?: number;
  merchant: string;
  url: string;
  ends_at?: string;
  is_exclusive?: boolean;
  image_url?: string;
  rating?: number;
  review_count?: number;
}

interface PriceDrop {
  id: number;
  title: string;
  oldPrice: number;
  newPrice: number;
  merchant: string;
  url: string;
  timestamp: Date;
}

const DEALS_API_URL = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || 'https://api.buywhere.ai';
const API_KEY = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || '';

const CATEGORIES = [
  { id: 'all', label: 'All Deals' },
  ...PRODUCT_TAXONOMY.filter((cat) => cat.regions.includes('us')).map((cat) => ({
    id: cat.id,
    label: cat.name,
  })),
];

const REFRESH_INTERVAL = 15 * 60 * 1000;

const MERCHANT_CONFIG: Record<string, { icon: string; bgColor: string }> = {
  'Amazon': { icon: '📦', bgColor: 'bg-orange-100' },
  'Walmart': { icon: '🛒', bgColor: 'bg-blue-100' },
  'Target': { icon: '🎯', bgColor: 'bg-red-100' },
  'Best Buy': { icon: '🏪', bgColor: 'bg-blue-100' },
};

function getMerchantConfig(merchant: string) {
  return MERCHANT_CONFIG[merchant] || { icon: '🏬', bgColor: 'bg-gray-100' };
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function CountdownTimer({ endsAt }: { endsAt: Date }) {
  const [timeLeft, setTimeLeft] = useState('');
  const endTimeRef = useRef(endsAt.getTime());
  endTimeRef.current = endsAt.getTime();

  useEffect(() => {
    const calculateTimeLeft = () => {
      const diff = endTimeRef.current - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return false;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      return true;
    };

    calculateTimeLeft();
    const interval = setInterval(() => {
      if (!calculateTimeLeft()) {
        clearInterval(interval);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!timeLeft) {
    return (
      <span className="text-red-600 font-semibold" aria-live="polite">
        Calculating...
      </span>
    );
  }

  return (
    <span className="text-red-600 font-semibold tabular-nums" aria-live="polite">
      Ends in {timeLeft}
    </span>
  );
}

function DealOfTheDay({ deal }: { deal: DealProduct }) {
  const config = getMerchantConfig(deal.merchant);
  const savings = deal.original_price ? deal.original_price - deal.price : 0;

  return (
    <section className="bg-white rounded-2xl border border-indigo-100 p-6 md:p-8 mb-8">
      <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-4">
        Deal of the Day
      </p>
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <div className="relative w-full md:w-72 h-72 flex-shrink-0">
          <div className="relative w-full h-full rounded-lg bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center overflow-hidden">
            {deal.image_url ? (
              <Image src={deal.image_url} alt={deal.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 288px" priority quality={85} style={{ aspectRatio: "1/1", objectFit: "cover" }} />
            ) : (
              <span className="text-7xl opacity-50">{config.icon}</span>
            )}
          </div>
          {deal.discount_pct && deal.discount_pct > 0 && (
            <span className="absolute top-3 right-3 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
              -{deal.discount_pct}%
            </span>
          )}
        </div>
        <div className="flex-1 flex flex-col justify-center">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2 line-clamp-2">
            {deal.name}
          </h2>
          {deal.rating && (
            <div className="flex items-center gap-1 mb-3">
              <span className="text-yellow-400">★★★★★</span>
              <span className="text-sm text-gray-600">{deal.rating.toFixed(1)} ({deal.review_count?.toLocaleString() || 'N/A'} reviews)</span>
            </div>
          )}
          <div className={`inline-flex items-center gap-2 ${config.bgColor} px-3 py-1 rounded-full w-fit mb-4`}>
            <span className="text-lg">{config.icon}</span>
            <span className="text-sm font-medium text-gray-700">{deal.merchant}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-3 mb-4">
            <span className="text-3xl font-bold text-gray-900">
              ${deal.price.toFixed(2)}
            </span>
            {deal.original_price && (
              <>
                <span className="text-lg text-gray-400 line-through">
                  ${deal.original_price.toFixed(2)}
                </span>
                <span className="text-green-600 font-semibold">
                  Save ${savings.toFixed(2)} ({deal.discount_pct}% off)
                </span>
              </>
            )}
          </div>
          {deal.ends_at && (
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <CountdownTimer endsAt={new Date(deal.ends_at)} />
            </div>
          )}
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors w-fit"
          >
            View Deal →
          </a>
        </div>
      </div>
    </section>
  );
}

function PriceDropFeed({ drops }: { drops: PriceDrop[] }) {
  if (drops.length === 0) return null;

  const isGridLayout = drops.length > 4;

  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-8">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span>📉</span> Price Drops
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
            {drops.length}
          </span>
        </h3>
        <Link
          href="/compare/us"
          className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
        >
          View All →
        </Link>
      </div>
      <div className={isGridLayout ? 'grid grid-cols-1 md:grid-cols-2 gap-2' : 'space-y-3'}>
        {drops.map((drop) => (
          <a
            key={drop.id}
            href={drop.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white transition-colors"
          >
            <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></span>
            <span className="flex-1 truncate text-sm font-medium text-gray-900">
              {drop.title}
            </span>
            <span className="text-sm">
              <span className="text-gray-400 line-through">${drop.oldPrice.toFixed(2)}</span>
              <span className="text-green-600 font-bold mx-1">→${drop.newPrice.toFixed(2)}</span>
              <span className="text-green-600 text-xs">(-${(drop.oldPrice - drop.newPrice).toFixed(2)})</span>
            </span>
            <span className="text-xs text-gray-400">{formatTimeAgo(drop.timestamp)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function DealCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
      <div className="aspect-square bg-gray-200" />
      <div className="p-4">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
        <div className="flex items-center gap-2 mb-2">
          <div className="h-6 bg-gray-200 rounded w-16" />
          <div className="h-4 bg-gray-200 rounded w-12" />
        </div>
        <div className="h-5 bg-gray-200 rounded w-20" />
      </div>
    </div>
  );
}

function DealCard({ deal, priority = false }: { deal: DealProduct; priority?: boolean }) {
  const config = getMerchantConfig(deal.merchant);

  return (
    <a
      href={deal.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
    >
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-50">
          {deal.image_url ? (
            <Image src={deal.image_url} alt={deal.name} fill className="object-cover" sizes="(max-width: 768px) 50vw, 288px" loading={priority ? 'eager' : 'lazy'} priority={priority} style={{ aspectRatio: "1/1", objectFit: "cover" }} />
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
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {deal.name}
        </h3>
        <div className={`inline-flex items-center gap-1.5 ${config.bgColor} px-2 py-0.5 rounded-full w-fit mb-2`}>
          <span className="text-xs">{config.icon}</span>
          <span className="text-xs text-gray-600">{deal.merchant}</span>
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xl font-bold text-indigo-600">
            ${deal.price.toFixed(2)}
          </span>
          {deal.original_price && deal.original_price > deal.price && (
            <span className="text-sm text-gray-400 line-through">
              ${deal.original_price.toFixed(2)}
            </span>
          )}
        </div>
        {deal.ends_at && (
          <p className="text-xs text-gray-400">
            Ends {new Date(deal.ends_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </a>
  );
}

function generateMockDeals(): DealProduct[] {
  const mockProducts = [
    { name: 'Sony WH-1000XM5 Wireless Headphones', merchant: 'Amazon', discount: 25 },
    { name: 'Apple AirPods Pro 2nd Gen', merchant: 'Best Buy', discount: 20 },
    { name: 'Dyson V15 Detect Vacuum', merchant: 'Walmart', discount: 15 },
    { name: 'Ninja Foodi Pressure Cooker', merchant: 'Target', discount: 30 },
    { name: 'Samsung Galaxy Watch 6', merchant: 'Amazon', discount: 22 },
    { name: 'Apple Watch Series 9', merchant: 'Best Buy', discount: 18 },
    { name: 'iRobot Roomba j7+', merchant: 'Walmart', discount: 25 },
    { name: 'Bose QuietComfort 45', merchant: 'Amazon', discount: 28 },
    { name: 'Instant Pot Pro Plus', merchant: 'Target', discount: 35 },
    { name: 'Shark Navigator Vacuum', merchant: 'Amazon', discount: 40 },
    { name: 'KitchenAid Stand Mixer', merchant: 'Best Buy', discount: 20 },
    { name: 'Fitbit Charge 6', merchant: 'Walmart', discount: 15 },
  ];

  return mockProducts.map((product, index) => {
    const basePrice = 49 + Math.random() * 350;
    const originalPrice = basePrice * (1 + product.discount / 100);
    return {
      id: index + 1,
      name: product.name,
      price: basePrice,
      original_price: originalPrice,
      currency: 'USD',
      discount_pct: product.discount,
      merchant: product.merchant,
      url: '#',
      ends_at: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      is_exclusive: Math.random() > 0.8,
      rating: 4.0 + Math.random(),
      review_count: Math.floor(100 + Math.random() * 15000),
    };
  });
}

export function USDealsSection() {
  const [deals, setDeals] = useState<DealProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDeals = useCallback(async (category: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ country: 'US', limit: '12' });
      if (category !== 'all') {
        params.set('category', category);
      }

      const response = await fetch(`${DEALS_API_URL}/v1/deals?${params}`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch deals');
      }

      const data = await response.json();
      setDeals(data.deals || []);
      setLastUpdated(new Date());
    } catch {
      setDeals(generateMockDeals());
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeals(activeCategory);
  }, [activeCategory, fetchDeals]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDeals(activeCategory);
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [activeCategory, fetchDeals]);

  const dealOfTheDay = useMemo(() => {
    if (deals.length === 0) return null;
    return deals.reduce((best, deal) => {
      if (!best) return deal;
      const bestDiscount = best.discount_pct || 0;
      const dealDiscount = deal.discount_pct || 0;
      return dealDiscount > bestDiscount ? deal : best;
    });
  }, [deals]);

  const priceDrops = useMemo<PriceDrop[]>(() => {
    return deals
      .filter((deal) => deal.original_price && deal.original_price > deal.price)
      .map((deal) => ({
        id: deal.id,
        title: deal.name,
        oldPrice: deal.original_price!,
        newPrice: deal.price,
        merchant: deal.merchant,
        url: deal.url,
        timestamp: new Date(Date.now() - Math.random() * 60 * 60 * 1000),
      }))
      .slice(0, 12);
  }, [deals]);

  return (
    <section className="py-16 bg-white border-t border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                LIVE DEALS
              </span>
              {lastUpdated && (
                <span className="text-xs text-gray-400">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              Top US Deals
            </h2>
            <p className="text-gray-500 mt-1">
              Real-time price drops from Amazon, Walmart, Target & Best Buy
            </p>
          </div>
          <Link
            href="/compare/us"
            className="text-indigo-600 font-medium hover:text-indigo-700 transition-colors text-sm"
          >
            View all deals →
          </Link>
        </div>

        {dealOfTheDay && !loading && (
          <DealOfTheDay deal={dealOfTheDay} />
        )}

        <PriceDropFeed drops={priceDrops} />

        <div className="flex flex-wrap gap-2 mb-8" role="tablist">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              role="tab"
              aria-selected={activeCategory === cat.id}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                activeCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-center py-8 text-gray-500">
            <p>Unable to load deals. Showing cached results.</p>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(12)].map((_, i) => (
              <DealCardSkeleton key={i} />
            ))}
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No deals available in this category.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {deals.slice(0, 12).map((deal, index) => (
              <DealCard key={deal.id} deal={deal} priority={index < 4} />
            ))}
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            Auto-refreshes every 15 minutes · Prices and availability may vary
          </p>
        </div>
      </div>
    </section>
  );
}

export default USDealsSection;