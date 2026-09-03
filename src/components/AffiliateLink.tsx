"use client";

import { trackAffiliateClick } from "@/lib/ga4";
import { captureProductCardClick } from "@/lib/posthog-client";

// BUY-80661: wire source_page into AffiliateLink so every CTA that goes
// through this component (PDP buy buttons, wishlist, compare tables) emits
// affiliate_click with source_page on click.
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
 * On click, it fires captureProductCardClick (PostHog affiliate_click with
 * source_page) and sends a beacon to /api/track-click with product_id,
 * platform, source_page, and user_agent.
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
  // BUY-75417: affiliate-standard rel — Google/FTC require nofollow sponsored on
  // every affiliate anchor, whether the href is an /r/ redirect (product-detail
  // buy buttons, compare-table "Open retailer") or a direct merchant URL.
  rel = "noopener noreferrer nofollow sponsored",
  ...rest
}: AffiliateLinkProps) {
  const platformName = platform.includes('_') ? platform.split('_')[1] || platform : platform;
  const productLabel = productName || String(productId);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    trackAffiliateClick(productLabel, platformName);

    // BUY-80661: emit PostHog affiliate_click with source_page + add ?pathname=
    // to the beacon so server-side tracking also captures the source page.
    try {
      const currentHref = event.currentTarget.href;
      captureProductCardClick({
        href: currentHref,
        productId,
        merchantId: platformName,
      });
    } catch {
      // never block navigation
    }

    try {
      const sourcePage =
        typeof window !== "undefined" ? window.location.pathname : "";
      const trackingData = {
        product_id: productId,
        platform: platform,
        source_page: sourcePage,
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
        }).catch(() => {});
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
    // BUY-67036: Next 14.2.35 RSC navigation re-render pre-renders client
    // components server-side. window is not defined there. Pass an empty
    // string as base so URL() derives from the absolute URL.
    const urlObj = typeof window !== "undefined"
      ? new URL(url, window.location.origin)
      : new URL(url);

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