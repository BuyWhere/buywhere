import React from 'react';
import { stripMerchantTenantSuffix } from '@/lib/merchant-name';
// Re-export stripMerchantTenantSuffix from the pure utility module so
// existing imports (`from '@/components/ui/MerchantBadge'`) keep working
// without consumers having to update their import paths. BUY-66324.
export { stripMerchantTenantSuffix } from '@/lib/merchant-name';

export interface MerchantConfig {
  icon: string;
  bgColor: string;
  textColor?: string;
  verified?: boolean;
}

// BUY-74691: MERCHANT_CONFIG keyed by merchant_slug (kebab-case). Lookup
// priority in the badge: merchant_slug → merchant_name → raw input.
//
// SG entries are sourced from Oracle's BUY-74681 work-product
// (data/reports/buy74681-top-sg-merchants-merchant-badge.md, 2026-08-25).
// `verified` mirrors scraped_via from the catalog (first_party = ✓).
// 17 of 20 have logo_url=null in the source JSON (no logo asset on disk);
// the badge still renders the merchant_name so the data flows end-to-end.
const MERCHANT_CONFIG: Record<string, MerchantConfig> = {
  // US retailers (legacy)
  'Amazon': { icon: '📦', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  'Amazon.com': { icon: '📦', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  'Walmart': { icon: '🛒', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Target': { icon: '🎯', bgColor: 'bg-red-50', textColor: 'text-red-700', verified: true },
  'Best Buy': { icon: '🏪', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Costco': { icon: '🏢', bgColor: 'bg-gray-100', textColor: 'text-gray-700', verified: true },
  'Home Depot': { icon: '🏠', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  "Lowe's": { icon: '🏡', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Nike': { icon: '👟', bgColor: 'bg-black', textColor: 'text-white', verified: true },
  'Adidas': { icon: '👟', bgColor: 'bg-gray-900', textColor: 'text-white', verified: true },
  'Wellbots': { icon: '🛒', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },

  // SG retailers (BUY-74681, top 20 by products_count).
  // Verified-mirror logic: scraped_via == 'first_party' → verified=true (✓).
  'fairprice-xpress':    { icon: '🛒', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', verified: false },
  'fairprice-online':    { icon: '🛒', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', verified: false },
  'ntuc-unity':          { icon: '🟢', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', verified: false },
  'fairprice-finest':    { icon: '🛒', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', verified: false },
  'iherb-sg':            { icon: '🌿', bgColor: 'bg-lime-50',    textColor: 'text-lime-700',    verified: false },
  'challenger-sg':       { icon: '🖥️', bgColor: 'bg-slate-100',   textColor: 'text-slate-700',   verified: false },
  'fairprice-com-sg':    { icon: '🛒', bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', verified: false },
  'robinsons-com-sg':    { icon: '🏬', bgColor: 'bg-slate-100',   textColor: 'text-slate-700',   verified: false },
  'harvey-norman-sg':    { icon: '🏬', bgColor: 'bg-slate-100',   textColor: 'text-slate-700',   verified: false },
  'decathlon-sg':        { icon: '⚽', bgColor: 'bg-blue-50',     textColor: 'text-blue-700',    verified: false },
  'decathlon':           { icon: '⚽', bgColor: 'bg-blue-50',     textColor: 'text-blue-700',    verified: false },
  'tangs-sg':            { icon: '🛍️', bgColor: 'bg-amber-50',    textColor: 'text-amber-700',   verified: true  },
  'fashionnova-com':     { icon: '👗', bgColor: 'bg-pink-50',     textColor: 'text-pink-700',    verified: true  },
  'kith-com':            { icon: '👟', bgColor: 'bg-slate-900',   textColor: 'text-white',       verified: true  },
  'babymallonline-com':  { icon: '🍼', bgColor: 'bg-sky-50',      textColor: 'text-sky-700',     verified: true  },
  'themodernshop-com':   { icon: '🛍️', bgColor: 'bg-stone-50',    textColor: 'text-stone-700',   verified: true  },
  'bluemercury-com':     { icon: '💄', bgColor: 'bg-indigo-50',   textColor: 'text-indigo-700',  verified: true  },
  'petloverscentre':     { icon: '🐾', bgColor: 'bg-orange-50',   textColor: 'text-orange-700',  verified: false },
  'swansonvitamins':     { icon: '💊', bgColor: 'bg-emerald-50',  textColor: 'text-emerald-700', verified: false },
  'gymshark-com':        { icon: '💪', bgColor: 'bg-slate-900',   textColor: 'text-white',       verified: true  },
};

export function getMerchantConfig(merchant: string): MerchantConfig {
  return MERCHANT_CONFIG[merchant] || { icon: '🏬', bgColor: 'bg-gray-100', textColor: 'text-gray-700', verified: false };
}

export interface MerchantBadgeProps {
  /** Display name shown in the badge. When omitted, falls back to a generic monogram. */
  merchant?: string | null;
  /** Slug-based lookup key. Takes priority over `merchant` when present in MERCHANT_CONFIG. */
  merchantSlug?: string | null;
  /**
   * Verified-mark source. When explicitly false, never renders ✓.
   * When true, renders ✓ only if the MERCHANT_CONFIG entry also marks verified.
   * When omitted, falls back to the MERCHANT_CONFIG entry's `verified` field.
   */
  scrapedVia?: 'first_party' | 'affiliate' | 'aggregator' | string | null;
  className?: string;
  showVerified?: boolean;
}

export function MerchantBadge({
  merchant,
  merchantSlug,
  scrapedVia,
  className = '',
  showVerified = true,
}: MerchantBadgeProps) {
  const cleanedMerchant = stripMerchantTenantSuffix(merchant);
  const displayKey = cleanedMerchant.replace(/[_-]+/g, ' ') || (merchant ?? '').trim();

  // Resolution order: merchant_slug (kebab-case lookup) → merchant_name → raw.
  // If the slug is in MERCHANT_CONFIG, prefer its richer config; otherwise
  // fall back to the name-based lookup that the legacy badge used.
  const config = merchantSlug && MERCHANT_CONFIG[merchantSlug]
    ? MERCHANT_CONFIG[merchantSlug]
    : getMerchantConfig(displayKey);

  // Verified-mark logic (BUY-74691 spec):
  //   ✓ only when scrapedVia === 'first_party' (data published by the merchant
  //   directly, e.g. official Shopify storefront).
  // Falls back to the legacy `config.verified` flag for entries that don't
  // yet pass scraped_via (US retailers where the field is not yet wired).
  const isFirstParty = scrapedVia === 'first_party';
  const isVerified = showVerified && (isFirstParty || (config.verified && scrapedVia == null));

  // Monogram fallback: when both merchant_name and merchantSlug resolve to
  // nothing renderable, show the first letter in slate-100 background.
  if (!displayKey) {
    const monogram = (merchantSlug ?? merchant ?? '?').trim().charAt(0).toUpperCase() || '?';
    return (
      <div
        className={`inline-flex max-w-full items-center justify-center self-start rounded-2xl w-7 h-7 bg-slate-100 text-slate-600 text-xs font-semibold ${className}`}
        role="img"
        aria-label="Unknown retailer"
        data-testid="merchant-badge-monogram"
      >
        {monogram}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 self-start rounded-2xl px-2 py-1 ${config.bgColor} ${className}`}
      role="img"
      aria-label={`${displayKey}${isVerified ? ' - Verified retailer' : ''}`}
      data-testid="merchant-badge"
      data-merchant={displayKey}
      data-merchant-slug={merchantSlug ?? ''}
      data-scraped-via={scrapedVia ?? ''}
    >
      <span className="text-sm flex-shrink-0 leading-none">{config.icon}</span>
      <span className={`min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-xs font-medium leading-snug ${config.textColor || 'text-gray-700'}`} title={displayKey}>
        {displayKey}
      </span>
      {isVerified && (
        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/80 shadow-sm" aria-hidden="true">
          <svg
            className={`w-2.5 h-2.5 ${config.textColor || 'text-green-600'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      )}
    </div>
  );
}

export default MerchantBadge;
