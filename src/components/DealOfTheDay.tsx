'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

interface DealOfTheDayProps {
  deal: {
    id: number;
    name: string;
    price: number;
    original_price?: number;
    discount_pct?: number;
    merchant: string;
    url: string;
    ends_at?: string;
    image_url?: string;
    rating?: number;
    review_count?: number;
  };
}

const MERCHANT_CONFIG: Record<string, { icon: string; bgColor: string }> = {
  'Amazon': { icon: '📦', bgColor: 'bg-orange-100' },
  'Walmart': { icon: '🛒', bgColor: 'bg-blue-100' },
  'Target': { icon: '🎯', bgColor: 'bg-red-100' },
  'Best Buy': { icon: '🏪', bgColor: 'bg-blue-100' },
};

function getMerchantConfig(merchant: string) {
  return MERCHANT_CONFIG[merchant] || { icon: '🏬', bgColor: 'bg-gray-100' };
}

function CountdownTimer({ endsAt }: { endsAt: Date }) {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const diff = endsAt.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <span className="text-red-600 font-semibold inline-block min-w-[120px]" aria-live="polite">
      {timeLeft ? `Ends in ${timeLeft}` : 'Calculating...'}
    </span>
  );
}

export function DealOfTheDay({ deal }: DealOfTheDayProps) {
  const config = getMerchantConfig(deal.merchant);
  const savings = deal.original_price ? deal.original_price - deal.price : 0;

  return (
    <section className="bg-white rounded-2xl border border-indigo-100 p-6 md:p-8">
      <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-4">
        Deal of the Day
      </p>
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <div className="relative w-full md:w-72 h-72 flex-shrink-0">
          <div className="w-full h-full rounded-lg bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center overflow-hidden">
            {deal.image_url ? (
              <Image src={deal.image_url} alt={deal.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 288px" priority />
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

export default DealOfTheDay;