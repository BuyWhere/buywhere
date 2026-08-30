"use client";

import Link from "next/link";
import { ProductGridImage } from "@/components/seo/ProductGridImage";
import { attachProductCardClickAttribution, buildAffiliateRedirectUrl } from "@/lib/click-attribution";
import posthog from "posthog-js";
import type { LandingProduct } from "@/lib/seo-landing-pages";

// Local copy of the same session-id read used across product-card components
// (PostHog adds get_session_id() at runtime; guard in case it isn't wired).
function safePostHogSessionId(): string | null {
  try {
    return (posthog as typeof posthog & { get_session_id?: () => string | null }).get_session_id?.() || null;
  } catch {
    return null;
  }
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) {
    return "Price unavailable";
  }

  return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

export function ProductGridCard({ product, compact = false }: { product: LandingProduct; compact?: boolean }) {
  // BUY-76340 / BUY-75417: the whole card must lead to a server-rendered,
  // crawlable affiliate redirect so AI crawlers (GPTBot, ClaudeBot) and real
  // users both earn commission (target 10K affiliate clicks/day from intent
  // pages). Prefer /r/direct/{id}; fall back to any external merchant href.
  // NOTE: only use buildAffiliateRedirectUrl when affiliateUrl exists (meaning
  // the product HAS a DB record); static fallback products (lp* IDs) have no
  // DB record, so /r/direct/lp* redirects to homepage.
  //
  // BUY-78023: when affiliateUrl is absent (fallback product), prefer
  // `product.productUrl` (the canonical /products/{region}/{slug}/{id} PDP
  // route) over `product.href` (a /search?q=... loopback). Both US and SG
  // fallback products now point every card anchor at the same canonical PDP
  // instead of leaking /search?q= hrefs into SSR HTML. `isMerchantOffer`
  // still evaluates to false for fallbacks (productUrl starts with /products/,
  // not /r/ or http://), so the CTA renders the passive "Compare prices"
  // span and the "View details" Next.js Link uses the same PDP — no fake
  // merchant button is shown, and there is no /search?q= loopback anywhere.
  const affiliateHref = product.affiliateUrl
    ? (buildAffiliateRedirectUrl(product.id) || product.href || "#")
    : (product.productUrl || product.href || "#");

  // A card is a "merchant offer" when it has a real external/affiliate target
  // to send the shopper to (as opposed to a passive compare-only row whose
  // only destination is the search results page).
  const isMerchantOffer =
    (affiliateHref.startsWith("http") || affiliateHref.startsWith("/r/")) && affiliateHref !== "#";

  // BUY-74988: fire client-side PostHog affiliate_click with page attribution
  // fields so intent-page product-card clicks carry source_page / current_url
  // into PostHog analytics.  The server-side /r/ handler also emits this event
  // but only when the browser follows the redirect; bots that fetch the page
  // without JS never hit the /r/ endpoint, so the DB-level affiliate_clicks
  // row is the authoritative source for bot traffic.
  function fireProductCardPosthog(href: string) {
    if (typeof window === "undefined") return;
    try {
      posthog.capture("affiliate_click", {
        source: "product_card",
        product_id: String(product.id),
        merchant_id: product.merchant,
        affiliate_link_id: "",
        href,
        pathname: window.location.pathname,
        $pathname: window.location.pathname,
        current_url: window.location.href,
        $current_url: window.location.href,
        ...(document.referrer ? { referrer: document.referrer, $referrer: document.referrer } : {}),
        ...(safePostHogSessionId() ? { session_id: safePostHogSessionId(), $session_id: safePostHogSessionId() } : {}),
        $set: {
          source: "product_card",
          pathname: window.location.pathname,
          current_url: window.location.href,
        },
      });
    } catch { /* never block navigation */ }
  }

  // BUY-76340: combine attribution param appending (attachProductCardClickAttribution)
  // with the client-side PostHog event, WITHOUT preventDefault, so the browser
  // follows the native <a href={/r/direct/{id}}> navigation (which the server-side
  // /r/ handler counts as the authoritative affiliate_clicks row).
  function handleAffiliateClick(e: React.MouseEvent<HTMLAnchorElement>) {
    attachProductCardClickAttribution(e);
    fireProductCardPosthog(e.currentTarget.href);
  }

  return (
    <div
      className={`group grid h-full min-w-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl ${
        compact ? "grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]" : "grid-rows-[auto_1fr]"
      }`}
    >
      {/*
        BUY-66323: harden image wrapper so the bg never bleeds into the text column.

        The live page was rendering without its CSS bundle (all /_next/static/css/*.css
        and /_next/static/chunks/app/* return 404 at the moment), which collapses the
        layout. Even with a stale build, an oversized source image or an aspect-ratio
        round-up used to push the wrapper past its grid cell, letting the bg-slate-100
        (or pre-BUY-65158 radial-gradient) bleed behind the metadata tags + title.

        Belt-and-suspenders against any of those failure modes:
          - `isolate`        -> creates a new stacking context so the bg cannot paint
                                outside this box even when CSS is partial.
          - `min-w-0`        -> grid items shrink-to-fit instead of stretching past the
                                column track.
          - `max-w-full`     -> inline width cap; redundant with min-w-0 but survives
                                any Tailwind purge / class-not-applied case.
          - inline `style`   -> two declarations (overflow:hidden + maxWidth:100%)
                                apply even when the stylesheet bundle is missing,
                                which is exactly what QA observed on /laptop-singapore.
      */}
      <a
        href={affiliateHref}
        onClick={handleAffiliateClick}
        target="_blank"
        rel="noopener noreferrer nofollow sponsored"
        aria-label={`Buy ${product.name} at ${product.merchant}`}
        className={`block ${compact ? "" : "group-hover:opacity-95"}`}
      >
        <div
          className={`relative isolate overflow-hidden bg-slate-100 ${compact ? "aspect-[4/3] min-w-0 max-w-full rounded-l-[27px]" : "aspect-[4/3] min-w-0 max-w-full rounded-t-[27px]"}`}
          style={{ overflow: "hidden", maxWidth: "100%" }}
        >
          <ProductGridImage
            src={product.imageUrl || ""}
            alt={product.name}
            brand={product.brand}
            merchant={product.merchant}
            // BUY-69167: thread the page-resolved category through to the
            // client fallback so the onError placeholder matches the data-
            // layer branded SVG silhouette for the same product.
            category={product.category}
          />
        </div>
      </a>

      <div className={`flex min-w-0 flex-1 flex-col gap-4 ${compact ? "p-4" : "p-5"}`}>
        <a
          href={affiliateHref}
          onClick={handleAffiliateClick}
          target="_blank"
          rel="noopener noreferrer nofollow sponsored"
          className="block"
          aria-label={`Buy ${product.name} at ${product.merchant}`}
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {product.merchant}
            </span>
            {product.category ? <span>{product.category}</span> : null}
          </div>
        </a>

        <a
          href={affiliateHref}
          onClick={handleAffiliateClick}
          target="_blank"
          rel="noopener noreferrer nofollow sponsored"
          className="block"
          aria-label={`Buy ${product.name} at ${product.merchant}`}
        >
          <div className="space-y-2">
            <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-slate-900 transition-colors group-hover:text-amber-800">
              {product.name}
            </h2>
            {product.brand ? (
              <p className="text-sm text-slate-600">{product.brand}</p>
            ) : null}
          </div>
        </a>

        <div className={`mt-auto ${compact ? "grid gap-3" : "flex items-end justify-between gap-4"}`}>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
              Current price
            </p>
            <p className="text-2xl font-semibold text-slate-900">
              {formatPrice(product.price, product.currency)}
            </p>
          </div>
          {/* BUY-70352 / BUY-76340: unify CTA shape. Merchant rows get a
              real affiliate <a> to /r/direct/{id} (crawlable + commission).
              Non-merchant rows get the passive "Compare prices" span. A
              secondary "View details" link keeps the PDP reachable. */}
          <div className={`${compact ? "grid gap-2" : "flex items-center gap-2"}`}>
            {isMerchantOffer ? (
              <a
                href={affiliateHref}
                onClick={handleAffiliateClick}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-amber-700 px-4 py-2.5 text-center font-semibold text-white shadow-sm transition-colors hover:bg-amber-800 ${compact ? "w-full text-xs" : "text-sm"}`}
              >
                Buy at {product.merchant}
              </a>
            ) : (
              <span
                className={`inline-flex min-h-11 items-center justify-center rounded-full bg-amber-700 px-4 py-2.5 text-center font-semibold text-white shadow-sm transition-colors hover:bg-amber-800 ${compact ? "w-full text-xs" : "text-sm"}`}
              >
                Compare prices
              </span>
            )}
            {product.productUrl ? (
              <Link
                href={product.productUrl}
                prefetch={false}
                className={`inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-center font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-900 ${compact ? "w-full text-xs" : "text-sm"}`}
              >
                View details
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}