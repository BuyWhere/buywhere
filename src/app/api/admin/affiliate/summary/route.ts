import { NextRequest, NextResponse } from "next/server";
import { assertAdminRequest } from "@/lib/admin-auth";
import { getAffiliateAnalyticsPool } from "@/lib/affiliate-analytics-db";

export const dynamic = "force-dynamic";

type TopSourceRow = {
  source: string;
  clicks: number;
  conversions: number;
  conversion_rate: number;
  estimated_revenue: number;
};

type TopProductRow = {
  product_id: string;
  product_name: string;
  source: string;
  clicks: number;
  conversions: number;
  estimated_revenue: number;
};

type DailyPointRow = {
  day: string;
  clicks: number;
  conversions: number;
};

export interface AffiliateSummaryResponse {
  days: number;
  generated_at: string;
  summary: {
    total_clicks: number;
    total_conversions: number;
    estimated_revenue: number;
    conversion_rate: number;
    currency: string;
  };
  top_sources: TopSourceRow[];
  top_products: TopProductRow[];
  daily_series: DailyPointRow[];
}

function parseDays(request: NextRequest) {
  const rawDays = request.nextUrl.searchParams.get("days");
  const parsed = Number(rawDays ?? 30);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), 365);
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toDateLabel(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value);
}

const SUMMARY_QUERY = `
  WITH bounds AS (
    SELECT date_trunc('day', now()) - (($1::int - 1) * interval '1 day') AS start_at
  ),
  click_totals AS (
    SELECT COUNT(*)::bigint AS total_clicks
    FROM affiliate_clicks, bounds
    WHERE clicked_at >= bounds.start_at
  ),
  conversion_totals AS (
    SELECT COUNT(*)::bigint AS total_conversions
    FROM conversions, bounds
    WHERE created_at >= bounds.start_at
  ),
  revenue_totals AS (
    SELECT COALESCE(SUM(commission_amount), 0)::numeric AS estimated_revenue
    FROM commission_decisions, bounds
    WHERE decided_at >= bounds.start_at
  )
  SELECT
    click_totals.total_clicks,
    conversion_totals.total_conversions,
    revenue_totals.estimated_revenue,
    CASE
      WHEN click_totals.total_clicks = 0 THEN 0
      ELSE ROUND((conversion_totals.total_conversions::numeric / click_totals.total_clicks::numeric) * 100, 2)
    END AS conversion_rate
  FROM click_totals, conversion_totals, revenue_totals
`;

const TOP_SOURCES_QUERY = `
  WITH bounds AS (
    SELECT date_trunc('day', now()) - (($1::int - 1) * interval '1 day') AS start_at
  ),
  clicks_by_source AS (
    SELECT
      COALESCE(NULLIF(ac.source, ''), NULLIF(p.source, ''), NULLIF(ac.merchant_id, ''), 'unknown') AS source,
      COUNT(*)::bigint AS clicks
    FROM affiliate_clicks ac
    LEFT JOIN products p ON p.id::text = ac.product_id
    CROSS JOIN bounds
    WHERE ac.clicked_at >= bounds.start_at
    GROUP BY 1
  ),
  conversions_by_source AS (
    SELECT
      COALESCE(NULLIF(c.platform, ''), NULLIF(p.source, ''), NULLIF(c.merchant_id, ''), 'unknown') AS source,
      COUNT(*)::bigint AS conversions
    FROM conversions c
    LEFT JOIN products p ON p.id = c.product_id
    CROSS JOIN bounds
    WHERE c.created_at >= bounds.start_at
    GROUP BY 1
  ),
  revenue_by_source AS (
    SELECT
      COALESCE(NULLIF(c.platform, ''), NULLIF(p.source, ''), NULLIF(c.merchant_id, ''), 'unknown') AS source,
      COALESCE(SUM(cd.commission_amount), 0)::numeric AS estimated_revenue
    FROM commission_decisions cd
    JOIN conversions c ON c.id::text = cd.conversion_id
    LEFT JOIN products p ON p.id = c.product_id
    CROSS JOIN bounds
    WHERE cd.decided_at >= bounds.start_at
    GROUP BY 1
  ),
  source_keys AS (
    SELECT source FROM clicks_by_source
    UNION
    SELECT source FROM conversions_by_source
    UNION
    SELECT source FROM revenue_by_source
  )
  SELECT
    source_keys.source,
    COALESCE(clicks_by_source.clicks, 0)::bigint AS clicks,
    COALESCE(conversions_by_source.conversions, 0)::bigint AS conversions,
    CASE
      WHEN COALESCE(clicks_by_source.clicks, 0) = 0 THEN 0
      ELSE ROUND((COALESCE(conversions_by_source.conversions, 0)::numeric / clicks_by_source.clicks::numeric) * 100, 2)
    END AS conversion_rate,
    COALESCE(revenue_by_source.estimated_revenue, 0)::numeric AS estimated_revenue
  FROM source_keys
  LEFT JOIN clicks_by_source ON clicks_by_source.source = source_keys.source
  LEFT JOIN conversions_by_source ON conversions_by_source.source = source_keys.source
  LEFT JOIN revenue_by_source ON revenue_by_source.source = source_keys.source
  ORDER BY estimated_revenue DESC, conversions DESC, clicks DESC, source ASC
  LIMIT 12
`;

const TOP_PRODUCTS_QUERY = `
  WITH bounds AS (
    SELECT date_trunc('day', now()) - (($1::int - 1) * interval '1 day') AS start_at
  ),
  clicks_by_product AS (
    SELECT
      ac.product_id,
      COUNT(*)::bigint AS clicks
    FROM affiliate_clicks ac
    CROSS JOIN bounds
    WHERE ac.clicked_at >= bounds.start_at
    GROUP BY 1
  ),
  conversions_by_product AS (
    SELECT
      c.product_id::text AS product_id,
      COUNT(*)::bigint AS conversions
    FROM conversions c
    CROSS JOIN bounds
    WHERE c.created_at >= bounds.start_at
    GROUP BY 1
  ),
  revenue_by_product AS (
    SELECT
      c.product_id::text AS product_id,
      COALESCE(SUM(cd.commission_amount), 0)::numeric AS estimated_revenue
    FROM commission_decisions cd
    JOIN conversions c ON c.id::text = cd.conversion_id
    CROSS JOIN bounds
    WHERE cd.decided_at >= bounds.start_at
    GROUP BY 1
  ),
  product_keys AS (
    SELECT product_id FROM clicks_by_product
    UNION
    SELECT product_id FROM conversions_by_product
    UNION
    SELECT product_id FROM revenue_by_product
  )
  SELECT
    product_keys.product_id,
    COALESCE(NULLIF(p.title, ''), 'Unknown product') AS product_name,
    COALESCE(NULLIF(p.source, ''), 'unknown') AS source,
    COALESCE(clicks_by_product.clicks, 0)::bigint AS clicks,
    COALESCE(conversions_by_product.conversions, 0)::bigint AS conversions,
    COALESCE(revenue_by_product.estimated_revenue, 0)::numeric AS estimated_revenue
  FROM product_keys
  LEFT JOIN products p ON p.id::text = product_keys.product_id
  LEFT JOIN clicks_by_product ON clicks_by_product.product_id = product_keys.product_id
  LEFT JOIN conversions_by_product ON conversions_by_product.product_id = product_keys.product_id
  LEFT JOIN revenue_by_product ON revenue_by_product.product_id = product_keys.product_id
  ORDER BY estimated_revenue DESC, conversions DESC, clicks DESC, product_name ASC
  LIMIT 12
`;

const DAILY_SERIES_QUERY = `
  WITH bounds AS (
    SELECT date_trunc('day', now()) - (($1::int - 1) * interval '1 day') AS start_at
  ),
  days AS (
    SELECT generate_series(
      (SELECT start_at::date FROM bounds),
      timezone('UTC', now())::date,
      interval '1 day'
    )::date AS day
  ),
  click_series AS (
    SELECT timezone('UTC', clicked_at)::date AS day, COUNT(*)::bigint AS clicks
    FROM affiliate_clicks, bounds
    WHERE clicked_at >= bounds.start_at
    GROUP BY 1
  ),
  conversion_series AS (
    SELECT timezone('UTC', created_at)::date AS day, COUNT(*)::bigint AS conversions
    FROM conversions, bounds
    WHERE created_at >= bounds.start_at
    GROUP BY 1
  )
  SELECT
    days.day,
    COALESCE(click_series.clicks, 0)::bigint AS clicks,
    COALESCE(conversion_series.conversions, 0)::bigint AS conversions
  FROM days
  LEFT JOIN click_series ON click_series.day = days.day
  LEFT JOIN conversion_series ON conversion_series.day = days.day
  ORDER BY days.day ASC
`;

export async function GET(request: NextRequest) {
  try {
    assertAdminRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Admin access denied." },
      { status: 403 },
    );
  }

  const days = parseDays(request);
  const pool = getAffiliateAnalyticsPool();

  try {
    const [summaryResult, topSourcesResult, topProductsResult, dailySeriesResult] = await Promise.all([
      pool.query<Record<string, unknown>>(SUMMARY_QUERY, [days]),
      pool.query<TopSourceRow>(TOP_SOURCES_QUERY, [days]),
      pool.query<TopProductRow>(TOP_PRODUCTS_QUERY, [days]),
      pool.query<DailyPointRow>(DAILY_SERIES_QUERY, [days]),
    ]);

    const summaryRow = summaryResult.rows[0] ?? {};

    const payload: AffiliateSummaryResponse = {
      days,
      generated_at: new Date().toISOString(),
      summary: {
        total_clicks: toNumber(summaryRow.total_clicks),
        total_conversions: toNumber(summaryRow.total_conversions),
        estimated_revenue: toNumber(summaryRow.estimated_revenue),
        conversion_rate: toNumber(summaryRow.conversion_rate),
        currency: "SGD",
      },
      top_sources: topSourcesResult.rows.map((row: TopSourceRow) => ({
        source: String(row.source ?? "unknown"),
        clicks: toNumber(row.clicks),
        conversions: toNumber(row.conversions),
        conversion_rate: toNumber(row.conversion_rate),
        estimated_revenue: toNumber(row.estimated_revenue),
      })),
      top_products: topProductsResult.rows.map((row: TopProductRow) => ({
        product_id: String(row.product_id ?? ""),
        product_name: String(row.product_name ?? "Unknown product"),
        source: String(row.source ?? "unknown"),
        clicks: toNumber(row.clicks),
        conversions: toNumber(row.conversions),
        estimated_revenue: toNumber(row.estimated_revenue),
      })),
      daily_series: dailySeriesResult.rows.map((row: DailyPointRow) => ({
        day: toDateLabel(row.day),
        clicks: toNumber(row.clicks),
        conversions: toNumber(row.conversions),
      })),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load affiliate dashboard data.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
