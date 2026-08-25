import { buildSitemapResponse, renderUrlSet } from "@/lib/sitemaps";

// BUY-75133: /brands/{slug} soft-404 fix — the static `commerceBrands` list in
// src/lib/commerce-routes.ts advertises 10 brand slugs (apple, samsung, sony,
// nike, dyson, nintendo, dell, lenovo, canon, xiaomi) but the upstream
// /v1/brand/{slug} API returns 404 for every one. Each URL soft-404s (HTTP 200
// + <title>Brand Not Found</title> + robots noindex + no canonical + no JSON-LD)
// because the page handler's notFound() streams as 200. The sitemap must only
// contain 200 URLs that resolve to real content (indexation directive §8), so
// the 10 placeholder entries are dropped. The empty <urlset/> is the honest
// signal — when the catalog actually exposes brand data, restore the entries
// here (and remove the matching middleware 404 gate's no-op fall-through).
export function GET(): Response {
  return buildSitemapResponse(renderUrlSet([]));
}
