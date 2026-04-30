'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { SortOption } from '@/types/category';
import styles from './SearchFilterSidebar.module.css';

interface SearchFilters {
  q: string;
  sort_by?: SortOption;
  price_min?: number;
  price_max?: number;
  category?: string;
  platform?: string;
  region?: string;
  rating?: number;
}

interface SearchFilterSidebarProps {
  filters: SearchFilters;
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

const REGIONS = [
  { value: 'all', label: 'All Regions' },
  { value: 'sg', label: 'Singapore' },
  { value: 'us', label: 'United States' },
  { value: 'sea', label: 'Southeast Asia' },
];

const PLATFORMS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'carousell', label: 'Carousell' },
  { value: 'qoo10', label: 'Qoo10' },
];

const RATING_OPTIONS = [
  { min: 4.5, label: '4.5 & up' },
  { min: 4.0, label: '4.0 & up' },
  { min: 3.5, label: '3.5 & up' },
  { min: 3.0, label: '3.0 & up' },
];

export default function SearchFilterSidebar({ filters, facets }: SearchFilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilters = useCallback(
    (updates: Partial<SearchFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('q', filters.q);

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      params.delete('offset');
      router.push(`/search?${params.toString()}`, { scroll: false });
    },
    [filters.q, router, searchParams]
  );

  const handleSortChange = (sort_by: SortOption) => {
    updateFilters({ sort_by });
  };

  const handlePriceRange = (price_min?: number, price_max?: number) => {
    const currentMin = filters.price_min;
    const currentMax = filters.price_max;
    if (currentMin === price_min && currentMax === price_max) {
      updateFilters({ price_min: undefined, price_max: undefined });
    } else {
      updateFilters({ price_min, price_max });
    }
  };

  const handleRegionChange = (region: string) => {
    updateFilters({ region: region === 'all' ? undefined : region });
  };

  const handlePlatformChange = (platform: string) => {
    const currentPlatform = filters.platform;
    if (currentPlatform === platform) {
      updateFilters({ platform: undefined });
    } else {
      updateFilters({ platform });
    }
  };

  const handleRatingChange = (rating: number) => {
    const currentRating = filters.rating;
    if (currentRating === rating) {
      updateFilters({ rating: undefined });
    } else {
      updateFilters({ rating });
    }
  };

  return (
    <aside className={styles.sidebar} aria-label="Search filters">
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Sort By</h3>
        <div className={styles.sortOptions}>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.sortButton} ${filters.sort_by === option.value ? styles.active : ''}`}
              onClick={() => handleSortChange(option.value)}
              aria-pressed={filters.sort_by === option.value}
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
              filters.price_min === range.min && filters.price_max === range.max;
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
            value={filters.price_min ?? ''}
            onChange={(e) => updateFilters({ price_min: e.target.value ? Number(e.target.value) : undefined })}
            min={0}
          />
          <span className={styles.priceSeparator}>—</span>
          <input
            type="number"
            placeholder="Max"
            className={styles.priceInput}
            value={filters.price_max ?? ''}
            onChange={(e) => updateFilters({ price_max: e.target.value ? Number(e.target.value) : undefined })}
            min={0}
          />
          <button
            type="button"
            className={styles.applyButton}
            onClick={() => updateFilters({ price_min: filters.price_min, price_max: filters.price_max })}
          >
            Go
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Region</h3>
        <div className={styles.platformOptions}>
          {REGIONS.map((region) => (
            <label key={region.value} className={styles.platformLabel}>
              <input
                type="radio"
                name="region"
                className={styles.platformRadio}
                checked={region.value === 'all' ? !filters.region : filters.region === region.value}
                onChange={() => handleRegionChange(region.value)}
              />
              <span className={styles.platformName}>{region.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Platform</h3>
        <div className={styles.platformOptions}>
          {PLATFORMS.map((platform) => (
            <label key={platform.value} className={styles.platformLabel}>
              <input
                type="checkbox"
                className={styles.platformCheckbox}
                checked={filters.platform === platform.value}
                onChange={() => handlePlatformChange(platform.value)}
              />
              <span className={styles.platformName}>{platform.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Rating</h3>
        <div className={styles.ratingOptions}>
          {RATING_OPTIONS.map((option) => (
            <button
              key={option.min}
              type="button"
              className={`${styles.ratingButton} ${filters.rating === option.min ? styles.active : ''}`}
              onClick={() => handleRatingChange(option.min)}
              aria-pressed={filters.rating === option.min}
            >
              {'★'.repeat(Math.floor(option.min))}
              <span className={styles.ratingLabel}>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      {facets && Object.keys(facets).length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Category</h3>
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