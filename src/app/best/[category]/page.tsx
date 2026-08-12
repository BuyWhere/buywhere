import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Params = Promise<{ category: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { category } = await params;
  // Intentional 404 with route-specific title (no homepage metadata inheritance).
  return {
    title: `Page Not Found: /best/${category} — BuyWhere`,
    description: "The requested /best route is not available. Browse category hubs at /best or use search to find products.",
    robots: { index: false, follow: true },
  };
}

export default async function UnsupportedBestPage({ params }: { params: Params }) {
  await params;
  notFound();
}
