'use client';

import Image from 'next/image';
import Link from 'next/link';

interface TrendingProduct {
  id: number;
  title: string;
  price: number;
  currency: string;
  image_url: string;
  brand: string;
  rating: number;
  review_count: number;
  source: string;
  merchant_id: string;
  category: string;
  url: string;
}

interface TrendingProductsSectionProps {
  products: TrendingProduct[];
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          className={`w-3 h-3 ${i < fullStars ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'SGD' ? 'SGD' : 'USD',
  }).format(price);
}

function TrendingProductCard({ product }: { product: TrendingProduct }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
    >
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-50">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.title}
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
        {product.category && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-1 bg-white/90 text-gray-700 text-xs font-medium rounded-lg shadow-sm capitalize">
              {product.category}
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {product.title}
        </h3>
        {product.brand && (
          <p className="text-xs text-gray-500 mb-2 truncate">{product.brand}</p>
        )}
        <div className="flex items-center gap-2 mb-2">
          {product.rating && (
            <div className="flex items-center gap-1">
              <StarRating rating={product.rating} />
              <span className="text-xs text-gray-500">{product.rating.toFixed(1)}</span>
              {product.review_count && (
                <span className="text-xs text-gray-400">
                  ({product.review_count > 999 ? `${(product.review_count / 1000).toFixed(1)}k` : product.review_count})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-indigo-600">
            {formatPrice(product.price, product.currency)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
          <span className="uppercase">{product.source.replace('_', ' ')}</span>
        </div>
      </div>
    </a>
  );
}

export function TrendingProductsSection({ products }: TrendingProductsSectionProps) {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Trending Products</h2>
            <p className="text-gray-500">Top-rated products from our catalog</p>
          </div>
          <Link
            href="/products"
            className="hidden sm:inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View all
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.slice(0, 12).map((product) => (
            <TrendingProductCard key={product.id} product={product} />
          ))}
        </div>
        <div className="mt-8 text-center sm:hidden">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View all products
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default TrendingProductsSection;