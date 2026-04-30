'use client';

import React from 'react';
import Image from 'next/image';
import WishlistButton from '@/components/WishlistButton';

export interface BrowseProduct {
  id: number;
  name: string;
  brand: string;
  price: number;
  originalPrice?: number;
  discountPct?: number;
  imageUrl: string;
  url: string;
  rating?: number;
  reviewCount?: number;
  inStock: boolean;
  badge?: string;
  colors?: { name: string; hex: string }[];
  sizes?: { code: string; available: boolean }[];
}

interface CategoryProductCardProps {
  product: BrowseProduct;
  viewMode: 'grid' | 'list';
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;

  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          className={`w-3 h-3 ${i < fullStars ? 'text-yellow-400' : i === fullStars && hasHalfStar ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export const CategoryProductCard = React.memo(function CategoryProductCard({
  product,
  viewMode,
}: CategoryProductCardProps) {
  if (viewMode === 'list') {
    return (
      <a
        href={product.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-4 p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
      >
        <div className="relative w-20 h-24 flex-shrink-0 bg-gray-50 rounded overflow-hidden">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="80px"
              className="object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">
              📦
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider">{product.brand}</p>
          <h3 className="text-sm font-medium text-gray-900 line-clamp-2 mt-0.5">
            {product.name}
          </h3>
          <div className="flex items-center gap-1 mt-1">
            {product.rating && (
              <>
                <StarRating rating={product.rating} />
                <span className="text-xs text-gray-500">({product.reviewCount})</span>
              </>
            )}
          </div>
          <p className={`text-xs mt-1 ${product.inStock ? 'text-green-600' : 'text-red-600'}`}>
            {product.inStock ? '✓ In Stock' : 'Out of Stock'}
          </p>
        </div>
        <div className="flex flex-col items-end justify-between">
          <div className="text-right">
            <span className="text-lg font-bold text-indigo-600">
              ${product.price.toFixed(2)}
            </span>
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="block text-xs text-gray-400 line-through">
                ${product.originalPrice.toFixed(2)}
              </span>
            )}
          </div>
          <WishlistButton
            product={{
              id: String(product.id),
              name: product.name,
              image: product.imageUrl,
              currentPrice: product.price.toFixed(2),
              merchant: product.brand,
              buyUrl: product.url,
              productUrl: product.url,
              brand: product.brand,
              apiProductId: product.id,
            }}
            className="h-auto w-auto border-0 bg-transparent p-2 shadow-none hover:bg-transparent"
          />
        </div>
      </a>
    );
  }

  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all duration-200"
    >
      <div className="relative aspect-[4/5] bg-gray-50 overflow-hidden">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-gray-300">
            📦
          </div>
        )}
        {product.badge && (
          <span className="absolute top-2 left-2 px-2 py-1 bg-indigo-600 text-white text-xs font-bold rounded">
            {product.badge}
          </span>
        )}
        {product.discountPct && product.discountPct > 0 && (
          <span className="absolute top-2 left-2 px-2 py-1 bg-red-600 text-white text-xs font-bold rounded">
            -{product.discountPct}%
          </span>
        )}
        <WishlistButton
          product={{
            id: String(product.id),
            name: product.name,
            image: product.imageUrl,
            currentPrice: product.price.toFixed(2),
            merchant: product.brand,
            buyUrl: product.url,
            productUrl: product.url,
            brand: product.brand,
            apiProductId: product.id,
          }}
          className="absolute right-2 top-2"
        />
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{product.brand}</p>
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 mb-2 group-hover:text-indigo-600 transition-colors">
          {product.name}
        </h3>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-lg font-bold text-gray-900">
            ${product.price.toFixed(2)}
          </span>
          {product.originalPrice && product.originalPrice > product.price && (
            <span className="text-sm text-gray-400 line-through">
              ${product.originalPrice.toFixed(2)}
            </span>
          )}
        </div>
        {product.rating && (
          <div className="flex items-center gap-1 mb-2">
            <StarRating rating={product.rating} />
            <span className="text-xs text-gray-500">({product.reviewCount})</span>
          </div>
        )}
        <p className={`text-xs ${product.inStock ? 'text-green-600' : 'text-red-600'}`}>
          {product.inStock ? '✓ In Stock' : 'Out of Stock'}
        </p>
      </div>
    </a>
  );
});

export default CategoryProductCard;
