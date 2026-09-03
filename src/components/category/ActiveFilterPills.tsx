'use client';

import React from 'react';
import { ActiveFilters } from './FilterRail';

interface ActiveFilterPillsProps {
  activeFilters: ActiveFilters;
  onRemove: (key: keyof ActiveFilters, value?: string) => void;
  onClearAll: () => void;
}

export function ActiveFilterPills({ activeFilters, onRemove, onClearAll }: ActiveFilterPillsProps) {
  const pills: { label: string; onRemove: () => void }[] = [];

  activeFilters.brands.forEach((brand) => {
    pills.push({
      label: brand,
      onRemove: () => onRemove('brands', brand),
    });
  });

  if (activeFilters.priceMin !== undefined || activeFilters.priceMax !== undefined) {
    const label =
      activeFilters.priceMin !== undefined && activeFilters.priceMax !== undefined
        ? `$${activeFilters.priceMin} - $${activeFilters.priceMax}`
        : activeFilters.priceMin !== undefined
        ? `Min $${activeFilters.priceMin}`
        : `Max $${activeFilters.priceMax}`;
    pills.push({
      label,
      onRemove: () => onRemove('priceMin'),
    });
  }

  activeFilters.colors.forEach((color) => {
    pills.push({
      label: color,
      onRemove: () => onRemove('colors', color),
    });
  });

  activeFilters.sizes.forEach((size) => {
    pills.push({
      label: size,
      onRemove: () => onRemove('sizes', size),
    });
  });

  if (activeFilters.inStockOnly) {
    pills.push({
      label: 'In Stock',
      onRemove: () => onRemove('inStockOnly'),
    });
  }

  activeFilters.regions.forEach((region) => {
    pills.push({
      label: region,
      onRemove: () => onRemove('regions', region),
    });
  });

  if (activeFilters.greatDealsOnly) {
    pills.push({
      label: 'Great Deals only',
      onRemove: () => onRemove('greatDealsOnly'),
    });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {pills.map((pill, index) => (
        <button
          key={`${pill.label}-${index}`}
          onClick={pill.onRemove}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full hover:bg-gray-200 transition-colors"
        >
          {pill.label}
          <span className="text-gray-400" aria-hidden="true">
            ✕
          </span>
        </button>
      ))}
      {pills.length > 1 && (
        <button
          onClick={onClearAll}
          className="px-3 py-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export default ActiveFilterPills;
