import { getAllBlogPosts } from "@/lib/blog";
import { seoLandingPages } from "@/lib/seo-landing-pages";
import { PRODUCT_TAXONOMY, US_CATEGORY_META } from "@/lib/taxonomy";
import { getUSProducts, type USProductForSitemap } from "@/lib/us-products";
import { getSGProducts, type SGProductForSitemap } from "@/lib/sg-products";
import { toSiteUrl } from "@/lib/site-url";
import fs from "node:fs";

function safeGetBlogPosts() {
  try {
    if (fs.existsSync(process.cwd() + "/content/blog")) {
      return getAllBlogPosts();
    }
  } catch {
    // blog directory not available at runtime
  }
  return [];
}

export const SITEMAP_BASE_URL = "https://buywhere.ai";
export const MAX_URLS_PER_SITEMAP = 50_000;

type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapUrlEntry {
  url: string;
  lastModified: Date | string;
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

const CATEGORY_PAGE_SLUGS = [
  "automotive",
  "beauty-health",
  "books-stationery",
  "electronics",
  "fashion",
  "food-beverages",
  "garden-outdoor",
  "grocery",
  "health-wellness",
  "home-living",
  "pet-supplies",
  "sports-outdoors",
  "toys-games",
] as const;

// Core static pages (non-SEO)
const CORE_SITEMAP_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/docs", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/developers", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/agents", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/blog", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/quickstart", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/integrate", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/api-keys", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/us", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/us/signup", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/merchants", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/partnership", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/partners", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/mcp-ecommerce", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/challenge", priority: 0.9, changeFrequency: "daily" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/affiliate-disclosure", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/faq", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/directory", priority: 0.6, changeFrequency: "weekly" as const },
  { path: "/retailers", priority: 0.6, changeFrequency: "weekly" as const },
  { path: "/deals/us", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/affiliates", priority: 0.6, changeFrequency: "monthly" as const },
] as const;

// All SEO landing page slugs from config — dynamically included in sitemap
const SEO_LANDING_PAGE_SLUGS = Object.keys(seoLandingPages);

// Combined static routes = core pages + all SEO landing pages
const STATIC_SITEMAP_ROUTES = [
  ...CORE_SITEMAP_ROUTES,
  ...SEO_LANDING_PAGE_SLUGS.map((slug) => ({
    path: `/${slug}`,
    priority: 0.8 as const,
    changeFrequency: "weekly" as const,
  })),
];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatLastMod(value: Date | string): string {
  return new Date(value).toISOString();
}

export function buildSitemapResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

export function renderUrlSet(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map((entry) => {
      const lines = [
        "  <url>",
        `    <loc>${xmlEscape(entry.url)}</loc>`,
        `    <lastmod>${formatLastMod(entry.lastModified)}</lastmod>`,
      ];

      if (entry.changeFrequency) {
        lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      }

      if (entry.priority !== undefined) {
        lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }

      lines.push("  </url>");
      return lines.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

export function renderSitemapIndex(urls: Array<{ url: string; lastModified: Date | string }>): string {
  const body = urls
    .map(
      (entry) => `  <sitemap>
    <loc>${xmlEscape(entry.url)}</loc>
    <lastmod>${formatLastMod(entry.lastModified)}</lastmod>
  </sitemap>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>`;
}

export function getStaticSitemapEntries(): SitemapUrlEntry[] {
  const now = new Date();
  const blogPosts = safeGetBlogPosts();

  return [
    ...STATIC_SITEMAP_ROUTES.map(({ path, priority, changeFrequency }) => ({
      url: toSiteUrl(path),
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...blogPosts.map((post) => ({
      url: toSiteUrl(`/blog/${post.slug}`),
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}

export function getCategorySitemapEntries(): SitemapUrlEntry[] {
  const now = new Date();
  const entries = new Map<string, SitemapUrlEntry>();

  // Category URLs use trailing slashes — aligns with the URL Google actually crawls
  // (middleware rewrites /path/ to /path internally, so trailing slash is the crawled form).
  const addEntry = (path: string, priority = 0.8) => {
    const trailingPath = path === "/" ? path : path.endsWith("/") ? path : `${path}/`;
    entries.set(path, {
      url: `${SITEMAP_BASE_URL}${trailingPath}`,
      lastModified: now,
      changeFrequency: "daily",
      priority,
    });
  };

  addEntry("/categories", 0.9);
  addEntry("/compare", 0.9);
  addEntry("/compare/us", 0.9);

  for (const slug of CATEGORY_PAGE_SLUGS) {
    addEntry(`/categories/${slug}`, 0.8);
  }

  for (const category of PRODUCT_TAXONOMY) {
    addEntry(`/compare/${category.slug}`, 0.8);
  }

  for (const slug of Object.keys(US_CATEGORY_META)) {
    addEntry(`/us/category/${slug}`, 0.8);
  }

  return Array.from(entries.values());
}

export function getCompareSitemapEntries(): SitemapUrlEntry[] {
  const now = new Date();
  const entries = new Map<string, SitemapUrlEntry>();

  const addEntry = (path: string, priority = 0.8) => {
    entries.set(path, {
      url: toSiteUrl(path),
      lastModified: now,
      changeFrequency: "daily",
      priority,
    });
  };

  addEntry("/compare", 0.9);
  addEntry("/compare/us", 0.9);

  for (const category of PRODUCT_TAXONOMY) {
    addEntry(`/compare/${category.slug}`, 0.8);
  }

  return Array.from(entries.values());
}

export async function getProductSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const products = await getUSProducts({ allowMockFallback: false });

  return products.map((product: USProductForSitemap) => ({
    url: toSiteUrl(`/products/us/${product.slug}`),
    lastModified: product.lastUpdated,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
}

export async function getProductSitemapChunkCount(): Promise<number> {
  const products = await getUSProducts({ allowMockFallback: false });
  return Math.max(1, Math.ceil(products.length / MAX_URLS_PER_SITEMAP));
}

export async function getProductSitemapChunk(page: number): Promise<SitemapUrlEntry[]> {
  const products = await getProductSitemapEntries();
  const start = (page - 1) * MAX_URLS_PER_SITEMAP;
  return products.slice(start, start + MAX_URLS_PER_SITEMAP);
}

export async function getSGProductSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const products = await getSGProducts({ allowMockFallback: false });

  return products.map((product: SGProductForSitemap) => ({
    url: toSiteUrl(`/products/sg/${product.slug}`),
    lastModified: product.lastUpdated,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
}

export async function getSGProductSitemapChunkCount(): Promise<number> {
  const products = await getSGProducts({ allowMockFallback: false });
  return Math.max(1, Math.ceil(products.length / MAX_URLS_PER_SITEMAP));
}

export async function getSGProductSitemapChunk(page: number): Promise<SitemapUrlEntry[]> {
  const products = await getSGProductSitemapEntries();
  const start = (page - 1) * MAX_URLS_PER_SITEMAP;
  return products.slice(start, start + MAX_URLS_PER_SITEMAP);
}

interface MerchantRecord {
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  onboarding_stage: string;
}

function deriveMerchantSlug(merchant: MerchantRecord): string {
  const id = merchant.id;
  const country = merchant.country.toLowerCase();
  if (id.includes(".")) {
    const cleaned = id.replace(/^www\./, "");
    const mainPart = cleaned.split(".")[0].toLowerCase();
    return `${mainPart}-${country}`;
  }
  const nameSlug = merchant.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${nameSlug}-${country}`;
}

async function fetchIngestedMerchants(
  country: string
): Promise<MerchantRecord[]> {
  const baseUrl =
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    "https://api.buywhere.ai";
  const apiKey =
    process.env.BUYWHERE_API_KEY ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
    "";
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  const merchants: MerchantRecord[] = [];
  let offset = 0;
  const limit = 500;

  try {
    while (true) {
      const res = await fetch(
        `${baseUrl}/v1/merchants?country=${country}&onboarding_stage=ingested&is_active=true&limit=${limit}&offset=${offset}`,
        { headers, cache: "no-store", signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) break;
      const data = (await res.json()) as {
        merchants?: MerchantRecord[];
        has_more?: boolean;
      };
      const batch = data.merchants ?? [];
      merchants.push(...batch);
      if (!data.has_more || batch.length < limit) break;
      offset += limit;
    }
  } catch {}

  return merchants;
}

export async function getMerchantListingSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const now = new Date();
  const entries: SitemapUrlEntry[] = [];

  const sgMerchants = await fetchIngestedMerchants("SG");
  for (const merchant of sgMerchants) {
    if (!merchant.is_active) continue;
    const slug = deriveMerchantSlug(merchant);
    const country = merchant.country.toLowerCase();
    entries.push({
      url: `${SITEMAP_BASE_URL}/${country}/${slug}/products/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  return entries;
}
