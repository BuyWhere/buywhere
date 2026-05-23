'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initGA4, trackPageView, isGA4Enabled } from '@/lib/ga4';
import posthog from 'posthog-js';
import { POSTHOG_KEY } from '@/lib/posthog';

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initGA4();
  }, []);

  useEffect(() => {
    if (isGA4Enabled()) {
      const url = `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}`;
      trackPageView(url, document.title);
    }

    if (typeof window !== 'undefined' && POSTHOG_KEY && posthog.__loaded) {
      const url = `${pathname}${searchParams ? `?${searchParams.toString()}` : ''}`;
      posthog.capture('$pageview', { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}

export default AnalyticsTracker;
