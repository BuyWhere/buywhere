const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

export interface CatalogStats {
  totalProducts: number;
  totalMerchants: number;
  activeProducts: number;
  approximate: boolean;
  source: string;
  ts: string;
}

export const CATALOG_STATS_FALLBACK_LABEL = "millions of";

interface FetchOptions {
  revalidateSeconds?: number;
  timeoutMs?: number;
}

function parsePayload(raw: unknown): CatalogStats | null {
  if (!raw || typeof raw !== "object") return null;
  const data = (raw as { data?: Record<string, unknown> }).data;
  const meta = (raw as { meta?: Record<string, unknown> }).meta;
  if (!data) return null;
  const totalProducts = Number(data.total_products);
  if (!Number.isFinite(totalProducts) || totalProducts <= 0) return null;
  return {
    totalProducts,
    totalMerchants: Number(data.total_merchants) || 0,
    activeProducts: Number(data.active_products) || totalProducts,
    approximate: Boolean(meta?.approximate),
    source: typeof meta?.source === "string" ? meta.source : "unknown",
    ts: typeof meta?.ts === "string" ? meta.ts : new Date(0).toISOString(),
  };
}

export async function fetchCatalogStats(
  opts: FetchOptions = {},
): Promise<CatalogStats | null> {
  const { revalidateSeconds = 600, timeoutMs = 5000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/stats`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    return parsePayload(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalogStatsClient(): Promise<CatalogStats | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/catalog/stats`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return parsePayload(await res.json());
  } catch {
    return null;
  }
}

export function formatCompactProductCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000_000) {
    const billions = n / 1_000_000_000;
    return `${billions >= 10 ? Math.floor(billions) : billions.toFixed(1)}B+`;
  }
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${millions >= 10 ? Math.floor(millions) : millions.toFixed(1)}M+`;
  }
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K+`;
  return `${Math.floor(n / 100) * 100}+`;
}

export function productCountLabel(stats: CatalogStats | null): string {
  return stats ? formatCompactProductCount(stats.totalProducts) : `${CATALOG_STATS_FALLBACK_LABEL}`;
}
