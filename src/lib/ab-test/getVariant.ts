import { useEffect, useState } from 'react';

const COOKIE_NAME = 'bw_ab_test_variant';
const VARIANTS = ['start-comparing', 'find-best-price', 'shop-smarter'] as const;
export type CTAVariant = typeof VARIANTS[number];

/**
 * Get the A/B test variant for the current user.
 * Uses a cookie to persist the variant across sessions.
 * If no cookie exists, assigns a random variant and sets the cookie.
 */
export function useABTestVariant(): CTAVariant {
  const [variant, setVariant] = useState<CTAVariant>('start-comparing');

  useEffect(() => {
    // Try to get variant from cookie
    const cookieMatch = document.cookie.match(
      new RegExp('(^| )' + COOKIE_NAME + '=([^;]+)')
    );
    if (cookieMatch) {
      const cookieVariant = cookieMatch[2] as CTAVariant;
      if (VARIANTS.includes(cookieVariant)) {
        setVariant(cookieVariant);
        return;
      }
    }

    // Assign a random variant
    const randomIndex = Math.floor(Math.random() * VARIANTS.length);
    const newVariant = VARIANTS[randomIndex];
    setVariant(newVariant);

    // Set cookie to persist for 30 days
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${COOKIE_NAME}=${newVariant}; expires=${expires}; path=/`;
  }, []);

  return variant;
}