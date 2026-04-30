'use client';

import Image from 'next/image';
import { useRecentlyViewed } from '@/lib/recently-viewed-context';

function formatPrice(price: string | null): string {
  if (price === null) return '—';
  const num = parseFloat(price);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

function RecentlyViewedCard({ product }: { product: ReturnType<typeof useRecentlyViewed>['recentlyViewed'][0] }) {
  return (
    <a
      href={product.url}
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
    >
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-50">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              loading="lazy"
            />
          ) : (
            <span className="text-4xl opacity-30">📦</span>
          )}
        </div>
        <div className="absolute top-2 left-2">
          <span className="px-2 py-1 bg-white/90 text-gray-700 text-xs font-medium rounded-lg shadow-sm">
            Recently Viewed
          </span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {product.name}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-indigo-600">
            {formatPrice(product.price)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
          <span className="uppercase">{product.merchant}</span>
        </div>
      </div>
    </a>
  );
}

export function RecentlyViewedSection() {
  const { recentlyViewed } = useRecentlyViewed();

  if (recentlyViewed.length === 0) {
    return null;
  }

  return (
    <section className="py-12 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Recently Viewed</h2>
            <p className="text-gray-500">Products you&apos;ve looked at</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {recentlyViewed.slice(0, 8).map((product) => (
            <RecentlyViewedCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default RecentlyViewedSection;