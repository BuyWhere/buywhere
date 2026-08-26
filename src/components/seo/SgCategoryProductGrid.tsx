import CategoryProductGrid from "@/components/seo/CategoryProductGrid";
import { categorySlugToSearchQuery, fetchCategoryProducts } from "@/lib/category-products";

export default async function SgCategoryProductGrid({ slug, name }: { slug: string; name: string }) {
  const products = await fetchCategoryProducts(categorySlugToSearchQuery(slug), "SG", 12);
  return <CategoryProductGrid products={products} category={name} country="SG" />;
}
