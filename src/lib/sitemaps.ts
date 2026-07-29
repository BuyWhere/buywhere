import { getAllBlogPosts } from "@/lib/blog";
import { PRODUCT_TAXONOMY, US_CATEGORY_META } from "@/lib/taxonomy";
import { getUSProducts, type USProductForSitemap } from "@/lib/us-products";
import { getSGProducts, type SGProductForSitemap } from "@/lib/sg-products";
import { toSiteUrl } from "@/lib/site-url";
import { seoLandingPages } from "@/lib/seo-landing-pages";
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

// Only slugs that resolve via getCategoryBySlug (PRODUCT_TAXONOMY) are listed.
// Removed soft-404 slugs flagged in BUY-39762 / BUY-41940:
//   - books-stationery, garden-outdoor (noindex Category Not Found template)
//   - sports-outdoors, pet-supplies (404 / alternate page)
const CATEGORY_PAGE_SLUGS = [
  "automotive",
  "beauty-health",
  "electronics",
  "fashion",
  "food-beverages",
  "grocery",
  "health-wellness",
  "home-living",
  "toys-games",
] as const;


interface ApiCategoryRecord {
  slug: string;
  name: string;
  product_count?: number;
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
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
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

export function getStaticSitemapEntries(): SitemapUrlEntry[] {
  const now = new Date();
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
        new Date(entry.lastModified).getTime() >
          new Date(existing.lastModified).getTime())
    ) {
      byUrl.set(entry.url, entry);
    }
  };

  for (const { path, priority, changeFrequency } of STATIC_SITEMAP_ROUTES) {
    upsert({
      url: toSiteUrl(path),
      lastModified: now,
      changeFrequency,
      priority,
    });
  }
  for (const slug of DOC_SLUGS) {
    upsert({
      url: toSiteUrl(`/docs/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    });
  }
  for (const post of blogPosts) {
    upsert({
      url: toSiteUrl(`/blog/${post.slug}`),
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    });
  }
  // BUY-14269: add all SEO landing pages to sitemap
  for (const slug of Object.keys(seoLandingPages)) {
    upsert({
      url: toSiteUrl(`/${slug}/`),
      lastModified: now,
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

export function getCategorySitemapEntries(): SitemapUrlEntry[] {
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

  return Array.from(entries.values());
}

export async function getCompareSitemapEntries(): Promise<SitemapUrlEntry[]> {
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

  for (const pair of await getCompareCategoryPairs()) {
    addEntry(`/compare/${compareCategoryPairSlug(pair)}`, 0.7);
  }

  return Array.from(entries.values());
}

export async function getProductSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const products = await getUSProducts();

  return products.map((product: USProductForSitemap) => ({
    url: toSiteUrl(`/products/us/${product.slug}`),
    lastModified: product.lastUpdated,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
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

  return products.map((product: SGProductForSitemap) => ({
    url: toSiteUrl(`/products/sg/${product.slug}`),
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
  const entries: SitemapUrlEntry[] = [];

  const sgMerchants = await fetchIngestedMerchants("SG");
  for (const merchant of sgMerchants) {
    if (!merchant.is_active) continue;
    const slug = deriveMerchantSlug(merchant);
    const country = merchant.country.toLowerCase();
    entries.push({
      // Canonical form (no trailing slash) — matches the <link rel="canonical">
      // emitted by /[seo-page]/[merchant]/products/page.tsx and the actual
      // route on disk. Trailing-slash URLs get rewritten (200 via
      // x-middleware-rewrite) which Google Search Console reports as
      // "Page with redirect" (BUY-42727, BUY-41940, BUY-40084).
      url: toSiteUrl(`/${country}/${slug}/products`),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  return entries;
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

  const entries: SitemapUrlEntry[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const merchant of result.value) {
      if (!merchant.is_active) continue;
      const slug = deriveMerchantSlug(merchant);
      const country = merchant.country.toLowerCase();
      entries.push({
        // See getMerchantListingSitemapEntries above for the canonical-form
        // rationale (BUY-42727 trailing-slash 301 fix).
        url: toSiteUrl(`/${country}/${slug}/products`),
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  }

  return entries;
}
