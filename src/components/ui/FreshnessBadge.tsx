import React from 'react';
import {
  DataFreshness,
  getFreshnessTier,
  getFreshnessColor,
  getFreshnessLabel,
} from '@/lib/freshness';

export interface FreshnessBadgeProps {
  lastUpdated?: string;
  freshness?: DataFreshness;
  className?: string;
}

export function FreshnessBadge({ lastUpdated, freshness, className = '' }: FreshnessBadgeProps) {
  const computedFreshness = freshness ?? (lastUpdated ? getFreshnessTier(lastUpdated) : null);

  if (!computedFreshness) return null;

  const colors = getFreshnessColor(computedFreshness);
  const label = getFreshnessLabel(computedFreshness);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${colors.bg} ${colors.text} text-xs font-medium rounded-full ${className}`}
      role="status"
      aria-label={`Data ${label}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export default FreshnessBadge;