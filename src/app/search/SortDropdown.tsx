'use client';

import { ArrowDownUp } from 'lucide-react';

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'merchant_asc', label: 'Merchant A–Z' },
  { value: 'newest', label: 'Newest' },
] as const;

export type SortMode = (typeof SORT_OPTIONS)[number]['value'];

export type SortDropdownProps = {
  value: SortMode;
  onChange: (next: SortMode) => void;
  // Number of products the sort applies to. Shown as the trigger label suffix
  // (e.g. "Sort: Price: Low to High (42 results)") so users see the scope of
  // their selection without having to look back up at the H1.
  resultCount?: number;
  // Render the heading label inline ("Sort by: …") or omit it. Defaults to
  // true so the parent can place this component directly below the H1 and the
  // relationship is obvious. Pass false for the mobile bottom sheet footer.
  showLabel?: boolean;
};

export function normalizeSortMode(value: unknown): SortMode {
  if (typeof value !== 'string') return 'relevance';
  const match = SORT_OPTIONS.find((option) => option.value === value);
  return match ? match.value : 'relevance';
}

/**
 * BUY-75939: sort dropdown rendered just below the results-count H1. Standard
 * native <select> to keep things accessible (keyboard, screen reader, mobile
 * picker all work without a custom popover). The hidden chevron is replaced by
 * a lucide icon as a visual marker.
 */
export function SortDropdown({
  value,
  onChange,
  resultCount,
  showLabel = true,
}: SortDropdownProps) {
  const current = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0];
  const ariaLabel = `Sort ${typeof resultCount === 'number' ? `${resultCount} ` : ''}results by ${current.label}`;

  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
      {showLabel ? <span className="hidden sm:inline">Sort by:</span> : null}
      <span className="relative inline-flex items-center">
        <ArrowDownUp
          className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500"
          aria-hidden="true"
        />
        <select
          value={value}
          onChange={(event) => onChange(normalizeSortMode(event.target.value))}
          aria-label={ariaLabel}
          className="h-10 appearance-none rounded-full border border-slate-300 bg-white pl-9 pr-8 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 text-slate-400"
        >
          ▾
        </span>
      </span>
    </label>
  );
}

export default SortDropdown;