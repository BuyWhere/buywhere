'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { FacetGroup } from './FacetGroup';
import { SortDropdown, type SortMode } from './SortDropdown';
import type { FacetOption } from './FilterSidebar';

export type FilterBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  onClearAll: () => void;
  sortMode: SortMode;
  onSortChange: (next: SortMode) => void;
  priceMin: string;
  priceMax: string;
  onPriceMinChange: (value: string) => void;
  onPriceMaxChange: (value: string) => void;
  selectedBrands: string[];
  selectedMerchants: string[];
  onToggleBrand: (brand: string) => void;
  onToggleMerchant: (merchant: string) => void;
  brandFacets: FacetOption[];
  merchantFacets: FacetOption[];
  currencyPrefix?: string;
  resultCount: number;
  hasActiveFilters: boolean;
};

/**
 * BUY-75939: mobile (<1024px) bottom sheet housing the same controls as the
 * desktop sidebar. Built as a lightweight in-house component instead of
 * pulling in @radix-ui/react-dialog or @headlessui/dialog — keeping the site
 * bundle slim matters (the existing <SearchInputSkeleton> + <CompareFloatingBar>
 * + brand-derivation helpers have all been kept dependency-free).
 *
 * UX:
 *   - Slides up from the bottom of the viewport on mobile.
 *   - Backdrop tap closes the sheet.
 *   - Focus is moved to the "Apply filters" button on open.
 *   - Escape closes the sheet (matches the desktop search-input's Escape
 *     behavior).
 *   - Body scroll is locked while open so users do not accidentally scroll the
 *     page beneath the sheet.
 */
export function FilterBottomSheet({
  open,
  onClose,
  onApply,
  onClearAll,
  sortMode,
  onSortChange,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  selectedBrands,
  selectedMerchants,
  onToggleBrand,
  onToggleMerchant,
  brandFacets,
  merchantFacets,
  currencyPrefix = '$',
  resultCount,
  hasActiveFilters,
}: FilterBottomSheetProps) {
  const applyButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus to the Apply button on open.
    const focusTimeout = window.setTimeout(() => {
      applyButtonRef.current?.focus();
    }, 50);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(focusTimeout);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-sheet-title"
      data-testid="search-filter-sheet"
    >
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/60"
      />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="filter-sheet-title" className="text-lg font-semibold text-slate-900">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
              Sort
            </span>
            <SortDropdown
              value={sortMode}
              onChange={onSortChange}
              resultCount={resultCount}
              showLabel={false}
            />
          </div>

          <section className="border-b border-slate-200 pb-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-600">
                Price
              </span>
              <span className="text-xs text-slate-500">
                {resultCount.toLocaleString()} results
              </span>
            </div>
            <div className="flex items-end gap-3">
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
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-7 pr-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
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
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-7 pr-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                  />
                </div>
              </label>
            </div>
          </section>

          <FacetGroup label="Brand" totalCount={brandFacets.length} selectedCount={selectedBrands.length}>
            {brandFacets.length === 0 ? (
              <p className="text-xs text-slate-500">No brands available.</p>
            ) : (
              <ul className="space-y-1">
                {brandFacets.map((facet) => {
                  const checked = selectedBrands.includes(facet.value);
                  return (
                    <li key={facet.value}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50">
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
            defaultOpen
          >
            {merchantFacets.length === 0 ? (
              <p className="text-xs text-slate-500">No merchants available.</p>
            ) : (
              <ul className="space-y-1">
                {merchantFacets.map((facet) => {
                  const checked = selectedMerchants.includes(facet.value);
                  return (
                    <li key={facet.value}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50">
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

        <footer className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-3">
          <button
            type="button"
            onClick={onClearAll}
            disabled={!hasActiveFilters}
            className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            ref={applyButtonRef}
            type="button"
            onClick={onApply}
            className="ml-auto inline-flex min-h-11 items-center rounded-full bg-amber-600 px-5 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            Apply filters
          </button>
        </footer>
      </div>
    </div>
  );
}

export default FilterBottomSheet;