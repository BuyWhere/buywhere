'use client';

import { useReportWebVitals } from 'next/web-vitals';

interface Metric {
  name: string;
  value: number;
  id: string;
  delta: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

export function WebVitals() {
  useReportWebVitals((metric: Metric) => {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
    });

    if (process.env.NODE_ENV === 'development') {
      console.log('[WebVitals]', metric.name, {
        value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
        rating: metric.rating,
      });
    }

    if (process.env.NEXT_PUBLIC_ANALYTICS_ID) {
      fetch('/api/vitals', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }
  });

  return null;
}

export default WebVitals;
