import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Params = Promise<{ product: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { product } = await params;
  // Intentional 404 with route-specific title (no homepage metadata inheritance).
  return {
    title: `Page Not Found: /cheapest/${product} — BuyWhere`,
    description: "The requested /cheapest route is not available. Browse price-first hubs at /cheapest or use search to find products.",
    robots: { index: false, follow: true },
  };
}

export default async function UnsupportedCheapestPage({ params }: { params: Params }) {
  await params;
  notFound();
}
