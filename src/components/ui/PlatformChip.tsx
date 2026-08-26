import React from 'react';

/**
 * PlatformChip — secondary, smaller provenance line below MerchantBadge.
 * BUY-74691: visually subordinate to the merchant name so the platform
 * (Shopify, Shopee SG, etc.) is still visible but not the primary signal.
 *
 * Renders `via <Platform>` in slate-500 monochrome text. Hidden on tight
 * mobile breakpoints via `hidden sm:inline` to avoid breaking card layout.
 *
 * If no platform is provided, renders nothing (do not show an empty chip).
 */
export interface PlatformChipProps {
  source?: string | null;
  className?: string;
}

export function PlatformChip({ source, className = '' }: PlatformChipProps) {
  const label = (source ?? '').trim();
  if (!label) return null;

  return (
    <span
      className={`hidden sm:inline text-[11px] leading-tight text-slate-500 ${className}`}
      data-testid="platform-chip"
    >
      via {label}
    </span>
  );
}

export default PlatformChip;
