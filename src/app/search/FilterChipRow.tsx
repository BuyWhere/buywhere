'use client';

import { X, SlidersHorizontal } from 'lucide-react';

export type FilterChipRowProps = {
  totalActiveFilterCount: number;
  onOpenFilters: () => void;
  onClearAll: () => void;
  activePriceChipLabel?: string | null;
  onClearPrice?: () => void;
  activeBrandChips?: Array<{ value: string; onClear: () => void }>;
  activeMerchantChips?: Array<{ value: string; onClear: () => void }>;
};

/**
 * BUY-75939: mobile-only (<1024px) chip strip showing a Filters trigger and
 * any active filter chips. Rendered as a horizontally-scrollable row so a long
 * list of active filters never wraps and breaks the 390px overflow guarantee.
 *
 * Visual: a single row of chips inside a `flex gap-2 overflow-x-auto` wrapper
 * with `scrollbar-none` to hide the scrollbar on mobile. Hidden on lg+ because
 * the desktop sidebar already covers the same controls.
 */
export function FilterChipRow({
  totalActiveFilterCount,
  onOpenFilters,
  onClearAll,
  activePriceChipLabel,
  onClearPrice,
  activeBrandChips = [],
  activeMerchantChips = [],
}: FilterChipRowProps) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [&::-webkit-scrollbar]:hidden"
      data-testid="search-filter-chip-row"
      style={{ scrollbarWidth: 'none' }}
    >
      <button
        type="button"
        onClick={onOpenFilters}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm transition hover:border-amber-300 hover:bg-amber-50"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filters
        {totalActiveFilterCount > 0 ? (
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 text-[11px] font-semibold text-white">
            {totalActiveFilterCount}
          </span>
        ) : null}
      </button>

      {activePriceChipLabel ? (
        <button
          type="button"
          onClick={onClearPrice}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-200"
        >
          {activePriceChipLabel}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}

      {activeBrandChips.map((chip) => (
        <button
          key={`b-${chip.value}`}
          type="button"
          onClick={chip.onClear}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-200"
        >
          {chip.value}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}

      {activeMerchantChips.map((chip) => (
        <button
          key={`m-${chip.value}`}
          type="button"
          onClick={chip.onClear}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-200"
        >
          {chip.value}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}

      {totalActiveFilterCount > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="shrink-0 rounded-full px-2 py-1.5 text-sm font-medium text-amber-700 underline-offset-2 hover:underline"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

export default FilterChipRow;