'use client';

import React from 'react';

export interface FacetOption {
  value: string;
  count: number;
  hex?: string;
}

export interface FilterFacets {
  brands: FacetOption[];
  priceRanges: { range: string; min: number; max: number; count: number }[];
  colors: FacetOption[];
  sizes: { code: string; count: number; available: boolean }[];
  availability: FacetOption[];
  regions: FacetOption[];
}

export interface ActiveFilters {
  brands: string[];
  priceMin?: number;
  priceMax?: number;
  colors: string[];
  sizes: string[];
  inStockOnly: boolean;
  regions: string[];
  greatDealsOnly: boolean;
}

interface FilterRailProps {
  facets: FilterFacets;
  activeFilters: ActiveFilters;
  onFilterChange: (filters: ActiveFilters) => void;
  onClearAll: () => void;
  greatDealCount?: number;
}

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
}

function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function CheckboxFilter({
  options,
  selected,
  onChange,
}: {
  options: FacetOption[];
  selected: string[];
  onChange: (value: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(e) => onChange(option.value, e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="flex-1 text-sm text-gray-600 group-hover:text-gray-900">
            {option.value}
          </span>
          <span className="text-xs text-gray-400">({option.count})</span>
        </label>
      ))}
    </div>
  );
}

function PriceRangeFilter({
  min,
  max,
  onChange,
}: {
  min?: number;
  max?: number;
  onChange: (min?: number, max?: number) => void;
}) {
  const [localMin, setLocalMin] = React.useState(min?.toString() ?? '');
  const [localMax, setLocalMax] = React.useState(max?.toString() ?? '');

  const handleApply = () => {
    onChange(
      localMin ? parseInt(localMin, 10) : undefined,
      localMax ? parseInt(localMax, 10) : undefined
    );
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={localMin}
          onChange={(e) => setLocalMin(e.target.value)}
          placeholder="Min"
          className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-gray-400">—</span>
        <input
          type="text"
          value={localMax}
          onChange={(e) => setLocalMax(e.target.value)}
          placeholder="Max"
          className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <button
        onClick={handleApply}
        className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
      >
        Apply
      </button>
    </div>
  );
}

function ColorSwatchFilter({
  colors,
  selected,
  onChange,
}: {
  colors: FacetOption[];
  selected: string[];
  onChange: (color: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color.value}
            onClick={() => onChange(color.value)}
            className={`w-7 h-7 rounded-full border ${
              selected.includes(color.value)
                ? 'ring-2 ring-offset-2 ring-indigo-600'
                : 'border-gray-200 hover:scale-110'
            }`}
            style={{ backgroundColor: color.hex }}
            title={color.value}
            aria-label={color.value}
          />
        ))}
      </div>
      {selected.length > 0 && (
        <button
          onClick={() => selected.forEach((c) => onChange(c))}
          className="mt-2 text-xs text-indigo-600 hover:text-indigo-700"
        >
          Clear color
        </button>
      )}
    </div>
  );
}

function SizeChipFilter({
  sizes,
  selected,
  onChange,
}: {
  sizes: { code: string; count: number; available: boolean }[];
  selected: string[];
  onChange: (code: string, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {sizes.map((size) => (
        <button
          key={size.code}
          onClick={() => !size.available || onChange(size.code, !selected.includes(size.code))}
          disabled={!size.available}
          className={`min-w-[40px] px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            selected.includes(size.code)
              ? 'bg-gray-900 text-white border-gray-900'
              : size.available
              ? 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-900'
              : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed opacity-50'
          }`}
          title={!size.available ? 'Out of stock' : undefined}
        >
          {size.code}
        </button>
      ))}
    </div>
  );
}

function AvailabilityFilter({
  inStockOnly,
  onChange,
}: {
  inStockOnly: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={inStockOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm text-gray-600">In Stock Only</span>
    </label>
  );
}

function GreatDealsFilter({
  greatDealsOnly,
  onChange,
  greatDealCount,
}: {
  greatDealsOnly: boolean;
  onChange: (value: boolean) => void;
  greatDealCount: number;
}) {
  if (greatDealCount === 0) return null;
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={greatDealsOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm text-gray-600">
        Great Deals only
        <span className="ml-1.5 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
          {greatDealCount}
        </span>
      </span>
    </label>
  );
}

export function FilterRail({
  facets,
  activeFilters,
  onFilterChange,
  onClearAll,
  greatDealCount = 0,
}: FilterRailProps) {
  const hasActiveFilters =
    activeFilters.brands.length > 0 ||
    activeFilters.priceMin !== undefined ||
    activeFilters.priceMax !== undefined ||
    activeFilters.colors.length > 0 ||
    activeFilters.sizes.length > 0 ||
    activeFilters.inStockOnly ||
    activeFilters.regions.length > 0 ||
    activeFilters.greatDealsOnly;

  const handleBrandChange = (value: string, checked: boolean) => {
    onFilterChange({
      ...activeFilters,
      brands: checked
        ? [...activeFilters.brands, value]
        : activeFilters.brands.filter((b) => b !== value),
    });
  };

  const handlePriceChange = (min?: number, max?: number) => {
    onFilterChange({
      ...activeFilters,
      priceMin: min,
      priceMax: max,
    });
  };

  const handleColorChange = (color: string) => {
    onFilterChange({
      ...activeFilters,
      colors: activeFilters.colors.includes(color)
        ? activeFilters.colors.filter((c) => c !== color)
        : [...activeFilters.colors, color],
    });
  };

  const handleSizeChange = (code: string, checked: boolean) => {
    onFilterChange({
      ...activeFilters,
      sizes: checked
        ? [...activeFilters.sizes, code]
        : activeFilters.sizes.filter((s) => s !== code),
    });
  };

  const handleRegionChange = (value: string, checked: boolean) => {
    onFilterChange({
      ...activeFilters,
      regions: checked
        ? [...activeFilters.regions, value]
        : activeFilters.regions.filter((r) => r !== value),
    });
  };

  return (
    <aside className="w-[280px] flex-shrink-0 bg-white border-r border-gray-200 p-5 sticky top-0 h-[calc(100vh-140px)] overflow-y-auto">
      {hasActiveFilters && (
        <button
          onClick={onClearAll}
          className="text-sm text-indigo-600 hover:text-indigo-700 underline mb-5"
        >
          Clear all filters
        </button>
      )}

      {facets.brands.length > 0 && (
        <FilterSection title="Brand">
          <CheckboxFilter
            options={facets.brands}
            selected={activeFilters.brands}
            onChange={handleBrandChange}
          />
        </FilterSection>
      )}

      <FilterSection title="Price Range">
        <PriceRangeFilter
          min={activeFilters.priceMin}
          max={activeFilters.priceMax}
          onChange={handlePriceChange}
        />
      </FilterSection>

      {facets.sizes.length > 0 && (
        <FilterSection title="Size">
          <SizeChipFilter
            sizes={facets.sizes}
            selected={activeFilters.sizes}
            onChange={handleSizeChange}
          />
        </FilterSection>
      )}

      {facets.colors.length > 0 && (
        <FilterSection title="Color">
          <ColorSwatchFilter
            colors={facets.colors}
            selected={activeFilters.colors}
            onChange={handleColorChange}
          />
        </FilterSection>
      )}

      <FilterSection title="Availability">
        <AvailabilityFilter
          inStockOnly={activeFilters.inStockOnly}
          onChange={(checked) =>
            onFilterChange({ ...activeFilters, inStockOnly: checked })
          }
        />
      </FilterSection>

      {greatDealCount > 0 && (
        <FilterSection title="Deal Score">
          <GreatDealsFilter
            greatDealsOnly={activeFilters.greatDealsOnly}
            onChange={(checked) =>
              onFilterChange({ ...activeFilters, greatDealsOnly: checked })
            }
            greatDealCount={greatDealCount}
          />
        </FilterSection>
      )}

      {facets.regions.length > 0 && (
        <FilterSection title="Region">
          <CheckboxFilter
            options={facets.regions}
            selected={activeFilters.regions}
            onChange={handleRegionChange}
          />
        </FilterSection>
      )}
    </aside>
  );
}

export default FilterRail;
