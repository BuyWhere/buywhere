'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initGA4, trackPageView, isGA4Enabled } from '@/lib/ga4';
import posthog from 'posthog-js';
import { POSTHOG_KEY } from '@/lib/posthog';

// BUY-72699: Normalize trailing-slash pathname at client capture (mirror of src/middleware.ts)
function normalizePathname(pathname: string): string {
  if (pathname === '/') return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initGA4();
  }, []);

  useEffect(() => {
    // BUY-72699 Defect B: Normalize trailing-slash pathname at capture
    const cleanPathname = normalizePathname(pathname ?? ''); // usePathname() is string|null during prerender

    if (isGA4Enabled()) {
      const url = `${cleanPathname}${searchParams ? `?${searchParams.toString()}` : ''}`;
      trackPageView(url, document.title);
    }

    if (typeof window !== 'undefined' && POSTHOG_KEY && posthog.__loaded) {
      const url = `${cleanPathname}${searchParams ? `?${searchParams.toString()}` : ''}`;
      // BUY-72699 Defect A: emit is_internal=false on client $pageview (non-server)
      posthog.capture('$pageview', { $current_url: url, is_internal: false });
    }
  }, [pathname, searchParams]);

  return null;
}

export default AnalyticsTracker;
