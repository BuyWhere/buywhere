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

export function getMerchantConfig(merchant: string): MerchantConfig {
  return MERCHANT_CONFIG[merchant] || { icon: '🏬', bgColor: 'bg-gray-100', textColor: 'text-gray-600', verified: false };
}

export interface MerchantBadgeProps {
  merchant: string;
  className?: string;
  showVerified?: boolean;
}

export function MerchantBadge({ merchant, className = '', showVerified = true }: MerchantBadgeProps) {
  const config = getMerchantConfig(merchant);
  const isVerified = config.verified && showVerified;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full w-fit ${config.bgColor} ${className}`}
      role="img"
      aria-label={`${merchant}${isVerified ? ' - Verified retailer' : ''}`}
    >
      <span className="text-sm flex-shrink-0">{config.icon}</span>
      <span className={`text-xs font-medium ${config.textColor || 'text-gray-600'}`}>
        {merchant}
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
