'use client';

import React, { useState, useEffect, useRef, memo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCompare } from '@/lib/compare-context';

export const CompareFloatingBar = memo(function CompareFloatingBar() {
  const { compareList, compareCount, clearCompare } = useCompare();
  const [isVisible, setIsVisible] = useState(false);
  const prevCountRef = useRef(compareCount);
  const navigate = useRouter();

  useEffect(() => {
    if (compareCount > 0) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [compareCount]);

  useEffect(() => {
    prevCountRef.current = compareCount;
  }, [compareCount]);

  const handleCompare = () => {
    if (compareCount < 2) return;
    const ids = compareList.map((p) => p.id).join(',');
    navigate.push(`/compare?ids=${ids}`);
  };

  if (compareCount === 0 || !isVisible) {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden transition-transform duration-300 ease-out translate-y-0"
      role="region"
      aria-label="Compare products"
    >
      <div className="bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-between px-4 py-3 gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className={`flex items-center justify-center w-11 h-11 rounded-full font-bold text-lg transition-all min-w-[44px] min-h-[44px] ${
                compareCount === 4
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-indigo-100 text-indigo-600'
              }`}
            >
              {compareCount}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {compareCount === 1
                  ? '1 product selected'
                  : compareCount === 4
                    ? 'Compare ready!'
                    : `${compareCount} products selected`}
              </p>
              <p className="text-xs text-gray-500">
                {compareCount === 4 ? 'Tap Compare to start' : 'Add up to 4 products'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={clearCompare}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 touch-manipulation"
              aria-label="Clear compare list"
            >
              Clear
            </button>
            <button
              onClick={handleCompare}
              disabled={compareCount < 2}
              className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center touch-manipulation active:scale-95 ${
                compareCount >= 2
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                  : 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
              }`}
              aria-disabled={compareCount < 2}
            >
              Compare
            </button>
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
          {compareList.map((product, index) => (
            <div
              key={product.id}
              className="flex-shrink-0 w-14 h-14 rounded-xl bg-gray-100 overflow-hidden relative shadow-sm"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {product.image ? (
                <Image
                  src={product.image}
                  alt={product.name}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl">
                  🛍️
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 4 - compareCount) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex-shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50/50"
            >
              <span className="text-gray-300 text-lg">+</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
    </div>
  );
});

export default CompareFloatingBar;
