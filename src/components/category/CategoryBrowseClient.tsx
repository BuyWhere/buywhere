'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilterRail, FilterFacets, ActiveFilters } from './FilterRail';
import { FilterBottomSheet } from './FilterBottomSheet';
import { ActiveFilterPills } from './ActiveFilterPills';
import { CategoryProductCard, BrowseProduct } from './CategoryProductCard';
import { CategoryToolbar, SortOption, ViewMode } from './CategoryToolbar';
import { CategoryHero } from './CategoryHero';
import { SubcategoryNav } from './SubcategoryNav';

export interface Subcategory {
  id: string;
  name: string;
  productCount?: number;
}

export interface CategoryPageConfig {
  categoryName: string;
  breadcrumbs: { name: string; href?: string }[];
  subcategories: Subcategory[];
  products: BrowseProduct[];
  facets: FilterFacets;
  totalProducts: number;
}

interface CategoryBrowseClientProps {
  config: CategoryPageConfig;
}

function applyFilters(products: BrowseProduct[], filters: ActiveFilters): BrowseProduct[] {
  return products.filter((product) => {
    if (filters.brands.length > 0 && !filters.brands.includes(product.brand)) {
      return false;
    }

    if (filters.priceMin !== undefined && product.price < filters.priceMin) {
      return false;
    }

    if (filters.priceMax !== undefined && product.price > filters.priceMax) {
      return false;
    }

    if (filters.colors.length > 0) {
      const productColors = product.colors?.map((c) => c.name) ?? [];
      if (!filters.colors.some((c) => productColors.includes(c))) {
        return false;
      }
    }

    if (filters.sizes.length > 0) {
      const availableSizes = product.sizes?.filter((s) => s.available).map((s) => s.code) ?? [];
      if (!filters.sizes.some((s) => availableSizes.includes(s))) {
        return false;
      }
    }

    if (filters.inStockOnly && !product.inStock) {
      return false;
    }

    if (filters.regions.length > 0) {
      return true;
    }

    if (filters.greatDealsOnly && (!product.discountPct || product.discountPct <= 20)) {
      return false;
    }

    return true;
  });
}

function sortProducts(products: BrowseProduct[], sort: SortOption): BrowseProduct[] {
  const sorted = [...products];
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return sorted.sort((a, b) => b.price - a.price);
    case 'newest':
      return sorted;
    case 'rating':
      return sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    case 'relevance':
    default:
      return sorted;
  }
}

function countActiveFilters(filters: ActiveFilters): number {
  return (
    filters.brands.length +
    filters.colors.length +
    filters.sizes.length +
    (filters.inStockOnly ? 1 : 0) +
    filters.regions.length +
    (filters.priceMin !== undefined || filters.priceMax !== undefined ? 1 : 0) +
    (filters.greatDealsOnly ? 1 : 0)
  );
}

const DEFAULT_FILTERS: ActiveFilters = {
  brands: [],
  colors: [],
  sizes: [],
  inStockOnly: false,
  regions: [],
  greatDealsOnly: false,
};

export function CategoryBrowseClient({ config }: CategoryBrowseClientProps) {
  const searchParams = useSearchParams();
  const [selectedSubcategory, setSelectedSubcategory] = useState('all');
  const [filters, setFilters] = useState<ActiveFilters>({
    ...DEFAULT_FILTERS,
    greatDealsOnly: searchParams?.get('deals') === 'great',
  });
  const [sortOption, setSortOption] = useState<SortOption>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  const greatDealCount = useMemo(
    () => config.products.filter((p) => p.discountPct && p.discountPct > 20).length,
    [config.products]
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const filteredProducts = useMemo(() => {
    let result = config.products;
    if (selectedSubcategory !== 'all') {
      result = result.filter((p) => p.name.toLowerCase().includes(selectedSubcategory));
    }
    result = applyFilters(result, filters);
    result = sortProducts(result, sortOption);
    return result;
  }, [config.products, selectedSubcategory, filters, sortOption]);

  useEffect(() => {
    if (!searchParams) return;
    const dealsParam = searchParams.get('deals');
    setFilters((prev) => ({
      ...prev,
      greatDealsOnly: dealsParam === 'great',
    }));
  }, [searchParams]);

  const handleFilterChange = useCallback((newFilters: ActiveFilters) => {
    setFilters(newFilters);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const handleRemoveFilter = useCallback(
    (key: keyof ActiveFilters, value?: string) => {
      setFilters((prev) => {
        const newFilters = { ...prev };
        switch (key) {
          case 'brands':
            newFilters.brands = value ? prev.brands.filter((b) => b !== value) : [];
            break;
          case 'colors':
            newFilters.colors = value ? prev.colors.filter((c) => c !== value) : [];
            break;
          case 'sizes':
            newFilters.sizes = value ? prev.sizes.filter((s) => s !== value) : [];
            break;
          case 'priceMin':
            newFilters.priceMin = undefined;
            newFilters.priceMax = undefined;
            break;
          case 'inStockOnly':
            newFilters.inStockOnly = false;
            break;
          case 'regions':
            newFilters.regions = value ? prev.regions.filter((r) => r !== value) : [];
            break;
          case 'greatDealsOnly':
            newFilters.greatDealsOnly = false;
            break;
        }
        return newFilters;
      });
    },
    []
  );

  const allSubcategories = useMemo(
    () => [
      { id: 'all', name: 'All', productCount: config.totalProducts },
      ...config.subcategories,
    ],
    [config.subcategories, config.totalProducts]
  );

  return (
    <div className="min-h-[60vh]">
      <CategoryHero
        breadcrumbs={config.breadcrumbs}
        title={config.categoryName}
        totalProducts={filteredProducts.length}
      />

      <SubcategoryNav
        subcategories={allSubcategories}
        selectedId={selectedSubcategory}
        onSelect={setSelectedSubcategory}
      />

      <div className="flex">
        <FilterRail
          facets={config.facets}
          activeFilters={filters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAllFilters}
          greatDealCount={greatDealCount}
        />

        <main className="flex-1 p-5 min-w-0">
          <div className="hidden lg:block">
            <CategoryToolbar
              totalResults={filteredProducts.length}
              sortOption={sortOption}
              onSortChange={setSortOption}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOpenFilters={() => setIsMobileFilterOpen(true)}
              activeFilterCount={activeFilterCount}
              greatDealCount={greatDealCount}
            />
          </div>

          <div className="lg:hidden mb-4">
            <CategoryToolbar
              totalResults={filteredProducts.length}
              sortOption={sortOption}
              onSortChange={setSortOption}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOpenFilters={() => setIsMobileFilterOpen(true)}
              activeFilterCount={activeFilterCount}
              greatDealCount={greatDealCount}
            />
          </div>

          <ActiveFilterPills
            activeFilters={filters}
            onRemove={handleRemoveFilter}
            onClearAll={handleClearAllFilters}
          />

          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg
                className="w-16 h-16 text-gray-300 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No products found</h2>
              <p className="text-gray-600 mb-6">
                Try adjusting your filters or search terms to find what you&apos;re looking for.
              </p>
              <button
                onClick={handleClearAllFilters}
                className="px-5 py-2.5 border border-indigo-600 text-indigo-600 font-medium rounded-lg hover:bg-indigo-50 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredProducts.map((product) => (
                <CategoryProductCard key={product.id} product={product} viewMode="grid" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredProducts.map((product) => (
                <CategoryProductCard key={product.id} product={product} viewMode="list" />
              ))}
            </div>
          )}
        </main>
      </div>

      <FilterBottomSheet
        isOpen={isMobileFilterOpen}
        onClose={() => setIsMobileFilterOpen(false)}
        facets={config.facets}
        activeFilters={filters}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAllFilters}
        greatDealCount={greatDealCount}
      />
    </div>
  );
}

export default CategoryBrowseClient;
