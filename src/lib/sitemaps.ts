import { getAllBlogPosts } from "@/lib/blog";
import { PRODUCT_TAXONOMY, US_CATEGORY_META } from "@/lib/taxonomy";
import { getUSProducts, type USProductForSitemap } from "@/lib/us-products";
import { getSGProducts, type SGProductForSitemap } from "@/lib/sg-products";
import { toSiteUrl } from "@/lib/site-url";
import { seoLandingPages } from "@/lib/seo-landing-pages";
import { getStoredPageLastmod } from "@/lib/page-content-hash";
import fs from "node:fs";
import path from "node:path";

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

// BUY-63866 / BUY-72089: read the latest sitemap-lastmod-override-*.json file
// (written daily by scripts/update-sitemap-lastmod.mjs) and return a Map<url,
// lastmod>. The override only contains URLs from the indexing queue — it tells
// Googlebot "these URLs were touched recently, please re-crawl." When the
// override is older than 24h we fall back to the natural lastUpdated so a
// stuck cron doesn't pin stale dates in the sitemap indefinitely.
//
// Module-scope memoization (1h TTL) follows the same pattern as merchantCache
// below: the routes are force-dynamic, so Next.js's data cache is bypassed.
const LASTMOD_OVERRIDE_TTL_MS = 60 * 60 * 1000;
const LASTMOD_OVERRIDE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let cachedLastmodOverride: { urls: Map<string, string>; fetchedAt: number } | null = null;

function readLastmodOverrideFile(filePath: string): { urls: Map<string, string>; date: string | null } | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      date?: string;
      lastmod?: string;
      urls?: string[];
    };
    if (!parsed || !Array.isArray(parsed.urls) || typeof parsed.lastmod !== "string") {
      return null;
    }
    const urls = new Map<string, string>();
    for (const u of parsed.urls) {
      if (typeof u !== "string") continue;
      const trimmed = u.trim();
      if (!trimmed) continue;
      urls.set(trimmed, parsed.lastmod);
    }
    return { urls, date: parsed.date ?? null };
  } catch {
    return null;
  }
}

function readLatestLastmodOverride(): Map<string, string> {
  const now = Date.now();
  if (cachedLastmodOverride && now - cachedLastmodOverride.fetchedAt < LASTMOD_OVERRIDE_TTL_MS) {
    return cachedLastmodOverride.urls;
  }

  const auditsDir = path.join(process.cwd(), "content", "audits");
  let latest: { urls: Map<string, string>; mtimeMs: number; isoDate: string } | null = null;

  try {
    const entries = fs.readdirSync(auditsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^sitemap-lastmod-override-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const filePath = path.join(auditsDir, entry.name);
      const stat = fs.statSync(filePath);
      const parsed = readLastmodOverrideFile(filePath);
      if (!parsed) continue;
      const isoDate = match[1];
      if (
        !latest ||
        isoDate > latest.isoDate ||
        (isoDate === latest.isoDate && stat.mtimeMs > latest.mtimeMs)
      ) {
        latest = { urls: parsed.urls, mtimeMs: stat.mtimeMs, isoDate };
      }
    }
  } catch {
    // audits dir missing or unreadable; treat as no override.
  }

  const urls = latest?.urls ?? new Map<string, string>();

  // Discard stale overrides (>24h old by iso date) so a wedged cron doesn't
  // hold lastmod pinned at a date Google has already considered fresh.
  if (latest) {
    const today = new Date().toISOString().slice(0, 10);
    const ageDays = daysBetweenIsoDates(latest.isoDate, today);
    if (ageDays * 24 * 60 * 60 * 1000 > LASTMOD_OVERRIDE_MAX_AGE_MS) {
      cachedLastmodOverride = { urls: new Map(), fetchedAt: now };
      return cachedLastmodOverride.urls;
    }
  }

  cachedLastmodOverride = { urls, fetchedAt: now };
  return cachedLastmodOverride.urls;
}

function daysBetweenIsoDates(a: string, b: string): number {
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return 0;
  return Math.abs(bMs - aMs) / (24 * 60 * 60 * 1000);
}

function applyLastmodOverride(
  entries: SitemapUrlEntry[],
  overrides: Map<string, string>,
): SitemapUrlEntry[] {
  if (overrides.size === 0) return entries;
  return entries.map((entry) => {
    const override = overrides.get(entry.url);
    if (!override) return entry;
    return { ...entry, lastModified: override };
  });
}

// BUY-63866: sidecar slice of recently-updated US products. Written by
// scripts/update-sitemap-lastmod.mjs to content/audits/sitemap-products-recent-*.json
// from the same DB query that builds the indexing queue. The sitemap route
// appends these entries to its base list so the URLs that actually changed
// get a fresh <lastmod>. (The base /v1/products?country_code=US sitemap only
// emits the first page of an unpaginated API response — see
// src/lib/us-products.ts fetchUSProductPage — so it doesn't see the recent
// rows on its own.)
let cachedRecentSlice: { entries: SitemapUrlEntry[]; fetchedAt: number; isoDate: string } | null = null;

function readRecentProductsSlice(): SitemapUrlEntry[] {
  const now = Date.now();
  if (cachedRecentSlice && now - cachedRecentSlice.fetchedAt < LASTMOD_OVERRIDE_TTL_MS) {
    return cachedRecentSlice.entries;
  }

  const auditsDir = path.join(process.cwd(), "content", "audits");
  let latest: { entries: SitemapUrlEntry[]; mtimeMs: number; isoDate: string } | null = null;

  try {
    const entries = fs.readdirSync(auditsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^sitemap-products-recent-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const filePath = path.join(auditsDir, entry.name);
      const stat = fs.statSync(filePath);
      let parsed: { entries?: unknown[]; lastmod?: string } | null = null;
      try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.entries)) continue;
      const sliceEntries: SitemapUrlEntry[] = [];
      for (const e of parsed.entries) {
        if (!e || typeof e !== "object") continue;
        const rec = e as { url?: string; lastModified?: string; changeFrequency?: SitemapUrlEntry["changeFrequency"]; priority?: number };
        if (typeof rec.url !== "string") continue;
        sliceEntries.push({
          url: rec.url,
          lastModified: rec.lastModified ?? parsed.lastmod ?? new Date().toISOString(),
          changeFrequency: rec.changeFrequency,
          priority: typeof rec.priority === "number" ? rec.priority : 0.7,
        });
      }
      const isoDate = match[1];
      if (
        !latest ||
        isoDate > latest.isoDate ||
        (isoDate === latest.isoDate && stat.mtimeMs > latest.mtimeMs)
      ) {
        latest = { entries: sliceEntries, mtimeMs: stat.mtimeMs, isoDate };
      }
    }
  } catch {
    // audits dir missing or unreadable; treat as empty slice.
  }

  // Stale-slice guard (same 24h cutoff as the override file).
  if (latest) {
    const today = new Date().toISOString().slice(0, 10);
    const ageDays = daysBetweenIsoDates(latest.isoDate, today);
    if (ageDays * 24 * 60 * 60 * 1000 > LASTMOD_OVERRIDE_MAX_AGE_MS) {
      cachedRecentSlice = { entries: [], fetchedAt: now, isoDate: today };
      return cachedRecentSlice.entries;
    }
  }

  cachedRecentSlice = {
    entries: latest?.entries ?? [],
    fetchedAt: now,
    isoDate: latest?.isoDate ?? new Date().toISOString().slice(0, 10),
  };
  return cachedRecentSlice.entries;
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
  lastModified?: Date | string; // omit when unknown — a fake lastmod is worse than none
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

// Only slugs that resolve via getCategoryBySlug (PRODUCT_TAXONOMY) are listed.
// Removed soft-404 slugs flagged in BUY-39762 / BUY-41940:
//   - books-stationery, garden-outdoor (noindex Category Not Found template)
//   - sports-outdoors, pet-supplies (404 / alternate page)
const CATEGORY_PAGE_SLUGS = [
  "automotive",
  "baby-products",
  "beauty-health",
  "books-stationery",
  "electronics",
  "fashion",
  "food-beverages",
  "grocery",
  "health-beauty",
  "health-wellness",
  "home-kitchen",
  "home-living",
  "sports-outdoors",
  "toys-games",
] as const;

// BUY-65150 fallback derived from the verified 2026-07-29 /v1/categories
// response. The endpoint currently returns at most 50 records, and the site API
// key can hit its daily limit before a crawler requests the sitemap. Keeping the
// normalized slugs here prevents the expanded sitemap and category-country pages
// from collapsing to the old 28-URL set during that rate-limit window.
const CATEGORY_API_FALLBACK_SLUGS = [
  "accessories",
  "appliances",
  "audio",
  "automotive",
  "baby-kids",
  "beauty-health",
  "books-stationery",
  "cameras",
  "computers",
  "electronics",
  "fashion",
  "food-beverages",
  "furniture",
  "gaming",
  "garden-outdoor",
  "grocery",
  "health-wellness",
  "home-living",
  "home-office",
  "household",
  "jewelry-watches",
  "kitchen-dining",
  "laptops",
  "mobile-phones",
  "music",
  "office-supplies",
  "personal-care",
  "pet-supplies",
  "phones",
  "photography",
  "shoes",
  "smart-home",
  "software",
  "sports-outdoors",
  "tablets",
  "tools-home-improvement",
  "toys-games",
  "travel",
  "tv-video",
  "video-games",
  "wearables",
  "women-fashion",
  "womens-fashion",
] as const;


export interface ApiCategoryRecord {
  slug: string;
  name: string;
  product_count?: number;
}

export const CATEGORY_SITEMAP_COUNTRIES = ["us", "sg", "my", "hk", "th", "id", "ph", "vn"] as const;

export function formatCategoryName(slug: string, fallback?: string): string {
  return (fallback || slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export interface PopulatedCompareCategory {
  slug: string;
  name: string;
  productCount: number;
}

export interface CompareCategoryPair {
  left: PopulatedCompareCategory;
  right: PopulatedCompareCategory;
}

function normalizeCategorySlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function fetchCategories(currency: string): Promise<PopulatedCompareCategory[]> {
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

  try {
    const res = await fetch(`${baseUrl}/v1/categories?currency=${currency}`, {
      headers,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sitemap] fetchCategories currency=${currency} base=${baseUrl} auth=${apiKey ? "yes" : "no"} status=${res.status}`
      );
      return [];
    }
    const data = (await res.json()) as { data?: ApiCategoryRecord[] };
    return (data.data ?? [])
      .map((category) => {
        const slug = normalizeCategorySlug(category.slug || category.name || "");
        return {
          slug,
          name: category.name || titleizeSlug(slug),
          productCount: Number(category.product_count ?? 0),
        };
      })
      .filter((category) => category.slug && category.productCount > 0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sitemap] fetchCategories currency=${currency} threw: ${(err as Error)?.message ?? err}`
    );
    return [];
  }
}

export async function fetchApiCategories(): Promise<ApiCategoryRecord[]> {
  const categories = (await Promise.all([fetchCategories("SGD"), fetchCategories("USD")])).flat();
  const bySlug = new Map<string, ApiCategoryRecord>();

  for (const category of categories) {
    if (!category.slug || category.slug === "uncategorized") continue;
    const existing = bySlug.get(category.slug);
    if (!existing || category.productCount > (existing.product_count ?? 0)) {
      bySlug.set(category.slug, {
        slug: category.slug,
        name: category.name || formatCategoryName(category.slug),
        product_count: category.productCount,
      });
    }
  }

  if (bySlug.size === 0) {
    // Keep category-country pages and the sitemap available during API rate-limit
    // windows. These slugs come from the last verified API response and are
    // normalized through the same path as live records.
    for (const fallbackSlug of CATEGORY_API_FALLBACK_SLUGS) {
      const slug = normalizeCategorySlug(fallbackSlug);
      if (!slug || slug === "uncategorized") continue;
      bySlug.set(slug, {
        slug,
        name: formatCategoryName(slug),
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

// BUY-77803 / BUY-78651: /categories/laptops/{country} is a public SEO alias of
// computers. /v1/categories is hard-capped at 50 by product_count, so `laptops`
// is often missing from the live list even though the sitemap still emits it.
const CATEGORY_SLUG_ALIASES: Record<string, string> = {
  laptops: "computers",
  laptop: "computers",
};

export async function getApiCategoryBySlug(slug: string): Promise<ApiCategoryRecord | null> {
  const normalizedSlug = normalizeCategorySlug(slug);
  const categories = await fetchApiCategories();
  const direct = categories.find((category) => category.slug === normalizedSlug);
  if (direct) return direct;

  const aliasTarget = CATEGORY_SLUG_ALIASES[normalizedSlug];
  if (aliasTarget) {
    const canonical = categories.find((category) => category.slug === aliasTarget);
    if (canonical) {
      return {
        ...canonical,
        slug: normalizedSlug,
        name: formatCategoryName(normalizedSlug, canonical.name),
      };
    }
    return {
      slug: normalizedSlug,
      name: formatCategoryName(normalizedSlug),
    };
  }

  // Last-resort: sitemap-emitted fallback slugs must still resolve to a page
  // even when the live top-50 list dropped them (BUY-78651).
  if ((CATEGORY_API_FALLBACK_SLUGS as readonly string[]).includes(normalizedSlug)) {
    return {
      slug: normalizedSlug,
      name: formatCategoryName(normalizedSlug),
    };
  }
  return null;
}

export async function getPopulatedCompareCategories(): Promise<PopulatedCompareCategory[]> {
  const bySlug = new Map<string, PopulatedCompareCategory>();
  const apiCategories = (await Promise.all([fetchCategories("SGD"), fetchCategories("USD")])).flat();

  for (const category of apiCategories) {
    const existing = bySlug.get(category.slug);
    if (!existing || category.productCount > existing.productCount) {
      bySlug.set(category.slug, category);
    }
  }

  if (bySlug.size === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[sitemap] /v1/categories returned no populated categories; falling back to static PRODUCT_TAXONOMY compare categories"
    );
    for (const category of PRODUCT_TAXONOMY) {
      bySlug.set(category.slug, {
        slug: category.slug,
        name: category.name,
        productCount: 1,
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );
}

export async function getCompareCategoryPairs(): Promise<CompareCategoryPair[]> {
  const categories = await getPopulatedCompareCategories();
  const pairs: CompareCategoryPair[] = [];

  for (let i = 0; i < categories.length; i += 1) {
    for (let j = i + 1; j < categories.length; j += 1) {
      pairs.push({ left: categories[i], right: categories[j] });
    }
  }

  return pairs;
}

export function compareCategoryPairSlug(pair: CompareCategoryPair): string {
  return `${pair.left.slug}-vs-${pair.right.slug}`;
}

export async function findCompareCategoryPair(slug: string): Promise<CompareCategoryPair | null> {
  const pairs = await getCompareCategoryPairs();
  return pairs.find((pair) => compareCategoryPairSlug(pair) === slug) ?? null;
}

const STATIC_SITEMAP_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/docs", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/developers", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/agents", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/blog", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/best", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/cheapest", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/quickstart", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/integrate", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/api-keys", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/us", priority: 0.8, changeFrequency: "weekly" as const },
  // BUY-65100: /us/signup canonicalizes to /us and has no dedicated route,
  // so keep it out of sitemap-pages.xml to avoid sitemap/canonical contradiction.
  { path: "/merchants", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/partnership", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/partners", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" as const },
  // BUY-56627 / BUY-57452: /best-* URLs and the 6 blog + 3 product
  // dupes (cheapest-iphone-singapore-2026, best-laptop-deals-singapore,
  // best-gaming-laptops-us-2026, compare-headphones-singapore-2026,
  // home-appliance-deals-singapore-2026, compare-product-prices-singapore-2026,
  // iphone-16-price-singapore, laptop-singapore, air-purifier-singapore) were
  // removed from STATIC_SITEMAP_ROUTES because they are already emitted by
  // either the seoLandingPages registry (line ~262) or getAllBlogPosts()
  // (line ~190). Keeping them here caused each of those 9 URLs to appear
  // TWICE in sitemap-pages.xml (once with priority 0.9 and once with 0.8).
  { path: "/mcp-ecommerce", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
  // BUY-66281: ChatGPT plugin manifest. Already served at
  // /.well-known/ai-plugin.json with HTTP 200, but zero sitemap references
  // meant zero indexable URL graph signal. Add it here so Google + agent
  // crawlers can find it via sitemap-pages.xml. robots.txt also declares
  // `Plugin: /.well-known/ai-plugin.json`.
  { path: "/.well-known/ai-plugin.json", priority: 0.8, changeFrequency: "monthly" as const },
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
  // Why no-store (BUY-65147 follow-up):
  //   The previous max-age=3600 / s-maxage=3600 / stale-while-revalidate=86400
  //   policy meant Railway/Hikari edge served a stale sitemap index for up to
  //   24h after a deploy that added/removed sub-sitemaps. That is how the
  //   sitemap-merchants.xml registration kept silently regressing: the deploy
  //   landed on main, the route ran with the new code, but the CDN kept
  //   serving the cached pre-deploy XML body. Sub-sitemap files
  //   (sitemap-pages, -products, -merchants, etc.) keep their own
  //   per-route cache for crawl budget; the *index* must always be fresh.
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

export function renderUrlSet(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map((entry) => {
      const lines = [
        "  <url>",
        `    <loc>${xmlEscape(entry.url)}</loc>`,
        // lastmod only when we actually know one; see getCompareSitemapEntries.
        ...(entry.lastModified ? [`    <lastmod>${formatLastMod(entry.lastModified)}</lastmod>`] : []),
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

// Published docs (served by /docs/[...slug] from the docs/ dir, public:true)
const DOC_SLUGS = [
  "getting-started",
  "authentication",
  "errors",
  "api-reference/bulk",
  "api-reference/categories",
  "api-reference/compare",
  "api-reference/deals",
  "api-reference/get-product",
  "api-reference/price-history",
  "api-reference/search",
  "api-reference/similar",
  "api-reference/webhooks",
  "guides/mastra-integration",
  "guides/mcp-integration",
  "guides/price-comparison",
];

export async function getStaticSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const blogPosts = safeGetBlogPosts();

  // BUY-57452: dedupe by canonical <loc>. When two sources emit the same URL
  // we keep the entry with the HIGHER priority and the NEWER lastModified.
  // This is a safety net on top of the source-level fix that removed the
  // 9 hardcoded duplicates from STATIC_SITEMAP_ROUTES — if a future change
  // re-introduces a double emission, the sitemap stays clean (one <loc>)
  // and a single console.warn surfaces the regression instead of two
  // competing <url> blocks reaching Google Search Console.
  const byUrl = new Map<string, SitemapUrlEntry>();
  const dupes: string[] = [];
  const upsert = (entry: SitemapUrlEntry) => {
    const existing = byUrl.get(entry.url);
    if (!existing) {
      byUrl.set(entry.url, entry);
      return;
    }
    dupes.push(entry.url);
    const incomingPriority = entry.priority ?? 0;
    const existingPriority = existing.priority ?? 0;
    if (
      incomingPriority > existingPriority ||
      (incomingPriority === existingPriority &&
        (entry.lastModified ? new Date(entry.lastModified).getTime() : 0) >
          (existing.lastModified ? new Date(existing.lastModified).getTime() : 0))
    ) {
      byUrl.set(entry.url, entry);
    }
  };

  // BUY-74905 (directive §5): for the URL kinds this function owns — static
  // routes, docs, blog posts, seoLandingPages — pull the persisted content
  // hash from the store when one exists. The hash store is the SINGLE SOURCE
  // OF TRUTH for lastmod now: the visible "Updated <date>" / "Last updated
  // <date>" / "Prices checked <date>" text on each page renders the same ISO.
  // Without a store entry, omit lastmod (directive: a missing lastmod is
  // honest; a fake one is a penalty).
  const applyStoreLastmod = async (
    url: string,
    fallback: Date | string | undefined,
  ): Promise<Date | string | undefined> => {
    const stored = await getStoredPageLastmod(url);
    if (stored) return stored.lastmod;
    return fallback;
  };

  // Static routes like `/` and `/about` previously carried `lastModified: now`,
  // which violated directive §5. They are not subject to the directive (no
  // body content to hash), so we now omit lastmod entirely. Sitemaps permit
  // <url> blocks without <lastmod> — Google treats the omission as "unknown".
  for (const { path, priority, changeFrequency } of STATIC_SITEMAP_ROUTES) {
    upsert({
      url: toSiteUrl(path),
      changeFrequency,
      priority,
    });
  }
  for (const slug of DOC_SLUGS) {
    upsert({
      url: toSiteUrl(`/docs/${slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    });
  }
  for (const post of blogPosts) {
    const url = toSiteUrl(`/blog/${post.slug}`);
    // Prefer hash-store entry over frontmatter publishedAt/lastUpdatedAt.
    const frontmatterLast = post.lastUpdatedAt ?? post.publishedAt;
    const finalLast = await applyStoreLastmod(url, new Date(frontmatterLast));
    upsert({
      url,
      lastModified: finalLast,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    });
  }
  // BUY-14269: add all SEO landing pages to sitemap
  for (const slug of Object.keys(seoLandingPages)) {
    const url = toSiteUrl(`/${slug}/`);
    const finalLast = await applyStoreLastmod(url, undefined);
    upsert({
      url,
      lastModified: finalLast,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    });
  }

  if (dupes.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sitemap] getStaticSitemapEntries deduped ${dupes.length} duplicate URL(s): ${dupes.slice(0, 10).join(", ")}${dupes.length > 10 ? "..." : ""}`
    );
  }

  return Array.from(byUrl.values());
}

export async function getCategorySitemapEntries(): Promise<SitemapUrlEntry[]> {
  const now = new Date();
  const entries = new Map<string, SitemapUrlEntry>();

  // Category URLs use the canonical (no trailing slash) form so the sitemap
  // matches <link rel="canonical"> on each page. Trailing-slash form was
  // reconciled to the canonical by Google and flagged as
  // "Page with redirect" / "Duplicate canonical" (BUY-39762, BUY-41940).
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

  for (const category of await fetchApiCategories()) {
    for (const country of CATEGORY_SITEMAP_COUNTRIES) {
      addEntry(`/categories/${category.slug}/${country}`, 0.8);
    }
  }

  // BUY-72121 F4: exclude /compare/* URLs because they are fully owned by
  // sitemap-compare.xml. Without this filter, category hubs like /compare,
  // /compare/electronics, /compare/fashion appear in BOTH files.
  const comparePrefixes = Array.from(entries.keys()).filter((path) =>
    path.startsWith("/compare")
  );
  for (const prefix of comparePrefixes) {
    entries.delete(prefix);
  }

  return Array.from(entries.values());
}

export async function getCompareSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const entries = new Map<string, SitemapUrlEntry>();

  // No lastmod unless the indexing-queue override knows a real one (applied below).
  // Every one of the 958 compare URLs used to carry `lastModified: now` — i.e. the
  // request timestamp — so Google saw 958 pages "modified" on every fetch. Google
  // documents that it stops trusting lastmod when it is consistently wrong, and on
  // 2026-08-25 every category-pair URL sat at "Discovered – currently not indexed"
  // with zero crawls. A missing lastmod is honest; a fake one is a trust penalty.
  const addEntry = (path: string, priority = 0.8) => {
    entries.set(path, {
      url: toSiteUrl(path),
      priority,
    });
  };

  addEntry("/compare", 0.9);
  addEntry("/compare/us", 0.9);

  for (const category of PRODUCT_TAXONOMY) {
    addEntry(`/compare/${category.slug}`, 0.8);
  }

  // SEO-GATE BUY-74904 (indexation directive 2026-08-25 §1C/§9.2): the 946 category-pair
  // URLs (/compare/<cat>-vs-<cat>) are a doorway-page pattern — 220 words of one template,
  // no products, no prices, linked from nowhere. Google's verdict on every one inspected was
  // "Discovered – currently not indexed" with zero crawls, and they diluted crawl budget for
  // the pages that matter. They are removed from the sitemap and set noindex (routes stay
  // live; no 410). Re-add a pair only when it is individually rebuilt to the §6 spec.

  // BUY-74905 (directive §5): before the queue-driven override, apply the
  // content-hash store. A rebuilt-to-spec §6 compare page writes its body
  // hash at render time; the sitemap then emits the same ISO the page's
  // visible "Prices checked <date>" shows. Store entry wins over no-lastmod;
  // the queue override (re-crawl hints for indexing-queue URLs) still wins
  // last, matching its existing semantics.
  const withHash = await Promise.all(
    Array.from(entries.values()).map(async (entry) => {
      const stored = await getStoredPageLastmod(entry.url);
      if (stored) return { ...entry, lastModified: stored.lastmod };
      return entry;
    }),
  );

  return applyLastmodOverride(withHash, readLatestLastmodOverride());
}

export async function getProductSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const products = await getUSProducts();
  const overrides = readLatestLastmodOverride();

  const entries: SitemapUrlEntry[] = products.map((product: USProductForSitemap) => ({
    url: toSiteUrl(`/products/us/${product.slug}`),
    lastModified: product.lastUpdated,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // BUY-63866: append the recently-updated US product slice written daily by
  // scripts/update-sitemap-lastmod.mjs to content/audits/sitemap-products-recent-*.json.
  // The base sitemap (above) only emits the first page of /v1/products?country_code=US
  // because that endpoint's pagination metadata is missing from the response
  // (see src/lib/us-products.ts fetchUSProductPage). Until that's fixed, the
  // queue-driven slice is the only way to make <lastmod> relevant to recently-
  // changed URLs. The dedupe-by-URL keeps the base slice as the source of
  // truth for entries that overlap.
  const recent = readRecentProductsSlice();
  if (recent.length > 0) {
    const seen = new Set(entries.map((entry) => entry.url));
    for (const entry of recent) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      entries.push(entry);
    }
  }

  return applyLastmodOverride(entries, overrides);
}

export async function getProductSitemapChunkCount(): Promise<number> {
  const products = await getUSProducts();
  return Math.max(1, Math.ceil(products.length / MAX_URLS_PER_SITEMAP));
}

export async function getProductSitemapChunk(page: number): Promise<SitemapUrlEntry[]> {
  const products = await getProductSitemapEntries();
  const start = (page - 1) * MAX_URLS_PER_SITEMAP;
  return products.slice(start, start + MAX_URLS_PER_SITEMAP);
}

export async function getSGProductSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const products = await getSGProducts();

  // BWOPS 2026-09-04: emit the 2-segment canonical (/products/sg/<merchant>/<id>).
  // The single-segment slug form is deliberately 410'd by middleware (BUY-37750
  // thin-content de-index, BUY-40757 allows the 2-segment route through) — this
  // sitemap was advertising 4,999 URLs the site intentionally kills, which the
  // post-deploy verifier measured as 100% dead SG sample. Products without a
  // merchant_id are skipped rather than emitted in a form that 410s.
  return products
    .filter((product: SGProductForSitemap) => Boolean(product.merchantId))
    .map((product: SGProductForSitemap) => ({
      url: toSiteUrl(`/products/sg/${product.merchantId}/${product.id}`),
      lastModified: product.lastUpdated,
      changeFrequency: "weekly",
      priority: 0.7,
    }));
}

export async function getSGProductSitemapChunkCount(): Promise<number> {
  const products = await getSGProducts();
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

// In-memory cache for /v1/merchants responses, keyed by country.
//
// Why: the sitemap routes are force-dynamic (so they pick up the runtime
// env: BUYWHERE_API_KEY / BUYWHERE_API_INTERNAL_URL are NOT set in the
// Railway build env, only at runtime). Without a cache, every crawler /
// scraper hit re-ran the 7-regions fan-out and tripped the API's per-key
// rpm limit → 429s on every region → empty <urlset/> (BUY-42890).
//
// Why in-memory and not Next.js data cache: the route is force-dynamic,
// so the data cache is bypassed on every request. A module-scope Map
// keyed by (country, expiresAt) is the simplest thing that actually
// works at runtime.
//
// Why a mutex: when the cache expires, multiple in-flight requests
// would otherwise all start their own /v1/merchants fan-out. The mutex
// dedupes that into a single flight per region, and the rest await the
// same Promise.
//
// Scope: per-Node-process. Railway runs 1 container per service
// instance (auto-scale is OFF for buywhere), so this is effectively
// per-deployment. Cold deploy = empty cache = one warm-up cycle of 7
// API calls, then steady state of 7 calls per hour.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const merchantCache = new Map<
  string,
  { data: MerchantRecord[]; expiresAt: number }
>();
const merchantInflight = new Map<string, Promise<MerchantRecord[]>>();

async function fetchIngestedMerchants(
  country: string
): Promise<MerchantRecord[]> {
  const cached = merchantCache.get(country);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Mutex: dedupe concurrent cache misses for the same country.
  const inflight = merchantInflight.get(country);
  if (inflight) return inflight;

  const promise = fetchIngestedMerchantsFresh(country).finally(() => {
    merchantInflight.delete(country);
  });
  merchantInflight.set(country, promise);
  return promise;
}

async function fetchIngestedMerchantsFresh(
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

  // Sitemaps MUST be observable: if the API is unauthenticated or
  // returns a non-2xx, log it once per (region, status) so we don't
  // serve an empty <urlset/> silently — which is what GSC reports as
  // an empty sitemap and what triggered BUY-42727.  See also
  // src/app/sitemap-products.xml/route.ts and the route file in
  // src/app/sitemap-merchants.xml/route.ts.
  const logOnce = (() => {
    const seen = new Set<string>();
    return (status: number) => {
      const key = `${country}:${status}:${apiKey ? "auth" : "anon"}`;
      if (seen.has(key)) return;
      seen.add(key);
      // eslint-disable-next-line no-console
      console.warn(
        `[sitemap] fetchIngestedMerchants country=${country} base=${baseUrl} ` +
          `auth=${apiKey ? "yes" : "no"} status=${status} — ` +
          `sitemap will be empty for this region. ` +
          `Set BUYWHERE_API_KEY (or NEXT_PUBLIC_BUYWHERE_API_KEY) on the deploy.`
      );
    };
  })();

  const merchants: MerchantRecord[] = [];
  let offset = 0;
  const limit = 500;

  let ok = false;
  try {
    while (true) {
      const res = await fetch(
        `${baseUrl}/v1/merchants?country=${country}&onboarding_stage=ingested&is_active=true&limit=${limit}&offset=${offset}`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        logOnce(res.status);
        break;
      }
      ok = true;
      const data = (await res.json()) as {
        merchants?: MerchantRecord[];
        has_more?: boolean;
      };
      const batch = data.merchants ?? [];
      merchants.push(...batch);
      if (!data.has_more || batch.length < limit) break;
      offset += limit;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sitemap] fetchIngestedMerchants country=${country} threw: ${(err as Error)?.message ?? err}`
    );
  }

  // Only cache SUCCESSFUL responses. A 429 / 401 / network error must
  // NOT be cached for the full TTL — that would mean serving an empty
  // sitemap for an hour while the API is rate-limited and recovering
  // (this is exactly the trap we hit on BUY-42890: the warm-up 429
  // poisoned the cache, the sitemaps stayed empty for the full TTL,
  // and Googlebot's refresh window passed). On failure, return the
  // empty result this call but let the next request retry.
  if (ok) {
    merchantCache.set(country, {
      data: merchants,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
  return merchants;
}

export async function getMerchantListingSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const now = new Date();
  // BUY-72121 F5: use Map for URL-keyed dedup so duplicate API pages don't
  // produce duplicate sitemap entries (T395 found 1 self-duplicate for
  // performance-sg/products consuming a capped slot).
  const entriesByUrl = new Map<string, SitemapUrlEntry>();

  const sgMerchants = await fetchIngestedMerchants("SG");
  for (const merchant of sgMerchants) {
    if (!merchant.is_active) continue;
    const slug = deriveMerchantSlug(merchant);
    const country = merchant.country.toLowerCase();
    const url = toSiteUrl(`/${country}/${slug}/products`);
    // Canonical form (no trailing slash) — matches the <link rel="canonical">
    // emitted by /[seo-page]/[merchant]/products/page.tsx and the actual
    // route on disk. Trailing-slash URLs get rewritten (200 via
    // x-middleware-rewrite) which Google Search Console reports as
    // "Page with redirect" (BUY-42727, BUY-41940, BUY-40084).
    if (!entriesByUrl.has(url)) {
      entriesByUrl.set(url, {
        url,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  }

  return Array.from(entriesByUrl.values());
}

export async function getMerchantSitemapChunk(page: number): Promise<SitemapUrlEntry[]> {
  const entries = await getMerchantListingSitemapEntries();
  const start = (page - 1) * MAX_URLS_PER_SITEMAP;
  return entries.slice(start, start + MAX_URLS_PER_SITEMAP);
}

export async function getAllRegionMerchantListingSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const now = new Date();
  const ALL_REGIONS = ["SG", "US", "MY", "TH", "ID", "PH", "VN"];

  // Serialize with a small stagger so 7 parallel /v1/merchants calls
  // don't burst-trip the API key's rpm limit (BUY-42890). With ~150ms
  // between calls, 7 regions = ~1.05s, well under any reasonable
  // burst window. Warm cache hits are unaffected — only the cold
  // regeneration pays this cost.
  const results: Array<{ status: "fulfilled"; value: MerchantRecord[] } | { status: "rejected"; reason: unknown }> = [];
  for (const region of ALL_REGIONS) {
    try {
      const value = await fetchIngestedMerchants(region);
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // BUY-72121 F5: URL-keyed dedup so duplicate API pages don't produce
  // duplicate sitemap entries (the F5 self-duplicate was inside one
  // file; this also catches cross-region dupes in the all-regions fan-out).
  const entriesByUrl = new Map<string, SitemapUrlEntry>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const merchant of result.value) {
      if (!merchant.is_active) continue;
      const slug = deriveMerchantSlug(merchant);
      const country = merchant.country.toLowerCase();
      const url = toSiteUrl(`/${country}/${slug}/products`);
      // See getMerchantListingSitemapEntries above for the canonical-form
      // rationale (BUY-42727 trailing-slash 301 fix).
      if (!entriesByUrl.has(url)) {
        entriesByUrl.set(url, {
          url,
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.8,
        });
      }
    }
  }

  return Array.from(entriesByUrl.values());
}
