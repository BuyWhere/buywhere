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
// All entries below are seeded with the SG merchant list shape; visual
// styling uses neutral slate so unknown merchants (until Oracle posts
// BUY-74681's authoritative list) render without errors.
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

  // SG retailers (BUY-74691 + BUY-74681). Seed entries that match the
  // merchant_slug of known SG storefronts. Once Oracle posts the canonical
  // 20-merchant JSON, these will be filled in with logo_url + scraped_via.
  // For now, the badge still renders the merchant_name from the API; the
  // entry here only governs icon + verified flag.
  'alltronic': { icon: '🛒', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'tech-house': { icon: '💻', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'popular': { icon: '📚', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'courts': { icon: '🛋️', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'harvey-norman': { icon: '🏬', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'gain-city': { icon: '🔌', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'challenger': { icon: '🖥️', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'best-denki': { icon: '📺', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'apple-authorised-reseller': { icon: '🍎', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: true },
  'lazada-sg': { icon: '🛍️', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: false },
  'shopee-sg': { icon: '🛒', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: false },
  'amazon-sg': { icon: '📦', bgColor: 'bg-slate-100', textColor: 'text-slate-700', verified: false },
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
