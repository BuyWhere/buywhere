'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { POSTHOG_KEY, POSTHOG_HOST, POSTHOG_UI_HOST } from '@/lib/posthog';
import { flushPosthogQueue } from '@/lib/posthog-client';
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

    // BUY-60203: Defer PostHog init past hydration so its script-injection
    // side effects never land inside React's hydration phase. Without this,
    // PostHog inserts remote <script> tags into the body before React finishes
    // hydrating the server-rendered tree, producing a hydration mismatch
    // (Minified React #418/#422). requestIdleCallback waits for hydration to
    // settle; fall back to a small timeout in browsers without the API.
    const scheduleInit = (cb: () => void) => {
      const ric = (window as typeof window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (typeof ric === 'function') {
        ric(cb);
      } else {
        setTimeout(cb, 200);
      }
    };

    scheduleInit(() => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        ui_host: POSTHOG_UI_HOST,
        // Provide identity up-front so remote-config / early side effects never
        // observe an unset distinct id (the source of the console warning).
        identity_distinct_id: distinctId,
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        persistence: 'localStorage',
        // BUY-60203: PostHog was injecting remote <script> tags
        // (exception-autocapture, web-vitals, surveys, recorder) into the DOM
        // during hydration, breaking SSR/CSR parity and triggering Minified
        // React #418/#422 on every page. PostHog init is now deferred past
        // hydration (see scheduleInit above) and the DOM-mutating features
        // (session recording, surveys) are disabled so init no longer races
        // with React's hydration phase.
        disable_session_recording: true,
        disable_surveys: true,
        // Loaded runs after init completes; identify here so we still capture identity.
        loaded: (ph) => {
          ph.identify(distinctId, { is_bot, agent_family });
          ph.setPersonProperties({
            $raw_user_agent: ua,
            ...classifyAgent(ua),
          });
          flushPosthogQueue();
        },
      });

      // Belt-and-suspenders: ensure identify has run with a non-empty id even if
      // the loaded() callback fired before this effect (or was skipped).
      posthog.identify(distinctId, { is_bot, agent_family });
      flushPosthogQueue();
    });
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

export default PosthogProvider;
