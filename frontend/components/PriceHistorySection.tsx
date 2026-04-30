'use client';

import { useState, useEffect, useCallback } from 'react';
import PriceHistoryChart from './PriceHistoryChart';
import ErrorState from './ErrorState';
import { PriceHistoryResponse } from '@/lib/priceHistoryApi';
import styles from './PriceHistorySection.module.css';

interface PriceHistorySectionProps {
  productId: number;
  currency?: string;
}

export default function PriceHistorySection({ productId, currency = 'SGD' }: PriceHistorySectionProps) {
  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPriceHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/v1/products/${productId}/price-history?aggregate=daily&period=30d`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch price history');
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchPriceHistory();
  }, [fetchPriceHistory]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>Price History</h3>
        </div>
        <div className={styles.skeleton}>
          <div className={styles.skeletonChart} />
          <div className={styles.skeletonStats}>
            <div className={styles.skeletonStat} />
            <div className={styles.skeletonStat} />
            <div className={styles.skeletonStat} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>Price History</h3>
        </div>
        <ErrorState
          title="Failed to load price history"
          message="We couldn't load the price history chart. Please try again."
          onRetry={fetchPriceHistory}
        />
      </div>
    );
  }

  if (!data || data.aggregated_entries.length === 0) {
    return null;
  }

  return (
    <PriceHistoryChart
      data={data.aggregated_entries}
      currency={currency}
      period={data.period}
    />
  );
}