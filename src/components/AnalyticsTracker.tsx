'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initGA4, trackPageView, isGA4Enabled } from '@/lib/ga4';

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initGA4();
  }, []);

  useEffect(() => {
    if (!isGA4Enabled()) return;
    const url = `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}`;
    trackPageView(url, document.title);
  }, [pathname, searchParams]);

  return null;
}

export default AnalyticsTracker;