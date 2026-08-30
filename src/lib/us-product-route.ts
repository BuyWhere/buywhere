import { buildUSProductSlug, getUSProducts } from "@/lib/us-products";

export interface ResolvedUSProductRoute {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

/**
 * Build a safe /search?q=...&country=us fallback path from a product URL slug.
 *
 * Used when `resolveUSProductRoute()` can't load the US product catalog
 * (e.g. the BuyWhere API now requires `BUYWHERE_API_KEY`, which may not yet be
 * configured in this deploy — BUY-52332 cutover). Returning a search URL keeps
 * the user on a real, useful page (live merchant offers + working buy CTAs)
 * instead of dropping them on a misleading "Product Not Found" state.
 */
export function slugToSearchRedirect(slug: string): string {
  const cleaned = decodeURIComponent(slug)
    .toLowerCase()
    .replace(/-[\da-f]{6,}$/i, "") // strip trailing `-<id>` (buildUSProductSlug appends `-${id}`)
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const query = cleaned.replace(/-/g, " ").trim();
  const params = new URLSearchParams();
  params.set("q", query || cleaned);
  params.set("country", "us");
  return `/search?${params.toString()}`;
}

export async function resolveUSProductRoute(param: string): Promise<ResolvedUSProductRoute | null> {
  const products = await getUSProducts();
  const normalizedParam = decodeURIComponent(param).toLowerCase();

  // Empty catalog (API key missing / API down) — don't pretend the slug exists,
  // but also don't force a 404. Let the caller fall back to slugToSearchRedirect.
  if (products.length === 0) {
    return null;
  }

  const directMatch = products.find((product) => product.id.toLowerCase() === normalizedParam);
  if (directMatch) {
    return directMatch;
  }

  const slugMatch = products.find((product) => product.slug.toLowerCase() === normalizedParam);
  if (slugMatch) {
    return slugMatch;
  }

  const suffixMatch = products.find((product) => normalizedParam.endsWith(`-${product.id.toLowerCase()}`));
  if (suffixMatch) {
    return {
      ...suffixMatch,
      slug: buildUSProductSlug(suffixMatch),
    };
  }

  return null;
}
