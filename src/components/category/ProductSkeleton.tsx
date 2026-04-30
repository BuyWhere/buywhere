'use client';

import React from 'react';

interface ProductSkeletonProps {
  viewMode: 'grid' | 'list';
}

export function ProductSkeleton({ viewMode }: ProductSkeletonProps) {
  if (viewMode === 'list') {
    return (
      <div className="flex gap-4 p-3 bg-white border border-gray-200 rounded-lg animate-pulse">
        <div className="w-20 h-24 bg-gray-200 rounded" />
        <div className="flex-1">
          <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-3/4 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-24 bg-gray-200 rounded" />
        </div>
        <div className="flex flex-col items-end justify-between">
          <div className="h-5 w-16 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden animate-pulse">
      <div className="aspect-[4/5] bg-gray-200" />
      <div className="p-3">
        <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
        <div className="h-4 w-full bg-gray-200 rounded mb-2" />
        <div className="h-4 w-2/3 bg-gray-200 rounded mb-3" />
        <div className="h-5 w-20 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

export function CategoryPageSkeleton() {
  return (
    <div className="min-h-[60vh]">
      <div className="bg-gradient-to-b from-white to-gray-50 py-8 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-4 w-64 bg-gray-200 rounded mb-3" />
          <div className="h-8 w-48 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="bg-white border-b border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 w-24 bg-gray-200 rounded-full animate-pulse" />
            ))}
          </div>
        </div>
      </div>
      <div className="flex">
        <aside className="w-[280px] flex-shrink-0 bg-white border-r border-gray-200 p-5 h-[calc(100vh-300px)]">
          <div className="space-y-5">
            <div className="h-4 w-20 bg-gray-200 rounded" />
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-4 w-full bg-gray-200 rounded animate-pulse" />
              ))}
            </div>
          </div>
        </aside>
        <main className="flex-1 p-5">
          <div className="flex justify-between items-center mb-5 pb-4 border-b border-gray-200">
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="flex gap-3">
              <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
              <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductSkeleton key={i} viewMode="grid" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default ProductSkeleton;
