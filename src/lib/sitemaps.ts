import { getAllBlogPosts } from "@/lib/blog";
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

const STATIC_SITEMAP_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/docs", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/developers", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/agents", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/blog", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/blog/cheapest-iphone-singapore-2026", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/blog/best-laptop-deals-singapore", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/blog/compare-headphones-singapore-2026", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/blog/home-appliance-deals-singapore-2026", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/blog/compare-product-prices-singapore-2026", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/quickstart", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/integrate", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/api-keys", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/docs/API_DOCUMENTATION", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/docs/quickstart-mcp", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/docs/developer-quickstart-sea-shopping-agent", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/docs/agent-onboarding-flow", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/docs/rate-limits", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/us", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/us/signup", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/merchants", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/partnership", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/partners", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/best-gaming-laptops-us", priority: 0.9, changeFrequency: "weekly" as const },
  // BUY-45870: 35 additional static /best-{slug}-us pages (all verified 200 in prod)
  { path: "/best-air-fryers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-blenders-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-cameras-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-coffee-makers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-drones-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-earbuds-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-fitness-trackers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-gaming-consoles-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-gaming-monitors-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-headphones-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-ipads-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-iphones-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-laptops-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-mattresses-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-monitors-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-office-chairs-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-robot-vacuums-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-smartwatches-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-soundbars-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-tvs-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-vacuum-cleaners-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-4k-monitors-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-wireless-earbuds-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-dehumidifiers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-dishwashers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-fans-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-french-door-refrigerators-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-mechanical-keyboards-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-microphones-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-microwaves-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-outdoor-furniture-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-portable-ac-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-printers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-rice-cookers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-smart-speakers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-webcams-us", priority: 0.9, changeFrequency: "weekly" as const },
  // BUY-45942: 26 additional static /best-{slug}-us pages (all verified 200 in prod)
  { path: "/best-bluetooth-speakers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-bread-makers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-ceiling-fans-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-cookware-sets-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-drawing-tablets-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-electric-grills-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-electric-kettles-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-food-dehydrators-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-food-processors-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-knife-sets-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-macbooks-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-mirrorless-cameras-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-nas-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-personal-blenders-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-power-banks-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-pressure-cookers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-single-serve-coffee-makers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-slow-cookers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-sofas-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-space-heaters-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-streaming-devices-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-tv-stands-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-ultrabooks-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-washing-machines-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-wifi-routers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-wine-coolers-us", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/iphone-16-price-singapore", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/laptop-singapore", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/air-purifier-singapore", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best-robot-vacuums-2026", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/mcp-ecommerce", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/challenge", priority: 0.9, changeFrequency: "daily" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
] as const;

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

  const addEntry = (path: string, priority = 0.8) => {
    entries.set(path, {
      url: toSiteUrl(path),
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
