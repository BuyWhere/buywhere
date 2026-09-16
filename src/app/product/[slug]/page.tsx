import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShortAliasProductPage, {
  generateMetadata as generateShortAliasMetadata,
} from "@/app/p/[id]/page";
import { resolveLegacyProductSlug } from "@/lib/legacy-product-slug";

const API_INTERNAL_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai"
).replace(/\/$/, "");
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function resolveSlugToId(slug: string): Promise<string | null> {
  const hit = await resolveLegacyProductSlug(slug, {
    apiBase: API_INTERNAL_URL,
    apiKey: API_KEY,
  });
  return hit?.id ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const id = await resolveSlugToId(slug);
  if (!id) {
    return { title: "Product Not Found", robots: { index: false, follow: false } };
  }
  return generateShortAliasMetadata({ params: Promise.resolve({ id }) });
}

export default async function LegacyProductSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const id = await resolveSlugToId(slug);
  if (!id) {
    notFound();
  }
  return ShortAliasProductPage({ params: Promise.resolve({ id }) });
}
