'use client';

import React, { memo } from 'react';

interface SparklineBar {
  date: string;
  price: number;
}

interface CompareBarChartProps {
  history: SparklineBar[];
  currency?: string;
  height?: number;
  className?: string;
}

function formatPrice(price: number, currency: string = 'USD'): string {
  try {
    return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export const CompareBarChart = memo(function CompareBarChart({
  history,
  currency = 'USD',
  height = 48,
  className = '',
}: CompareBarChartProps) {
  if (!history || history.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-50 rounded-lg text-xs text-slate-400 ${className}`}
        style={{ height }}
        aria-label="No price history available"
        role="status"
      >
        No history
      </div>
    );
  }

  const prices = history.map((h) => h.price).filter((p) => Number.isFinite(p));
  if (prices.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-50 rounded-lg text-xs text-slate-400 ${className}`}
        style={{ height }}
        aria-label="No price history available"
        role="status"
      >
        No history
      </div>
    );
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice;

  const normalizedBars = history.map((bar) => {
    if (range === 0) return 50;
    return Math.round(((bar.price - minPrice) / range) * 80) + 10;
  });

  const minLabel = formatPrice(minPrice, currency);
  const maxLabel = formatPrice(maxPrice, currency);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div
        className="flex items-end gap-px rounded overflow-hidden"
        style={{ height }}
        role="img"
        aria-label={`Price history from ${formatDate(history[0]?.date)} to ${formatDate(history[history.length - 1]?.date)}: ${minLabel} to ${maxLabel}`}
      >
        {normalizedBars.map((barHeight, idx) => {
          const isMin = prices[idx] === minPrice;
          const isMax = prices[idx] === maxPrice;

          return (
            <div
              key={idx}
              className={`flex-1 transition-all ${isMin ? 'bg-emerald-400' : isMax ? 'bg-rose-400' : 'bg-indigo-300'}`}
              style={{ height: `${barHeight}%` }}
              title={`${formatDate(history[idx].date)}: ${formatPrice(history[idx].price, currency)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{formatDate(history[0]?.date)}</span>
        <span>{formatDate(history[history.length - 1]?.date)}</span>
      </div>
    </div>
  );
});

export default CompareBarChart;