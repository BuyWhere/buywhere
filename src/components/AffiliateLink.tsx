"use client";

import { trackAffiliateClick } from "@/lib/ga4";



interface AffiliateLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  productId: string | number;
  platform: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  productName?: string;
}

/**
 * Component that wraps outbound affiliate links with click tracking.
 * On click, it sends a beacon request to /api/track-click with product_id, platform, and user_agent.
 * Adds UTM parameters to the destination URL for affiliate tracking.
 * GDPR/PDPA compliant - only tracks when user interacts with the link.
 */
export function AffiliateLink({
  productId,
  platform,
  userAgent,
  utmSource = "buywhere",
  utmMedium = "affiliate",
  utmCampaign = "catalog",
  productName,
  href,
  children,
  className,
  target = "_blank",
  rel = "noopener noreferrer",
  ...rest
}: AffiliateLinkProps) {
  const platformName = platform.includes('_') ? platform.split('_')[1] || platform : platform;
  const productLabel = productName || String(productId);

  const handleClick = async () => {
    trackAffiliateClick(productLabel, platformName);

    try {
      const trackingData = {
        product_id: productId,
        platform: platform,
        user_agent: userAgent || navigator.userAgent,
      };

      const trackingEndpoint = "/api/track-click";

      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          trackingEndpoint,
          JSON.stringify(trackingData)
        );
      } else {
        fetch(trackingEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(trackingData),
          keepalive: true,
        }).catch(console.error);
      }
    } catch (err) {
      console.warn("Affiliate link tracking failed:", err);
    }
  };
  
  // Enhance href with UTM parameters if not already present
  const enhancedHref = useEnhancedHrefWithUTM(href || "#", {
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  });
  
  return (
    <a
      href={enhancedHref}
      onClick={handleClick}
      target={target}
      rel={rel}
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * Utility function to add UTM parameters to a URL
 */
function useEnhancedHrefWithUTM(url: string, utmParams: Record<string, string>): string {
  try {
    const urlObj = new URL(url, window.location.origin);
    
    // Add UTM parameters
    Object.entries(utmParams).forEach(([key, value]) => {
      if (value) {
        urlObj.searchParams.set(key, value);
      }
    });
    
    return urlObj.toString();
  } catch (e) {
    // If URL parsing fails, return original URL
    console.warn("Failed to parse URL for UTM enhancement:", url, e);
    return url;
  }
}