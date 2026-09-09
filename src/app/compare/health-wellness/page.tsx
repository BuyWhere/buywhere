import dynamic from "next/dynamic";
import { buildCompareCategoryMetadata } from "@/lib/seo-category-metadata";

const ProductComparisonPage = dynamic(
  () => import("@/components/ProductComparison"),
  {
    ssr: true,
    loading: () => (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-gray-400">Loading comparison...</div>
      </div>
    ),
  }
);

export default function HealthWellnessPage() {
  return <ProductComparisonPage params={{ category: "health-wellness" }} />;
}

export const metadata = buildCompareCategoryMetadata("health-wellness");

export async function generateStaticParams() {
  return [{ category: "health-wellness" }];
}
