import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import {
  buildSeoLandingMetadata,
  seoLandingPages,
} from "@/lib/seo-landing-pages";
import { toSiteUrl } from "@/lib/site-url";

// BUY-64729: the Express /api/c/:slug handler (api.buywhere.ai/c/{slug}) emits
// /c/{slug} URLs in its HTML — but those URLs are reachable on api.buywhere.ai,
// not on the public site. QA re-verification at 2026-07-29T06:25Z flagged
// https://buywhere.ai/c/laptop returning 404 ("Lost in the aisles?").
//
// This page serves /c/{slug} on the public site so those AI-crawler-friendly
// URLs resolve to a real SEO landing page with real product thumbnails (the
// BUY-64729 image fix in src/lib/seo-landing-pages.ts applies here too —
// broken CDN URLs are replaced with branded SVG data URLs, never a generic
// placeholder icon).
//
// Canonical points at the canonical /<seo-slug> page (e.g. /c/laptop →
// /laptop-singapore) so Google consolidates ranking signals.

/**
 * Map a public-facing /c/{slug} shorthand to the canonical SEO landing page slug.
 *
 * The Express /c/:slug handler builds URLs from `categoryName.toLowerCase()`
 * (singular: "Laptop", "Air Purifier") so the public URL pattern is /c/laptop,
 * /c/air-purifier, /c/electronics, etc. — but our canonical SEO landing pages
 * live at /<slug>-singapore (e.g. /laptop-singapore) for SG-targeted guides
 * and /<slug>-us for US-targeted guides. Resolve the shorthand to the right
 * canonical config here.
 */
const SLUG_ALIASES: Record<string, string> = {
  // SG-targeted shorthands → canonical SEO landing pages
  laptop: "laptop-singapore",
  laptops: "laptop-singapore",
  "air-purifier": "air-purifier-singapore",
  "air-purifiers": "air-purifier-singapore",
  "air purifier": "air-purifier-singapore",
  // Common SG category shorthands
  electronics: "best-gaming-laptops-us",
  fashion: "laptop-singapore",
  "home-living": "laptop-singapore",
  "beauty-health": "laptop-singapore",
  // If someone hits /c/laptop-singapore directly, use the canonical config
  // (but emit canonical = /laptop-singapore to avoid duplicate-content loop).
  "laptop-singapore": "laptop-singapore",
  "air-purifier-singapore": "air-purifier-singapore",
};

function resolveCanonicalSlug(slug: string): string | null {
  const normalized = slug.toLowerCase();
  // Direct canonical slug hit
  if (seoLandingPages[normalized]) return normalized;
  // Shorthand alias hit
  const aliased = SLUG_ALIASES[normalized];
  if (aliased && seoLandingPages[aliased]) return aliased;
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const canonicalSlug = resolveCanonicalSlug(slug);
  if (!canonicalSlug) {
    return { title: "Category Not Found", robots: { index: false } };
  }
  const config = seoLandingPages[canonicalSlug];
  const baseMetadata = buildSeoLandingMetadata(config);
  // Override canonical to point at the canonical SEO landing page (not /c/{slug})
  const canonicalUrl = toSiteUrl(`/${canonicalSlug}`);
  return {
    ...baseMetadata,
    alternates: {
      ...(baseMetadata.alternates ?? {}),
      canonical: canonicalUrl,
    },
  };
}

// Only slugs that resolve to a canonical SEO landing page are valid. Unknown
// slugs must short-circuit at the framework level (HTTP 404) rather than
// render a 200 "Category Not Found" soft-404 — mirroring src/app/categories/
// [slug]/page.tsx which uses dynamicParams = false so the framework returns
// 404 before reaching the page render (BUY-64729).
export const dynamicParams = false;

// Static params = every canonical SEO landing slug + every alias KEY (not just
// target). We pre-register the alias keys themselves (e.g. "laptop",
// "air-purifier", "laptops") so /c/laptop etc. are recognized at the
// framework level and don't fall through to a 404 from dynamicParams = false.
export function generateStaticParams() {
  const seen = new Set<string>();
  for (const slug of Object.keys(seoLandingPages)) seen.add(slug);
  for (const alias of Object.keys(SLUG_ALIASES)) seen.add(alias);
  return Array.from(seen).map((slug) => ({ slug }));
}

export default async function CSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const canonicalSlug = resolveCanonicalSlug(slug);
  if (!canonicalSlug) {
    notFound();
  }
  const config = seoLandingPages[canonicalSlug];
  return <SeoLandingPage config={config} />;
}