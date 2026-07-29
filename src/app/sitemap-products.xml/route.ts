import { buildSitemapResponse, renderUrlSet } from "@/lib/sitemaps";

// BUY-65097: Merchant product-listing routes are intentionally noindex while
// they render thin "Product listings coming soon" placeholders. Google treats
// noindex sitemap URLs as conflicting signals, so keep sitemap-products.xml
// empty until it can be backed by useful, indexable product inventory. Do not
// remove noindex from placeholder pages instead.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return buildSitemapResponse(renderUrlSet([]));
}
