'use client';

import { ProductCard } from './ProductCard';

interface DealProduct {
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
}

interface TrendingDealsGridProps {
  deals: DealProduct[];
  loading?: boolean;
}

function DealCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
      <div className="aspect-square bg-gray-200 w-full" />
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

export function TrendingDealsGrid({ deals, loading }: TrendingDealsGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(12)].map((_, i) => (
          <DealCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {deals.slice(0, 12).map((deal) => (
        <ProductCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}

export default TrendingDealsGrid;