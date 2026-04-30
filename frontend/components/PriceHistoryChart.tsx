'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { PriceHistoryAggregationEntry } from '@/lib/priceHistoryApi';
import styles from './PriceHistoryChart.module.css';

interface PriceHistoryChartProps {
  data: PriceHistoryAggregationEntry[];
  currency?: string;
  period?: string;
}

type PeriodOption = '7d' | '30d' | '90d';

const PERIOD_LABELS: Record<PeriodOption, string> = {
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: PriceHistoryAggregationEntry;
  }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || !payload.length) return null;

  const entry = payload[0].payload;
  const date = new Date(entry.date);

  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipDate}>
        {date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
      <p className={styles.tooltipPrice}>
        {entry.currency} {Number(entry.min_price).toFixed(2)}
      </p>
      {entry.max_price !== entry.min_price && (
        <p className={styles.tooltipRange}>
          Range: {entry.currency} {Number(entry.min_price).toFixed(2)} – {Number(entry.max_price).toFixed(2)}
        </p>
      )}
      <p className={styles.tooltipCount}>{entry.price_count} price records</p>
    </div>
  );
};

export default function PriceHistoryChart({
  data,
  currency = 'SGD',
  period = '30d',
}: PriceHistoryChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodOption>(
    period.includes('7') ? '7d' : period.includes('90') ? '90d' : '30d'
  );

  if (!data || data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>Price History</h3>
        </div>
        <div className={styles.emptyState}>
          <p>No price history data available for this period.</p>
        </div>
      </div>
    );
  }

  const chartData = data.map((entry) => ({
    date: entry.date,
    min: Number(entry.min_price),
    max: Number(entry.max_price),
    avg: Number(entry.avg_price),
    count: entry.price_count,
    currency: entry.currency,
  }));

  const minPrice = Math.min(...chartData.map((d) => d.min));
  const maxPrice = Math.max(...chartData.map((d) => d.max));
  const avgPrice = chartData.reduce((sum, d) => sum + d.avg, 0) / chartData.length;
  const priceRange = maxPrice - minPrice;
  const yMin = Math.max(0, minPrice - priceRange * 0.1);
  const yMax = maxPrice + priceRange * 0.1;

  const formatXAxis = (dateStr: string) => {
    const date = new Date(dateStr);
    if (selectedPeriod === '7d') {
      return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
    }
    return date.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
  };

  const formatYAxis = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toFixed(0);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Price History</h3>
        <div className={styles.periodSelector}>
          {(['7d', '30d', '90d'] as PeriodOption[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.periodButton} ${selectedPeriod === p ? styles.active : ''}`}
              onClick={() => setSelectedPeriod(p)}
              aria-pressed={selectedPeriod === p}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={avgPrice}
              stroke="#3b82f6"
              strokeDasharray="5 5"
              strokeWidth={1}
              label={{
                value: `Avg: ${currency} ${avgPrice.toFixed(2)}`,
                position: 'right',
                fontSize: 11,
                fill: '#3b82f6',
              }}
            />
            <Line
              type="monotone"
              dataKey="min"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#10b981' }}
              name="Min Price"
            />
            <Line
              type="monotone"
              dataKey="max"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#f59e0b' }}
              name="Max Price"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Lowest</span>
          <span className={styles.statValueLow}>{currency} {minPrice.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Average</span>
          <span className={styles.statValueAvg}>{currency} {avgPrice.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Highest</span>
          <span className={styles.statValueHigh}>{currency} {maxPrice.toFixed(2)}</span>
        </div>
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.legendColor} style={{ background: '#10b981' }} />
          <span>Lowest Price</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendColor} style={{ background: '#f59e0b' }} />
          <span>Highest Price</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendColor} style={{ background: '#3b82f6', height: 1 }} />
          <span>Average</span>
        </div>
      </div>
    </div>
  );
}