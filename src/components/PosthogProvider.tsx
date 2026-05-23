'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { POSTHOG_KEY, POSTHOG_HOST } from '@/lib/posthog';
import { classifyAgent } from '@/lib/agent-ua';

export function PosthogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = navigator.userAgent;
    const { is_bot } = classifyAgent(ua);
    if (is_bot) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: 'localStorage',
      loaded: (ph) => {
        ph.identify();
        ph.setPersonProperties({
          $raw_user_agent: ua,
          ...classifyAgent(ua),
        });
      },
    });
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

export default PosthogProvider;
