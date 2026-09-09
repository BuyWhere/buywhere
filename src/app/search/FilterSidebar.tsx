'use client';

import { X } from 'lucide-react';
import { FacetGroup } from './FacetGroup';

/**
 * BUY-75939: a single facet option. Used inside FacetGroup for both Brand and
 * Merchant. Rendered as a label/checkbox pair so the click target covers the
 * full row (label + name + count).
 */
export type FacetOption = {
  value: string;
  label: string;
  // Number of products matching this facet value BEFORE the OTHER active
  // filters are applied. This is the "honest" facet count — once a Brand is
  // selected, the Merchant counts shrink to products that match BOTH. Showing
  // "unconstrained" counts (i.e. ignoring other facets) is the standard
  // comparison-site behaviour and what QA asks for.
  count: number;
};

export type FilterSidebarProps = {
  // Active filter state. The sidebar mirrors what the URL holds and the parent
  // calls these handlers to update the URL.
  selectedBrands: string[];
  selectedMerchants: string[];
  priceMin: string;
  priceMax: string;
  onToggleBrand: (brand: string) => void;
  onToggleMerchant: (merchant: string) => void;
  onPriceMinChange: (value: string) => void;
  onPriceMaxChange: (value: string) => void;
  onClearAll: () => void;
  // Facets derived from the products array. Sorted alphabetically by label so
  // ordering is stable across renders.
  brandFacets: FacetOption[];
  merchantFacets: FacetOption[];
  // Total number of products the filters apply to (used for the sidebar header
  // and to derive "X of Y" counts in the active-filter summary).
  resultCount: number;
  // The active-filter chip strip displayed at the top of the sidebar. Each
  // chip calls back into the parent to clear a single filter.
  hasActiveFilters: boolean;
  activePriceChip?: { label: string; onClear: () => void } | null;
  activeBrandChips?: Array<{ value: string; onClear: () => void }>;
  activeMerchantChips?: Array<{ value: string; onClear: () => void }>;
  // Currency prefix for the price inputs (e.g. "$" for USD, "S$" for SGD).
  // Falls back to "$" if the parent does not pass one.
  currencyPrefix?: string;
};

/**
 * BUY-75939: desktop-only filter sidebar. Visibility is controlled by the
 * parent (SearchResultsClient) — this component does NOT decide its own
 * breakpoint. Per the spec it is rendered when `md:flex` (≥1024px via Tailwind
 * `lg:` actually, but we accept whatever the parent decides and keep the
 * component pure).
 *
 * Layout: vertical, fixed-width `w-56` panel. Active-filter chips at the top,
 * price range with min/max inputs, then Brand accordion, then Merchant
 * accordion. "Clear all" button only appears when at least one filter is
 * active.
 */
export function FilterSidebar({
  selectedBrands,
  selectedMerchants,
  priceMin,
  priceMax,
  onToggleBrand,
  onToggleMerchant,
  onPriceMinChange,
  onPriceMaxChange,
  onClearAll,
  brandFacets,
  merchantFacets,
  resultCount,
  hasActiveFilters,
  activePriceChip,
  activeBrandChips = [],
  activeMerchantChips = [],
  currencyPrefix = '$',
}: FilterSidebarProps) {
  return (
    <aside
      className="w-56 shrink-0"
      aria-label="Filter search results"
      data-testid="search-filter-sidebar"
    >
      <div className="sticky top-24 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
            Filters
          </h2>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-semibold text-amber-700 transition hover:text-amber-800"
            >
              Clear all
            </button>
          ) : null}
        </div>

        {hasActiveFilters ? (
          <div className="flex flex-wrap gap-1.5 pb-1" data-testid="search-active-filters">
            {activePriceChip ? (
              <button
                type="button"
                onClick={activePriceChip.onClear}
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-200"
              >
                {activePriceChip.label}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
            {activeBrandChips.map((chip) => (
              <button
                key={`b-${chip.value}`}
                type="button"
                onClick={chip.onClear}
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-200"
              >
                {chip.value}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
            {activeMerchantChips.map((chip) => (
              <button
                key={`m-${chip.value}`}
                type="button"
                onClick={chip.onClear}
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-200"
              >
                {chip.value}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
          {/* Price range */}
          <section className="border-b border-slate-200 py-4 first:pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Price</span>
              <span className="text-xs text-slate-500">
                {resultCount.toLocaleString()} results
              </span>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Min
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    {currencyPrefix}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={priceMin}
                    onChange={(event) => onPriceMinChange(event.target.value)}
                    placeholder="0"
                    aria-label="Minimum price"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-7 pr-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                </div>
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Max
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    {currencyPrefix}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={priceMax}
                    onChange={(event) => onPriceMaxChange(event.target.value)}
                    placeholder="Any"
                    aria-label="Maximum price"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-7 pr-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  />
                </div>
              </label>
            </div>
          </section>

          <FacetGroup label="Brand" totalCount={brandFacets.length} selectedCount={selectedBrands.length}>
            {brandFacets.length === 0 ? (
              <p className="text-xs text-slate-500">No brands available.</p>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
                {brandFacets.map((facet) => {
                  const checked = selectedBrands.includes(facet.value);
                  return (
                    <li key={facet.value}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleBrand(facet.value)}
                          className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-300"
                          aria-label={`Filter by brand ${facet.label}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {facet.count.toLocaleString()}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </FacetGroup>

          <FacetGroup
            label="Merchant"
            totalCount={merchantFacets.length}
            selectedCount={selectedMerchants.length}
            defaultOpen={false}
          >
            {merchantFacets.length === 0 ? (
              <p className="text-xs text-slate-500">No merchants available.</p>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
                {merchantFacets.map((facet) => {
                  const checked = selectedMerchants.includes(facet.value);
                  return (
                    <li key={facet.value}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleMerchant(facet.value)}
                          className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-300"
                          aria-label={`Filter by merchant ${facet.label}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {facet.count.toLocaleString()}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </FacetGroup>
        </div>
      </div>
    </aside>
  );
}

export default FilterSidebar;