'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type FacetGroupProps = {
  label: string;
  totalCount: number;
  // Number of facet items currently selected. Drives the small count pill so the
  // user can see at-a-glance whether this group has any active filter without
  // opening it.
  selectedCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * BUY-75939: reusable accordion used by Brand and Merchant facets inside the
 * filter sidebar / bottom sheet. Renders a header row (label + total count +
 * chevron) and a body slot for facet checkboxes. The accordion state is local
 * so opening Brand does not collapse Merchant, which is how every
 * price-comparison site ships facet panels.
 *
 * `id`/`aria-controls`/`aria-expanded` are wired so screen readers announce the
 * expanded state correctly.
 */
export function FacetGroup({
  label,
  totalCount,
  selectedCount = 0,
  defaultOpen = true,
  children,
}: FacetGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = `facet-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const bodyId = `${headingId}-body`;

  return (
    <section className="border-b border-slate-200 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{label}</span>
          {selectedCount > 0 ? (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800"
              aria-label={`${selectedCount} ${label.toLowerCase()} filter${selectedCount === 1 ? '' : 's'} active`}
            >
              {selectedCount}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span>{totalCount.toLocaleString()}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {open ? (
        <div id={bodyId} role="region" aria-labelledby={headingId} className="pt-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export default FacetGroup;