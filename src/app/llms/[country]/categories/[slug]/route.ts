// BUY-70312: crawlable per-category llms.txt surface.
//
// GET /llms/<cc>/categories/<slug>.txt → text/plain; charset=utf-8
//
// Mirrors the inline <script type="text/llms.txt"> block emitted by the
// category landing pages (src/app/categories/**/page.tsx).

import {
  CATEGORY_SITEMAP_COUNTRIES,
  formatCategoryName,
  getApiCategoryBySlug,
} from "@/lib/sitemaps";
import { renderCategoryLlmsSnippet } from "@/lib/llms-snippets";

export const dynamic = "force-dynamic";

const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  sg: "Singapore",
  my: "Malaysia",
  th: "Thailand",
  id: "Indonesia",
  ph: "Philippines",
  vn: "Vietnam",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ country: string; slug: string }> },
) {
  const { country, slug } = await params;
  const cc = country.toLowerCase();
  if (!CATEGORY_SITEMAP_COUNTRIES.includes(cc as (typeof CATEGORY_SITEMAP_COUNTRIES)[number])) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Accept both /llms/<cc>/categories/<slug> and <slug>.txt
  const categorySlug = decodeURIComponent(slug.replace(/\.txt$/i, ""));

  const category = await getApiCategoryBySlug(categorySlug);
  if (!category) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const categoryName = formatCategoryName(category.slug, category.name);
  const countryLabel = COUNTRY_LABELS[cc];

  const body = renderCategoryLlmsSnippet({
    country: cc,
    slug: category.slug,
    name: categoryName,
    description: `Compare ${categoryName.toLowerCase()} products and prices available in ${countryLabel}.`,
    productCount: category.product_count ?? null,
    sampleQueries: [
      categoryName,
      `best ${categoryName.toLowerCase()}`,
      `cheapest ${categoryName.toLowerCase()}`,
    ],
    url: `https://buywhere.ai/categories/${category.slug}/${cc}`,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
