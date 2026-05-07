import type { Metadata } from "next";
import MetricsPageClient from "./MetricsPageClient";
import { type PublicMetricsData } from "@/components/metrics/MetricsSection";

export const metadata: Metadata = {
  title: "Growth Metrics — BuyWhere",
  description:
    "Live growth metrics for BuyWhere: catalog coverage, active developers, API query volume, uptime, and market expansion.",
};

export const revalidate = 300;

type RawStats = Record<string, unknown>;

const PLACEHOLDER_DATA: PublicMetricsData = {
  hero: {
    productsIndexed: 128470,
    activeDevelopers: 412,
    queriesThisMonth: 847230,
    avgResponseTimeMs: 42,
  },
  catalog: {
    productsToday: 1247,
    platforms: 34,
    recentPlatforms: ["ShopSG", "Lazada", "Carousell", "Qoo10"],
    categories: 289,
    topCategories: [
      { name: "Electronics", count: 42310 },
      { name: "Fashion", count: 31820 },
      { name: "Home & Living", count: 19450 },
      { name: "Beauty", count: 14820 },
      { name: "Sports & Outdoors", count: 11230 },
    ],
  },
  api: {
    queriesToday: 28450,
    dailyGoal: 35000,
    p50: 42,
    p95: 180,
    p99: 340,
    trend: "up",
  },
  health: {
    updatedAt: "2026-05-06T16:00:00.000Z",
    mcp: { status: "up", uptime: 99.97 },
    rest: { status: "up", uptime: 99.95 },
    website: { status: "up", uptime: 99.92 },
  },
  geo: {
    countries: 4,
    countryList: [
      { code: "SG", name: "Singapore", flag: "SG", count: 67820 },
      { code: "MY", name: "Malaysia", flag: "MY", count: 32150 },
      { code: "TH", name: "Thailand", flag: "TH", count: 18900 },
      { code: "PH", name: "Philippines", flag: "PH", count: 9600 },
    ],
  },
  trends: {
    last7: [
      { date: "May 01", products: 121400, queries: 21200, developers: 362 },
      { date: "May 02", products: 122050, queries: 22140, developers: 369 },
      { date: "May 03", products: 123010, queries: 23680, developers: 378 },
      { date: "May 04", products: 124020, queries: 24920, developers: 386 },
      { date: "May 05", products: 126100, queries: 26300, developers: 398 },
      { date: "May 06", products: 127220, queries: 27440, developers: 406 },
      { date: "May 07", products: 128470, queries: 28450, developers: 412 },
    ],
    last30: [
      { date: "Apr 08", products: 98100, queries: 11820, developers: 248 },
      { date: "Apr 10", products: 100340, queries: 12610, developers: 254 },
      { date: "Apr 12", products: 102900, queries: 13840, developers: 263 },
      { date: "Apr 14", products: 105440, queries: 14950, developers: 272 },
      { date: "Apr 16", products: 108050, queries: 15880, developers: 287 },
      { date: "Apr 18", products: 110620, queries: 17140, developers: 296 },
      { date: "Apr 20", products: 112980, queries: 17920, developers: 308 },
      { date: "Apr 22", products: 115410, queries: 19280, developers: 326 },
      { date: "Apr 24", products: 118260, queries: 20840, developers: 341 },
      { date: "Apr 26", products: 120900, queries: 22410, developers: 354 },
      { date: "Apr 28", products: 123740, queries: 24180, developers: 371 },
      { date: "Apr 30", products: 126020, queries: 25860, developers: 389 },
      { date: "May 02", products: 127040, queries: 26800, developers: 401 },
      { date: "May 04", products: 127920, queries: 27610, developers: 408 },
      { date: "May 06", products: 128470, queries: 28450, developers: 412 },
    ],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function toShortDate(value: unknown, fallbackIndex: number): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        timeZone: "UTC",
      });
    }
    return value;
  }
  return `Day ${fallbackIndex + 1}`;
}

function normalizeTrendPoints(
  value: unknown,
  fallback: PublicMetricsData["trends"]["last7"]
): PublicMetricsData["trends"]["last7"] {
  const items = asArray<Record<string, unknown>>(value);
  if (!items.length) return fallback;

  const mapped = items
    .map((item, index) => {
      const row = asRecord(item);
      if (!row) return null;

      const products = firstNumber(
        row.products,
        row.productsIndexed,
        row.product_count,
        row.catalogProducts,
        row.products_indexed
      );
      const queries = firstNumber(
        row.queries,
        row.queriesToday,
        row.queryCount,
        row.apiQueries,
        row.queries_this_month
      );
      const developers = firstNumber(
        row.developers,
        row.activeDevelopers,
        row.developerCount,
        row.developers_active
      );

      if (
        products === undefined &&
        queries === undefined &&
        developers === undefined
      ) {
        return null;
      }

      return {
        date: toShortDate(row.date ?? row.timestamp ?? row.day, index),
        products: products ?? fallback[Math.min(index, fallback.length - 1)].products,
        queries: queries ?? fallback[Math.min(index, fallback.length - 1)].queries,
        developers:
          developers ?? fallback[Math.min(index, fallback.length - 1)].developers,
      };
    })
    .filter((row): row is PublicMetricsData["trends"]["last7"][number] => Boolean(row));

  return mapped.length ? mapped : fallback;
}

function normalizeCountryList(value: unknown): PublicMetricsData["geo"]["countryList"] {
  return asArray<Record<string, unknown>>(value)
    .map((country) => {
      const row = asRecord(country);
      if (!row) return null;

      const code = firstString(row.code, row.countryCode, row.country);
      const name = firstString(row.name, row.countryName, row.label);
      const count = firstNumber(row.count, row.products, row.productCount);
      if (!code || !name || count === undefined) return null;

      return { code, name, flag: code, count };
    })
    .filter((row): row is PublicMetricsData["geo"]["countryList"][number] => Boolean(row));
}

function normalizeCategories(value: unknown): PublicMetricsData["catalog"]["topCategories"] {
  return asArray<Record<string, unknown>>(value)
    .map((category) => {
      const row = asRecord(category);
      if (!row) return null;

      const name = firstString(row.name, row.category, row.label);
      const count = firstNumber(row.count, row.products, row.productCount);
      if (!name || count === undefined) return null;

      return { name, count };
    })
    .filter(
      (row): row is PublicMetricsData["catalog"]["topCategories"][number] => Boolean(row)
    );
}

function normalizeStats(raw: RawStats): PublicMetricsData {
  const catalog = asRecord(raw.catalog);
  const api = asRecord(raw.api);
  const health = asRecord(raw.health);
  const geo = asRecord(raw.geo);
  const trends = asRecord(raw.trends);
  const hero = asRecord(raw.hero);

  const productsIndexed =
    firstNumber(
      hero?.productsIndexed,
      catalog?.productsIndexed,
      catalog?.totalProducts,
      raw.productsIndexed,
      raw.totalProducts,
      raw.products_indexed
    ) ?? PLACEHOLDER_DATA.hero.productsIndexed;

  const activeDevelopers =
    firstNumber(
      hero?.activeDevelopers,
      raw.activeDevelopers,
      raw.developersActive,
      api?.activeDevelopers,
      raw.active_developers
    ) ?? PLACEHOLDER_DATA.hero.activeDevelopers;

  const queriesThisMonth =
    firstNumber(
      hero?.queriesThisMonth,
      api?.queriesThisMonth,
      raw.queriesThisMonth,
      raw.monthlyQueries,
      raw.queries_this_month
    ) ?? PLACEHOLDER_DATA.hero.queriesThisMonth;

  const avgResponseTimeMs =
    firstNumber(
      hero?.avgResponseTimeMs,
      api?.avgResponseTimeMs,
      api?.avgLatency,
      raw.avgResponseTimeMs,
      raw.avgLatency,
      raw.avg_response_time_ms
    ) ?? PLACEHOLDER_DATA.hero.avgResponseTimeMs;

  const queriesToday =
    firstNumber(api?.queries_daily, api?.queriesToday, raw.queries_daily, raw.queriesToday) ??
    PLACEHOLDER_DATA.api.queriesToday;
  const dailyGoal =
    firstNumber(api?.dailyGoal, raw.dailyGoal) ?? PLACEHOLDER_DATA.api.dailyGoal;

  return {
    hero: {
      productsIndexed,
      activeDevelopers,
      queriesThisMonth,
      avgResponseTimeMs,
    },
    catalog: {
      productsToday:
        firstNumber(
          catalog?.products_today_delta,
          catalog?.productsToday,
          raw.products_today_delta,
          raw.productsToday
        ) ?? PLACEHOLDER_DATA.catalog.productsToday,
      platforms:
        firstNumber(
          catalog?.total_platforms,
          catalog?.platforms,
          catalog?.merchants,
          raw.total_platforms,
          raw.platforms
        ) ?? PLACEHOLDER_DATA.catalog.platforms,
      recentPlatforms:
        asArray<string>(catalog?.recent_platforms ?? catalog?.recentPlatforms).filter(Boolean)
          .length > 0
          ? asArray<string>(catalog?.recent_platforms ?? catalog?.recentPlatforms).filter(Boolean)
          : PLACEHOLDER_DATA.catalog.recentPlatforms,
      categories:
        firstNumber(
          catalog?.total_categories,
          catalog?.categories,
          raw.total_categories,
          raw.categories
        ) ?? PLACEHOLDER_DATA.catalog.categories,
      topCategories:
        normalizeCategories(catalog?.topCategories ?? raw.topCategories).length > 0
          ? normalizeCategories(catalog?.topCategories ?? raw.topCategories)
          : PLACEHOLDER_DATA.catalog.topCategories,
    },
    api: {
      queriesToday,
      dailyGoal,
      p50:
        firstNumber(
          api?.avg_latency_ms_p50,
          api?.p50,
          api?.p50Ms,
          raw.avg_latency_ms_p50,
          raw.p50
        ) ?? PLACEHOLDER_DATA.api.p50,
      p95:
        firstNumber(
          api?.avg_latency_ms_p95,
          api?.p95,
          api?.p95Ms,
          raw.avg_latency_ms_p95,
          raw.p95
        ) ?? PLACEHOLDER_DATA.api.p95,
      p99:
        firstNumber(
          api?.avg_latency_ms_p99,
          api?.p99,
          api?.p99Ms,
          raw.avg_latency_ms_p99,
          raw.p99
        ) ?? PLACEHOLDER_DATA.api.p99,
      trend:
        queriesToday >= dailyGoal * 0.75
          ? "up"
          : queriesToday <= dailyGoal * 0.5
            ? "down"
            : PLACEHOLDER_DATA.api.trend,
    },
    health: {
      updatedAt:
        firstString(health?.updatedAt, raw.updatedAt, raw.timestamp, raw.updated_at) ??
        PLACEHOLDER_DATA.health.updatedAt,
      mcp: {
        status:
          firstString(asRecord(health?.mcpServer)?.status, asRecord(health?.mcp)?.status) === "down"
            ? "down"
            : "up",
        uptime:
          firstNumber(
            asRecord(health?.mcpServer)?.uptime_pct_30d,
            asRecord(health?.mcp)?.uptime,
            raw.mcp_uptime
          ) ?? PLACEHOLDER_DATA.health.mcp.uptime,
      },
      rest: {
        status:
          firstString(asRecord(health?.restApi)?.status, asRecord(health?.rest)?.status) === "down"
            ? "down"
            : "up",
        uptime:
          firstNumber(
            asRecord(health?.restApi)?.uptime_pct_30d,
            asRecord(health?.rest)?.uptime,
            raw.rest_uptime
          ) ?? PLACEHOLDER_DATA.health.rest.uptime,
      },
      website: {
        status:
          firstString(asRecord(health?.website)?.status) === "down" ? "down" : "up",
        uptime:
          firstNumber(
            asRecord(health?.website)?.uptime_pct_30d,
            asRecord(health?.website)?.uptime,
            raw.website_uptime
          ) ?? PLACEHOLDER_DATA.health.website.uptime,
      },
    },
    geo: {
      countries:
        firstNumber(geo?.total_countries, geo?.countries, raw.total_countries, raw.countries) ??
        PLACEHOLDER_DATA.geo.countries,
      countryList:
        normalizeCountryList(geo?.countryList ?? raw.countryList).length > 0
          ? normalizeCountryList(geo?.countryList ?? raw.countryList)
          : PLACEHOLDER_DATA.geo.countryList,
    },
    trends: {
      last7: normalizeTrendPoints(
        trends?.last7 ?? raw.last7Days ?? raw.trend7 ?? raw.last_7_days,
        PLACEHOLDER_DATA.trends.last7
      ),
      last30: normalizeTrendPoints(
        trends?.last30 ?? raw.last30Days ?? raw.trend30 ?? raw.last_30_days,
        PLACEHOLDER_DATA.trends.last30
      ),
    },
  };
}

async function getStats(): Promise<PublicMetricsData | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.buywhere.ai";
    const res = await fetch(`${baseUrl}/api/v1/stats/public`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RawStats;
    return normalizeStats(raw);
  } catch {
    return null;
  }
}

export default async function MetricsPage() {
  const stats = await getStats();
  const data = stats ?? PLACEHOLDER_DATA;
  const fetchedAt = new Date().toISOString();

  return (
    <MetricsPageClient
      data={data}
      usingFallbackData={!stats}
      fetchedAt={fetchedAt}
    />
  );
}
