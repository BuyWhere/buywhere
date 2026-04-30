'use client';

import { posthog } from 'posthog-js';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

if (typeof window !== 'undefined' && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,
  });
}

export function trackComparePageView(props: {
  slug: string;
  productId: string;
  retailerCount: number;
  lowestPrice: number;
}) {
  if (typeof window === 'undefined') return;
  posthog.capture('compare_page_view', props);
}

export function trackCompareRetailerClick(props: {
  slug: string;
  productId: string;
  retailer: string;
  price: number;
  rank: number;
}) {
  if (typeof window === 'undefined') return;
  posthog.capture('compare_retailer_click', props);
}

export function trackCompareSort(slug: string, sortOption: string) {
  if (typeof window === 'undefined') return;
  posthog.capture('compare_sort', { slug, sort_option: sortOption });
}