'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { POSTHOG_KEY, POSTHOG_HOST } from '@/lib/posthog';
import { classifyAgent } from '@/lib/agent-ua';

const ANON_ID_STORAGE_KEY = 'buywhere_posthog_anonymous_id';

// PostHog v4+ logs "[PostHog.js] Unique user id has not been set in
// posthog.identify" whenever identify() runs without a non-empty distinct id.
// We generate and persist a stable anonymous id so PostHog always has identity
// available before init/remote-config side effects fire.
function getOrCreateAnonymousId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
  } catch {
    // localStorage may be unavailable (private mode / disabled); fall through.
  }

  const generated =
    (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
    `bw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

  try {
    localStorage.setItem(ANON_ID_STORAGE_KEY, generated);
  } catch {
    // Best effort; identity still works for this session via the return value.
  }
  return generated;
}

export function PosthogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = navigator.userAgent;
    const { is_bot, agent_family } = classifyAgent(ua);
    if (is_bot) return;

    const distinctId = getOrCreateAnonymousId();

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Provide identity up-front so remote-config / early side effects never
      // observe an unset distinct id (the source of the console warning).
      identity_distinct_id: distinctId,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: 'localStorage',
      loaded: (ph) => {
        ph.identify(distinctId, { is_bot, agent_family });
        ph.setPersonProperties({
          $raw_user_agent: ua,
          ...classifyAgent(ua),
        });
      },
    });

    // Belt-and-suspenders: ensure identify has run with a non-empty id even if
    // the loaded() callback fired before this effect (or was skipped).
    posthog.identify(distinctId, { is_bot, agent_family });
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

export default PosthogProvider;
