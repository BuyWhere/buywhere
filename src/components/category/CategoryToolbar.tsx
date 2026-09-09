'use client';

import React from 'react';

export type SortOption = 'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'rating';
export type ViewMode = 'grid' | 'list';

interface CategoryToolbarProps {
  totalResults: number;
  sortOption: SortOption;
  onSortChange: (sort: SortOption) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
  greatDealCount?: number;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top Rated' },
];

export function CategoryToolbar({
  totalResults,
  sortOption,
  onSortChange,
  viewMode,
  onViewModeChange,
  onOpenFilters,
  activeFilterCount,
  greatDealCount,
}: CategoryToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 pb-4 border-b border-gray-200">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">
          {totalResults.toLocaleString()} results
        </span>
        {greatDealCount !== undefined && greatDealCount > 0 && (
          <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM7.12 15.673A.5.5 0 017.5 15h5a.5.5 0 01.5.5v.5h.5a.5.5 0 010 1h-.5V18a.5.5 0 01-.5.5H7a.5.5 0 01-.5-.5v-.5a.5.5 0 01.5-.5h.5v-.5a.5.5 0 011 0v.5h.5a.5.5 0 010 1h-.5V18a.5.5 0 01-.5.5H7.5a.5.5 0 01-.5-.5v-.5a.5.5 0 01.5-.5h.5a.5.5 0 000-1H7a.5.5 0 01-.5-.5v-.5a.5.5 0 01.5-.5z"
                clipRule="evenodd"
              />
            </svg>
            {greatDealCount} Great Deals
          </span>
        )}
        <button
          onClick={onOpenFilters}
          className="lg:hidden flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50"
        >
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="w-5 h-5 flex items-center justify-center bg-indigo-600 text-white text-xs rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
      <div className="flex items-center gap-4">
        <select
          value={sortOption}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[160px]"
          aria-label="Sort products"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div
          className="hidden sm:flex border border-gray-200 rounded-lg overflow-hidden"
          role="tablist"
          aria-label="View mode"
        >
          <button
            onClick={() => onViewModeChange('grid')}
            role="tab"
            aria-selected={viewMode === 'grid'}
            className={`p-2 transition-colors ${
              viewMode === 'grid'
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-100'
            }`}
            aria-label="Grid view"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
              />
            </svg>
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            role="tab"
            aria-selected={viewMode === 'list'}
            className={`p-2 transition-colors ${
              viewMode === 'list'
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-100'
            }`}
            aria-label="List view"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CategoryToolbar;
