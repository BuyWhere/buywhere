import {
  buildSitemapResponse,
  renderUrlSet,
  getProductSitemapEntries,
  getSGProductSitemapEntries,
} from "@/lib/sitemaps";

// BUY-65097: Merchant product-listing routes are intentionally noindex while
// they render thin "Product listings coming soon" placeholders. Google treats
// noindex sitemap URLs as conflicting signals, so merchant listing URLs are
// excluded from sitemap-products.xml (getMerchantListingSitemapEntries is not
// called here). US/SG product detail routes ARE indexable, so they remain.
// BUY-65121: the prior fix returned renderUrlSet([]), which also dropped all
// US/SG product URLs (regression from 38KB → 110 bytes). Restored here.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // Intentionally NOT calling getMerchantListingSitemapEntries() — those
  // routes are noindex placeholders (BUY-65097).
  const [usEntries, sgEntries] = await Promise.all([
    getProductSitemapEntries(),
    getSGProductSitemapEntries(),
  ]);
  return buildSitemapResponse(renderUrlSet([...usEntries, ...sgEntries]));
}
