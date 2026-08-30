import { buildSGProductSlug, getSGProducts } from "@/lib/sg-products";

export interface ResolvedSGProductRoute {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

export async function resolveSGProductRoute(param: string): Promise<ResolvedSGProductRoute | null> {
  const products = await getSGProducts();
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
      slug: buildSGProductSlug(suffixMatch),
    };
  }

  return null;
}
