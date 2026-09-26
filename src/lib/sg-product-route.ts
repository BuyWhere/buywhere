/**
 * BUY-84237: product route resolution for SG pages.
 *
 * Supports both:
 * - Single-segment: /products/sg/{slug}     (backward compat; returns null → 410)
 * - 2-segment:     /products/sg/{merchant}/{id}  (canonical sitemap form)
 */
import { getSGProducts, buildSGProductSlug, type SGProductForSitemap } from "@/lib/sg-products";

export interface ResolvedSGProductRoute {
  id: string;
  name: string;
  slug: string;
  merchantId: string;
  merchantSlug: string;
  lastUpdated: string;
}

export async function resolveSGProductRoute(param: string): Promise<ResolvedSGProductRoute | null> {
  const products = await getSGProducts();
  const normalizedParam = decodeURIComponent(param).toLowerCase();

  // Direct ID match
  const directMatch = products.find((p) => p.id.toLowerCase() === normalizedParam);
  if (directMatch) return toResolved(directMatch);

  // Full slug match ({name}-{id} form)
  const slugMatch = products.find((p) => p.slug.toLowerCase() === normalizedParam);
  if (slugMatch) return toResolved(slugMatch);

  // Suffix match: param ends with -{id}
  const suffixMatch = products.find((p) =>
    normalizedParam.endsWith(`-${p.id.toLowerCase()}`),
  );
  if (suffixMatch) {
    return {
      ...toResolved(suffixMatch),
      slug: buildSGProductSlug(suffixMatch),
    };
  }

  return null;
}

/** BUY-84237: resolve 2-segment /products/sg/{merchantSlug}/{id}. */
export async function resolveSGProductRoute2Seg(
  merchantSlugParam: string,
  productIdParam: string,
): Promise<ResolvedSGProductRoute | null> {
  const products = await getSGProducts();
  const normalizedMerchant = decodeURIComponent(merchantSlugParam).toLowerCase();
  const normalizedId = decodeURIComponent(productIdParam).toLowerCase();

  const match = products.find(
    (p) =>
      p.id.toLowerCase() === normalizedId &&
      p.merchantSlug.toLowerCase() === normalizedMerchant,
  );
  if (match) return toResolved(match);

  // Fallback: match by ID only (handles slug format mismatches)
  const idMatch = products.find((p) => p.id.toLowerCase() === normalizedId);
  if (idMatch) return toResolved(idMatch);

  return null;
}

function toResolved(product: SGProductForSitemap): ResolvedSGProductRoute {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    merchantId: product.merchantId,
    merchantSlug: product.merchantSlug,
    lastUpdated: product.lastUpdated,
  };
}
