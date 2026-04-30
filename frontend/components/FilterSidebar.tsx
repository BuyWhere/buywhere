'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { FilterState, SortOption } from '@/types/category';
import styles from './FilterSidebar.module.css';

interface FilterSidebarProps {
  category: string;
  currentFilters: FilterState;
  facets?: Record<string, Array<{ value: string; label: string; count: number }>>;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
];

const PRICE_RANGES = [
  { min: undefined, max: 50, label: 'Under S$50' },
  { min: 50, max: 100, label: 'S$50 - S$100' },
  { min: 100, max: 250, label: 'S$100 - S$250' },
  { min: 250, max: 500, label: 'S$250 - S$500' },
  { min: 500, max: undefined, label: 'S$500+' },
];

export default function FilterSidebar({ category, currentFilters, facets }: FilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilters = useCallback(
    (updates: Partial<FilterState>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('category', category);

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      params.delete('offset');
      router.push(`/category/${category}?${params.toString()}`, { scroll: false });
    },
    [category, router, searchParams]
  );

  const handleSortChange = (sort_by: SortOption) => {
    updateFilters({ sort_by });
  };

  const handlePriceRange = (price_min?: number, price_max?: number) => {
    const currentMin = currentFilters.price_min;
    const currentMax = currentFilters.price_max;
    if (currentMin === price_min && currentMax === price_max) {
      updateFilters({ price_min: undefined, price_max: undefined });
    } else {
      updateFilters({ price_min, price_max });
    }
  };

  return (
    <aside className={styles.sidebar} aria-label="Product filters">
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Sort By</h3>
        <div className={styles.sortOptions}>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.sortButton} ${currentFilters.sort_by === option.value ? styles.active : ''}`}
              onClick={() => handleSortChange(option.value)}
              aria-pressed={currentFilters.sort_by === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Price Range</h3>
        <div className={styles.priceRanges}>
          {PRICE_RANGES.map((range) => {
            const isActive =
              currentFilters.price_min === range.min && currentFilters.price_max === range.max;
            return (
              <button
                key={range.label}
                type="button"
                className={`${styles.priceButton} ${isActive ? styles.active : ''}`}
                onClick={() => handlePriceRange(range.min, range.max)}
                aria-pressed={isActive}
              >
                {range.label}
              </button>
            );
          })}
        </div>
        <div className={styles.customPrice}>
          <input
            type="number"
            placeholder="Min"
            className={styles.priceInput}
            value={currentFilters.price_min ?? ''}
            onChange={(e) => updateFilters({ price_min: e.target.value ? Number(e.target.value) : undefined })}
            min={0}
          />
          <span className={styles.priceSeparator}>—</span>
          <input
            type="number"
            placeholder="Max"
            className={styles.priceInput}
            value={currentFilters.price_max ?? ''}
            onChange={(e) => updateFilters({ price_max: e.target.value ? Number(e.target.value) : undefined })}
            min={0}
          />
          <button
            type="button"
            className={styles.applyButton}
            onClick={() => updateFilters({ price_min: currentFilters.price_min, price_max: currentFilters.price_max })}
          >
            Go
          </button>
        </div>
      </section>

      {facets && Object.keys(facets).length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Filters</h3>
          {Object.entries(facets).map(([facetName, buckets]) => (
            <div key={facetName} className={styles.facetGroup}>
              <h4 className={styles.facetTitle}>{facetName}</h4>
              <div className={styles.facetOptions}>
                {buckets.map((bucket) => (
                  <label key={bucket.value} className={styles.facetLabel}>
                    <input
                      type="checkbox"
                      className={styles.facetCheckbox}
                      defaultChecked={searchParams.get(facetName) === bucket.value}
                      onChange={() => {}}
                    />
                    <span className={styles.facetName}>{bucket.label}</span>
                    <span className={styles.facetCount}>({bucket.count})</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}