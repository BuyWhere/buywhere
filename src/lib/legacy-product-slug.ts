/**
 * BUY-82755: resolve legacy `/product/<slug>` URLs.
 *
 * Search cards / QA / HeroSearch historically linked `/product/{title-slug}`
 * (and sometimes `/product/{id}`). There was never a dynamic App Router
 * segment for that path — only `/product/page.tsx` which 308s `/product` to
 * `/compare/` — so every product-slug URL 404'd.
 *
 * Canonical PDP remains `/products/us/{merchant}/{id}/` (and `/p/{id}`).
 * This helper looks the product up so the legacy URL can render 200 in place
 * (Reed AC for BUY-82755) with a canonical pointing at the 2-segment form.
 */

export function normalizeProductSlug(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyProductTitle(name: string): string {
  return normalizeProductSlug(name);
}

export function slugToSearchQuery(slug: string): string {
  return normalizeProductSlug(slug).replace(/-/g, " ").trim();
}

export interface LegacyProductHit {
  id: string;
  name: string;
  slug: string;
  merchantSlug: string | null;
  merchantName: string | null;
}

type SearchItem = {
  id?: string | number;
  title?: string | null;
  name?: string | null;
  merchant_slug?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
};

function itemsFromSearchPayload(payload: unknown): SearchItem[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const bags = [p.products, p.results, p.items, p.data];
  for (const bag of bags) {
    if (Array.isArray(bag) && bag.length > 0) return bag as SearchItem[];
  }
  return [];
}

function toHit(item: SearchItem): LegacyProductHit | null {
  const id = item.id != null ? String(item.id) : "";
  const name = (item.name || item.title || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    slug: slugifyProductTitle(name),
    merchantSlug: item.merchant_slug ?? null,
    merchantName: item.merchant_name || item.merchant || null,
  };
}

function slugMatches(normalizedIncoming: string, productSlug: string): boolean {
  if (!normalizedIncoming || !productSlug) return false;
  if (productSlug === normalizedIncoming) return true;
  // Incoming URL is often truncated (title slug cut at ~80 chars by the card).
  if (productSlug.startsWith(normalizedIncoming) && normalizedIncoming.length >= 24) {
    return true;
  }
  if (normalizedIncoming.startsWith(productSlug) && productSlug.length >= 24) {
    return true;
  }
  return false;
}

export function pickLegacyProductHit(
  incomingSlug: string,
  items: SearchItem[],
): LegacyProductHit | null {
  const normalized = normalizeProductSlug(incomingSlug);
  if (!normalized) return null;

  const hits = items.map(toHit).filter((h): h is LegacyProductHit => Boolean(h));
  const incomingTokens = new Set(normalized.split("-").filter(Boolean));
  function tokenOverlap(slug: string): number {
    const parts = slug.split("-").filter(Boolean);
    let n = 0;
    for (const p of parts) if (incomingTokens.has(p)) n += 1;
    return n;
  }
  const exact = hits.filter((h) => slugMatches(normalized, h.slug));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    exact.sort((a, b) => tokenOverlap(b.slug) - tokenOverlap(a.slug) || b.slug.length - a.slug.length);
    return exact[0];
  }
  if (hits.length === 1) return hits[0];
  const ranked = [...hits].sort((a, b) => tokenOverlap(b.slug) - tokenOverlap(a.slug));
  if (ranked.length && tokenOverlap(ranked[0].slug) >= Math.min(6, incomingTokens.size)) {
    return ranked[0];
  }
  return null;
}

export async function resolveLegacyProductSlug(
  rawSlug: string,
  opts: { apiBase: string; apiKey: string },
): Promise<LegacyProductHit | null> {
  const normalized = normalizeProductSlug(rawSlug);
  if (!normalized) return null;

  if (/^\d{8,}$/.test(normalized)) {
    try {
      const res = await fetch(
        `${opts.apiBase}/v1/products/${encodeURIComponent(normalized)}`,
        {
          headers: {
            Accept: "application/json",
            ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const payload = (await res.json()) as SearchItem | { data?: SearchItem[] };
        const item = Array.isArray((payload as { data?: SearchItem[] }).data)
          ? (payload as { data: SearchItem[] }).data[0]
          : (payload as SearchItem);
        return toHit(item);
      }
    } catch {
      // fall through to title search
    }
  }

  const fullQ = slugToSearchQuery(normalized);
  if (!fullQ) return null;
  // Full title slugs (~20 tokens) over-constrain keyword search and return 0
  // (BUY-82755 Gigabyte URL). Try a short distinctive prefix first, then the
  // first 8 tokens, then the full query.
  const tokens = fullQ.split(/\s+/).filter(Boolean);
  const queries = Array.from(
    new Set(
      [
        tokens.slice(0, 4).join(" "),
        tokens.slice(0, 8).join(" "),
        fullQ,
      ].filter((q) => q.length >= 8),
    ),
  );

  try {
    for (const q of queries) {
      const url = new URL(`${opts.apiBase}/v1/products/search`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "8");
      url.searchParams.set("country", "US");
      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const payload = await res.json();
      const hit = pickLegacyProductHit(normalized, itemsFromSearchPayload(payload));
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}
