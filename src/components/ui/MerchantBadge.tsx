import React from 'react';

export interface MerchantConfig {
  icon: string;
  bgColor: string;
  textColor?: string;
  verified?: boolean;
}

const MERCHANT_CONFIG: Record<string, MerchantConfig> = {
  'Amazon': { icon: '📦', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  'Amazon.com': { icon: '📦', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  'Walmart': { icon: '🛒', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Target': { icon: '🎯', bgColor: 'bg-red-50', textColor: 'text-red-700', verified: true },
  'Best Buy': { icon: '🏪', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Costco': { icon: '🏢', bgColor: 'bg-gray-100', textColor: 'text-gray-700', verified: true },
  'Home Depot': { icon: '🏠', bgColor: 'bg-orange-50', textColor: 'text-orange-700', verified: true },
  'Lowe\'s': { icon: '🏡', bgColor: 'bg-blue-50', textColor: 'text-blue-700', verified: true },
  'Nike': { icon: '👟', bgColor: 'bg-black', textColor: 'text-white', verified: true },
  'Adidas': { icon: '👟', bgColor: 'bg-gray-900', textColor: 'text-white', verified: true },
};

// Canonical platform roots. When the raw merchant string starts with one of
// these (case-insensitive, underscore- or hyphen-separated), the trailing
// tenant/database suffix is stripped so the badge renders e.g. "Shopify"
// instead of "Shopify Buy30620 Crate". String values match the title-cased
// keys in MERCHANT_CONFIG; lookup is done in lowercase.
const PLATFORM_ROOTS = new Set([
  'shopify',
  'walmart',
  'amazon',
  'target',
  'best buy',
  'costco',
  'home depot',
  'lowes',
  'lowe\'s',
  'nike',
  'adidas',
  'google shopping',
  'ebay',
  'newegg',
  'apple',
  'dell',
  'lenovo',
  'gamestop',
  'magento',
  'woocommerce',
]);

export function getMerchantConfig(merchant: string): MerchantConfig {
  return MERCHANT_CONFIG[merchant] || { icon: '🏬', bgColor: 'bg-gray-100', textColor: 'text-gray-700', verified: false };
}

/**
 * Strip internal tenant/database suffixes from a merchant string so the badge
 * shows a clean platform name. Tolerates input that has already been
 * title-cased and de-underscored by upstream serializers (so the boundary
 * between platform and tenant may be a space rather than an underscore).
 *
 * Examples:
 *   "shopify" -> "shopify"
 *   "shopify_buy30620_crate" -> "shopify"
 *   "Shopify Buy30620 Crate" -> "Shopify" (already-de-underscored input)
 *   "shopify_buy30620_hunt2" -> "shopify"
 *   "shopify_scrape" -> "shopify"
 *   "walmart_us" -> "walmart"
 *   "google_shopping" -> "google_shopping" (kept; both tokens are platform)
 *   "lordandtaylorcom" -> "lordandtaylorcom" (unknown platform, kept as-is)
 */
export function stripMerchantTenantSuffix(value?: string | null): string {
  if (!value) return '';
  const tokens = value.split(/[\s_-]+/).filter(Boolean);
  if (tokens.length <= 1) return value;

  const firstToken = tokens[0].toLowerCase();
  if (PLATFORM_ROOTS.has(firstToken)) {
    return tokens[0];
  }

  // Two-token platforms like "google_shopping" must be preserved when both
  // tokens form a known platform name.
  if (tokens.length >= 2) {
    const twoToken = `${tokens[0].toLowerCase()} ${tokens[1].toLowerCase()}`;
    if (PLATFORM_ROOTS.has(twoToken)) {
      return `${tokens[0]} ${tokens[1]}`;
    }
  }

  return value;
}

export interface MerchantBadgeProps {
  merchant: string;
  className?: string;
  showVerified?: boolean;
}

export function MerchantBadge({ merchant, className = '', showVerified = true }: MerchantBadgeProps) {
  const cleanedMerchant = stripMerchantTenantSuffix(merchant);
  const displayKey = cleanedMerchant
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const config = getMerchantConfig(displayKey);
  const isVerified = config.verified && showVerified;

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 self-start rounded-2xl px-2 py-1 ${config.bgColor} ${className}`}
      role="img"
      aria-label={`${displayKey}${isVerified ? ' - Verified retailer' : ''}`}
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
