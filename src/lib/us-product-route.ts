import { buildUSProductSlug, getUSProducts } from "@/lib/us-products";

export interface ResolvedUSProductRoute {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

export async function resolveUSProductRoute(param: string): Promise<ResolvedUSProductRoute | null> {
  const products = await getUSProducts();
  const normalizedParam = decodeURIComponent(param).toLowerCase();

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
