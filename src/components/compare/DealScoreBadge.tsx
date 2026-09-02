'use client';

import React, { memo } from 'react';

type DealScore = 'great_deal' | 'good_deal' | 'fair_price' | 'high_price';

interface DealScoreBadgeProps {
  score: DealScore;
  percentVsAvg: number;
  currency?: string;
  className?: string;
}

const scoreConfig: Record<DealScore, { label: string; bg: string; text: string; icon: string }> = {
  great_deal: {
    label: 'Great deal',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    icon: '★',
  },
  good_deal: {
    label: 'Good deal',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    icon: '✓',
  },
  fair_price: {
    label: 'Fair price',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    icon: '→',
  },
  high_price: {
    label: 'High price',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    icon: '↑',
  },
};

export const DealScoreBadge = memo(function DealScoreBadge({
  score,
  percentVsAvg,
  currency = 'USD',
  className = '',
}: DealScoreBadgeProps) {
  const config = scoreConfig[score] ?? scoreConfig.fair_price;

  const formattedSavings = new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Math.abs(percentVsAvg));

  const savingsLabel = percentVsAvg < 0
    ? `${formattedSavings} below average`
    : `${formattedSavings} above average`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${config.bg} ${config.text} text-xs font-semibold ${className}`}
      role="status"
      aria-label={`${config.label} — ${savingsLabel}`}
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{config.label}</span>
      <span className="text-xs opacity-75" aria-hidden="true">
        ({percentVsAvg > 0 ? '+' : ''}{percentVsAvg.toFixed(0)}% vs avg)
      </span>
    </div>
  );
});

export default DealScoreBadge;