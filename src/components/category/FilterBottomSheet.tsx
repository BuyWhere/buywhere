'use client';

import React from 'react';
import { FilterFacets, ActiveFilters } from './FilterRail';

interface FilterBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  facets: FilterFacets;
  activeFilters: ActiveFilters;
  onFilterChange: (filters: ActiveFilters) => void;
  onClearAll: () => void;
  greatDealCount?: number;
}

export function FilterBottomSheet({
  isOpen,
  onClose,
  facets,
  activeFilters,
  onFilterChange,
  onClearAll,
  greatDealCount,
}: FilterBottomSheetProps) {
  if (!isOpen) return null;

  const hasActiveFilters =
    activeFilters.brands.length > 0 ||
    activeFilters.priceMin !== undefined ||
    activeFilters.priceMax !== undefined ||
    activeFilters.colors.length > 0 ||
    activeFilters.sizes.length > 0 ||
    activeFilters.inStockOnly ||
    activeFilters.regions.length > 0 ||
    activeFilters.greatDealsOnly;

  const activeFilterCount =
    activeFilters.brands.length +
    activeFilters.colors.length +
    activeFilters.sizes.length +
    (activeFilters.inStockOnly ? 1 : 0) +
    activeFilters.regions.length +
    (activeFilters.priceMin !== undefined || activeFilters.priceMax !== undefined ? 1 : 0) +
    (activeFilters.greatDealsOnly ? 1 : 0);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 max-h-[80vh] overflow-y-auto lg:hidden">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">Filters</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
            aria-label="Close filters"
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          {hasActiveFilters && (
            <div className="mb-4">
              <button
                onClick={() => {
                  onClearAll();
                  onClose();
                }}
                className="text-sm text-indigo-600 hover:text-indigo-700 underline"
              >
                Clear all filters ({activeFilterCount})
              </button>
            </div>
          )}

          {facets.brands.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
                Brand
              </h3>
              <div className="space-y-2">
                {facets.brands.map((brand) => (
                  <label key={brand.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeFilters.brands.includes(brand.value)}
                      onChange={(e) => {
                        onFilterChange({
                          ...activeFilters,
                          brands: e.target.checked
                            ? [...activeFilters.brands, brand.value]
                            : activeFilters.brands.filter((b) => b !== brand.value),
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="flex-1 text-sm text-gray-600">{brand.value}</span>
                    <span className="text-xs text-gray-400">({brand.count})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              Price Range
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeFilters.priceMin?.toString() ?? ''}
                onChange={(e) =>
                  onFilterChange({
                    ...activeFilters,
                    priceMin: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                placeholder="Min"
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-gray-400">—</span>
              <input
                type="text"
                value={activeFilters.priceMax?.toString() ?? ''}
                onChange={(e) =>
                  onFilterChange({
                    ...activeFilters,
                    priceMax: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                placeholder="Max"
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {facets.sizes.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
                Size
              </h3>
              <div className="flex flex-wrap gap-2">
                {facets.sizes.map((size) => (
                  <button
                    key={size.code}
                    onClick={() =>
                      !size.available ||
                      onFilterChange({
                        ...activeFilters,
                        sizes: activeFilters.sizes.includes(size.code)
                          ? activeFilters.sizes.filter((s) => s !== size.code)
                          : [...activeFilters.sizes, size.code],
                      })
                    }
                    disabled={!size.available}
                    className={`min-w-[40px] px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                      activeFilters.sizes.includes(size.code)
                        ? 'bg-gray-900 text-white border-gray-900'
                        : size.available
                        ? 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-900'
                        : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed opacity-50'
                    }`}
                  >
                    {size.code}
                  </button>
                ))}
              </div>
            </div>
          )}

          {facets.colors.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
                Color
              </h3>
              <div className="flex flex-wrap gap-2">
                {facets.colors.map((color) => (
                  <button
                    key={color.value}
                    onClick={() =>
                      onFilterChange({
                        ...activeFilters,
                        colors: activeFilters.colors.includes(color.value)
                          ? activeFilters.colors.filter((c) => c !== color.value)
                          : [...activeFilters.colors, color.value],
                      })
                    }
                    className={`w-7 h-7 rounded-full border ${
                      activeFilters.colors.includes(color.value)
                        ? 'ring-2 ring-offset-2 ring-indigo-600'
                        : 'border-gray-200 hover:scale-110'
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.value}
                    aria-label={color.value}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mb-5">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              Availability
            </h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activeFilters.inStockOnly}
                onChange={(e) =>
                  onFilterChange({ ...activeFilters, inStockOnly: e.target.checked })
                }
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-600">In Stock Only</span>
            </label>
          </div>

          {greatDealCount !== undefined && greatDealCount > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
                Deal Score
              </h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeFilters.greatDealsOnly}
                  onChange={(e) =>
                    onFilterChange({ ...activeFilters, greatDealsOnly: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-600">
                  Great Deals only
                  <span className="ml-1.5 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                    {greatDealCount}
                  </span>
                </span>
              </label>
            </div>
          )}

          {facets.regions.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
                Region
              </h3>
              <div className="space-y-2">
                {facets.regions.map((region) => (
                  <label key={region.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeFilters.regions.includes(region.value)}
                      onChange={(e) => {
                        onFilterChange({
                          ...activeFilters,
                          regions: e.target.checked
                            ? [...activeFilters.regions, region.value]
                            : activeFilters.regions.filter((r) => r !== region.value),
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="flex-1 text-sm text-gray-600">{region.value}</span>
                    <span className="text-xs text-gray-400">({region.count})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4">
          <button
            onClick={onClose}
            className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Show results
          </button>
        </div>
      </div>
    </>
  );
}

export default FilterBottomSheet;
