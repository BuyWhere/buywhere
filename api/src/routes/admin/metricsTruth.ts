// BUY-75314 — GET /v1/admin/metrics/truth?window=1d|7d|30d
//
// The single canonical source of business metrics across the BuyWhere admin
// portal, daily digest, and weekly digest. Every number follows
// /home/paperclip/ops-canon/METRICS-DEFINITIONS.md. If a metric cannot be
// computed from the named source we surface "n/a — <reason>" rather than
// a guess (Richmond 2026-08-26 binding rule).
//
// Design notes:
// - adminAuth gates the route; this is admin-only, not for end users.
// - All data sources are read-mostly; cache the assembled payload in Redis
//   for 15 minutes to keep the digest/portal pull cheap.
// - Affiliate-click human-vs-fetcher split requires the `agent_framework`
//   column that lands on affiliate_clicks via the truth-clicks branch. Until
//   that ships we return human_clicks=null with reason="unclassified: truth-clicks
//   branch not yet merged" so the number is honest, not a guess.
// - PostHog calls go server-side only with the project PAT; cached locally
//   in Redis under a per-window key so concurrent portal loads share one fetch.
// - No COUNT(*) on products. Catalog rows = reltuples (pg_class).
// - Gate audit + index line are fetched from helper scripts and the findings
//   store respectively. We surface the value and the source string so the
//   consumer knows where the number came from.

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { adminAuth } from './auth';
import { db, redis } from '../../config';
import { catalogDb } from '../../config';

const execFileAsync = promisify(execFile);

// ─── Window parsing ────────────────────────────────────────────────────
type WindowKey = '1d' | '7d' | '30d';
const WINDOW_DAYS: Record<WindowKey, number> = { '1d': 1, '7d': 7, '30d': 30 };

function parseWindow(raw: unknown): WindowKey {
  if (raw === '1d' || raw === '7d' || raw === '30d') return raw;
  // Defensive default. The route also rejects other values explicitly below
  // so a malformed request surfaces a 400 rather than silently using 30d.
  return '30d';
}

// ─── Types ─────────────────────────────────────────────────────────────
type NumberLike = number | string | null;

interface MetricLine {
  value: NumberLike;
  unit: string;
  definition: string;
  source: string;
  reason?: string;
}

interface TruthResponse {
  window: WindowKey;
  window_days: number;
  generated_at: string;
  cache_hit: boolean;
  cache_age_seconds: number | null;
  clicks: {
    human_clicks: MetricLine;
    fetcher_clicks: MetricLine;
    unclassified_clicks: MetricLine;
    unverified_clicks: MetricLine;
    by_source: Array<{ source: string; clicks: number; definition: string }>;
    by_source_page_top_20: Array<{
      source_page: string;
      clicks: number;
      definition: string;
    }>;
  };
  api: {
    external_requests: MetricLine;
    external_keys: MetricLine;
    new_external_keys: MetricLine;
    anonymous_requests: MetricLine;
  };
  catalog: {
    gross_new_products_per_day: MetricLine;
    catalog_rows_reltuples: MetricLine;
    merchants_with_products: MetricLine;
  };
  indexation: {
    index_line: MetricLine;
    source: string;
  };
  traffic: {
    human_pageviews: MetricLine;
    fetcher_pageviews: MetricLine;
    answer_engine_referrals: MetricLine;
    source: string;
  };
  growth: {
    gate_audit_line: MetricLine;
    source: string;
  };
  dead_links: {
    dead_link_rate_was_dead_at_click: MetricLine;
    source: string;
  };
}

// ─── Probe-pattern filter (METRICS-DEFINITIONS § API / MCP) ───────────
// Matches smoke|probe|test|rex[-+]|@buywhere.ai|monitor|heartbeat|dispatcher|
// fetch-monitoring|warmer against the api_key name OR email. Case-insensitive.
const PROBE_PATTERN = /(smoke|probe|test|rex[-+]?|@buywhere\.ai|monitor|heartbeat|dispatcher|fetch-monitoring|warmer)/i;

function isExternalApiKey(name: string | null, email: string | null): boolean {
  if (!PROBE_PATTERN.test(name ?? '') && !PROBE_PATTERN.test(email ?? '')) {
    return true;
  }
  return false;
}

// ─── Caching ───────────────────────────────────────────────────────────
const CACHE_PREFIX = 'admin:metrics:truth';
const CACHE_TTL_SECONDS = 15 * 60; // 15 min per spec

function cacheKey(window: WindowKey): string {
  return `${CACHE_PREFIX}:${window}`;
}

// ─── Catalog DB sources ────────────────────────────────────────────────

// Detect whether affiliate_clicks has the truth-clicks columns.
// We probe once per process via a cached boolean to avoid an information_schema
// round trip on every request.
let truthClickColumnsCached: boolean | null = null;
async function hasTruthClickColumns(): Promise<boolean> {
  if (truthClickColumnsCached !== null) return truthClickColumnsCached;
  try {
    const r = await catalogDb.query<{ exists: boolean }>(
      `SELECT COUNT(*) = 3 AS exists
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='affiliate_clicks'
          AND column_name = ANY(ARRAY['agent_framework', 'is_internal', 'referrer'])`,
    );
    truthClickColumnsCached = Boolean(r.rows[0]?.exists);
  } catch {
    truthClickColumnsCached = false;
  }
  return truthClickColumnsCached;
}

// Clicks: totals, by source, by source_page. Returns nulls with reasons when
// truth-clicks branch hasn't landed (per METRICS-DEFINITIONS § Clicks).
async function loadClicks(windowDays: number): Promise<TruthResponse['clicks']> {
  const hasAf = await hasTruthClickColumns();

  if (!hasAf) {
    // Until truth-clicks lands, count ALL clicks and report them as unclassified.
    const totalRes = await catalogDb.query<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM affiliate_clicks
         WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [windowDays],
    );
    const total = Number(totalRes.rows[0]?.total ?? 0);
    const bySourceRes = await catalogDb.query<{ source: string; clicks: string }>(
      `SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source,
              COUNT(*)::bigint AS clicks
         FROM affiliate_clicks
        WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY 1
        ORDER BY clicks DESC
        LIMIT 20`,
      [windowDays],
    );
    const byPageRes = await catalogDb.query<{ source_page: string; clicks: string }>(
      `SELECT COALESCE(NULLIF(referrer, ''), 'unknown') AS source_page,
              COUNT(*)::bigint AS clicks
         FROM affiliate_clicks
        WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY 1
        ORDER BY clicks DESC
        LIMIT 20`,
      [windowDays],
    );
    return {
      human_clicks: {
        value: null,
        unit: 'clicks/day',
        definition:
          'Affiliate clicks whose redirect-time User-Agent classifies as a human and not an internal probe. KPI.',
        source: 'affiliate_clicks.agent_framework',
        reason: 'unclassified: truth-clicks branch not yet merged',
      },
      fetcher_clicks: {
        value: null,
        unit: 'clicks/day',
        definition:
          'Affiliate clicks whose redirect-time User-Agent is a known agent bot family (ClaudeBot, ChatGPT-User, PerplexityBot, etc.).',
        source: 'affiliate_clicks.agent_framework',
        reason: 'unclassified: truth-clicks branch not yet merged',
      },
      unclassified_clicks: {
        value: total,
        unit: 'clicks total',
        definition:
          'All clicks in the window. Pre-truth-clicks, none are classified as human vs fetcher; report the unclassified total so callers do not mistake raw volume for KPI.',
        source: 'affiliate_clicks (count, all rows)',
      },
      unverified_clicks: {
        value: null,
        unit: 'clicks',
        definition:
          'Human-looking clicks that cannot be counted as human KPI because the BuyWhere referrer/internal truth fields are unavailable.',
        source: 'affiliate_clicks.agent_framework/referrer/is_internal',
        reason: 'unclassified: truth-clicks branch not yet merged',
      },
      by_source: bySourceRes.rows.map((r) => ({
        source: String(r.source ?? 'unknown'),
        clicks: Number(r.clicks),
        definition:
          'Click origin: product_card | api_response | other; referrer; api_key_id when an API key was involved.',
      })),
      by_source_page_top_20: byPageRes.rows.map((r) => ({
        source_page: String(r.source_page ?? 'unknown'),
        clicks: Number(r.clicks),
        definition:
          'Referrer pathname on the click (the page the click came from). Top 20 by clicks in window.',
      })),
    };
  }

  // truth-clicks branch landed — fetch classified numbers.
  // agent_framework values: 'human' | known bot family | 'unknown'
  const totalRes = await catalogDb.query<{
    human_clicks: string;
    fetcher_clicks: string;
    unclassified_clicks: string;
    unverified_clicks: string;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE agent_framework = 'human'
           AND is_internal = false
           AND COALESCE(referrer, '') ~* '^https?://([^/]+\\.)?buywhere\\.ai(/|$)'
       )::bigint AS human_clicks,
       COUNT(*) FILTER (WHERE agent_framework IN
         ('ChatGPT-User','ClaudeBot','PerplexityBot','GPTBot','Googlebot','Bingbot')
         AND is_internal = false
       )::bigint AS fetcher_clicks,
       COUNT(*) FILTER (
         WHERE is_internal = false
           AND agent_framework NOT IN
             ('human','ChatGPT-User','ClaudeBot','PerplexityBot','GPTBot','Googlebot','Bingbot')
       )::bigint AS unclassified_clicks,
       COUNT(*) FILTER (
         WHERE agent_framework = 'human'
           AND is_internal = false
           AND NOT (COALESCE(referrer, '') ~* '^https?://([^/]+\\.)?buywhere\\.ai(/|$)')
       )::bigint AS unverified_clicks
     FROM affiliate_clicks
     WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [windowDays],
  );
  const bySourceRes = await catalogDb.query<{ source: string; clicks: string }>(
    `SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source,
            COUNT(*)::bigint AS clicks
      FROM affiliate_clicks
      WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND agent_framework = 'human' AND is_internal = false
        AND COALESCE(referrer, '') ~* '^https?://([^/]+\\.)?buywhere\\.ai(/|$)'
      GROUP BY 1
      ORDER BY clicks DESC
      LIMIT 20`,
    [windowDays],
  );
  const byPageRes = await catalogDb.query<{ source_page: string; clicks: string }>(
    `SELECT COALESCE(NULLIF(referrer, ''), 'unknown') AS source_page,
            COUNT(*)::bigint AS clicks
      FROM affiliate_clicks
      WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND agent_framework = 'human' AND is_internal = false
        AND COALESCE(referrer, '') ~* '^https?://([^/]+\\.)?buywhere\\.ai(/|$)'
      GROUP BY 1
      ORDER BY clicks DESC
      LIMIT 20`,
    [windowDays],
  );
  const human = Number(totalRes.rows[0]?.human_clicks ?? 0);
  const fetcher = Number(totalRes.rows[0]?.fetcher_clicks ?? 0);
  const unclassified = Number(totalRes.rows[0]?.unclassified_clicks ?? 0);
  const unverified = Number(totalRes.rows[0]?.unverified_clicks ?? 0);
  return {
    human_clicks: {
      value: human,
      unit: 'clicks',
      definition:
        'Affiliate clicks whose redirect-time User-Agent classifies as human, is not internal, and has a buywhere.ai referrer. KPI.',
      source: 'affiliate_clicks.agent_framework = human AND is_internal = false AND referrer ~ buywhere.ai',
    },
    fetcher_clicks: {
      value: fetcher,
      unit: 'clicks',
      definition:
        'Affiliate clicks whose redirect-time User-Agent is a known agent bot family.',
      source: 'affiliate_clicks.agent_framework IN (ClaudeBot, ChatGPT-User, ...)',
    },
    unclassified_clicks: {
      value: unclassified,
      unit: 'clicks',
      definition:
        'Non-internal clicks where agent_framework is unknown/custom and cannot be counted as human KPI or fetcher traffic.',
      source: 'affiliate_clicks where is_internal = false AND agent_framework NOT IN (human, known bot)',
    },
    unverified_clicks: {
      value: unverified,
      unit: 'clicks',
      definition:
        'Human-looking non-internal clicks without a buywhere.ai referrer. These are reported as unverified, not human KPI.',
      source: 'affiliate_clicks.agent_framework = human AND is_internal = false AND referrer !~ buywhere.ai',
    },
    by_source: bySourceRes.rows.map((r) => ({
      source: String(r.source ?? 'unknown'),
      clicks: Number(r.clicks),
      definition:
        'Click origin: product_card | api_response | other; referrer; api_key_id when an API key was involved.',
    })),
    by_source_page_top_20: byPageRes.rows.map((r) => ({
      source_page: String(r.source_page ?? 'unknown'),
      clicks: Number(r.clicks),
      definition: 'Referrer pathname on human clicks.',
    })),
  };
}

// ─── API / MCP external requests + external keys ──────────────────────
async function loadApi(windowDays: number): Promise<TruthResponse['api']> {
  // External requests: query_log rows where the linked api_key (by id) is not
  // an internal probe per the name/email patterns. We LEFT JOIN to api_keys;
  // a query_log row with no api_key_id is treated as external unless marked
  // is_internal elsewhere. We DO NOT use api_keys.is_internal (column doesn't
  // exist); we filter on name/email pattern as the canonical definition.
  const extReqRes = await db.query<{ external_requests: string }>(
    `SELECT COUNT(q.id)::bigint AS external_requests
       FROM query_log q
       LEFT JOIN api_keys k ON k.id = q.api_key_id
      WHERE q.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND NOT (
          COALESCE(k.name, '')  ~* $2
          OR COALESCE(k.email, '') ~* $2
        )`,
    [windowDays, PROBE_PATTERN.source],
  );

  const extKeysRes = await db.query<{ external_keys: string }>(
    `SELECT COUNT(DISTINCT k.id)::bigint AS external_keys
       FROM api_keys k
      WHERE k.is_active = true
        AND NOT (COALESCE(k.name,'') ~* $1 OR COALESCE(k.email,'') ~* $1)
        AND EXISTS (
          SELECT 1 FROM query_log q
           WHERE q.api_key_id = k.id
             AND q.created_at >= NOW() - ($2::int * INTERVAL '1 day')
        )`,
    [PROBE_PATTERN.source, windowDays],
  );

  const newKeysRes = await db.query<{ new_keys: string }>(
    `SELECT COUNT(*)::bigint AS new_keys
       FROM api_keys
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND NOT (COALESCE(name,'') ~* $2 OR COALESCE(email,'') ~* $2)`,
    [windowDays, PROBE_PATTERN.source],
  );

  return {
    external_requests: {
      value: Number(extReqRes.rows[0]?.external_requests ?? 0),
      unit: 'requests',
      definition:
        'Rows in query_log whose linked api_key name/email does not match any probe pattern (smoke|probe|test|rex|@buywhere.ai|monitor|heartbeat|dispatcher|fetch-monitoring|warmer).',
      source: 'query_log JOIN api_keys (name/email regex filter)',
    },
    external_keys: {
      value: Number(extKeysRes.rows[0]?.external_keys ?? 0),
      unit: 'keys',
      definition:
        'api_keys rows that are active, non-probe, with at least one external request in the window.',
      source: 'api_keys WHERE is_active AND external request in window',
    },
    new_external_keys: {
      value: Number(newKeysRes.rows[0]?.new_keys ?? 0),
      unit: 'keys',
      definition: 'api_keys rows created in window, not matching probe patterns.',
      source: 'api_keys.created_at',
    },
    anonymous_requests: {
      value: null,
      unit: 'requests',
      definition:
        'Keyless read path: tier=anonymous, keyed by ip_hash. Counted as external when shipped.',
      source: 'query_log WHERE tier = anonymous',
      reason: 'n/a — keyless read path not yet shipped',
    },
  };
}

// ─── Catalog: reltuples, merchants-with-products, gross new products/day ─
async function loadCatalog(): Promise<TruthResponse['catalog']> {
  // reltuples + TABLESAMPLE for merchants-with-products (no COUNT(*)).
  const relRes = await catalogDb.query<{ reltuples: string }>(
    `SELECT reltuples::bigint AS reltuples
       FROM pg_class WHERE oid = 'public.products'::regclass`,
  );
  const merchRes = await catalogDb.query<{ merchants_with_products: string }>(
    `SELECT COUNT(*) FILTER (WHERE products_count > 0)::bigint AS merchants_with_products
       FROM merchants TABLESAMPLE BERNOULLI(1)
      WHERE products_count IS NOT NULL`,
  );

  // Gross new products/day: read the snapshot file ops writes via
  // /usr/local/sbin/buywhere-gross-adds.sh. If the file is unreadable or
  // missing, surface n/a — never guess.
  let gross: MetricLine;
  try {
    const stdout = await execFileAsync('/usr/local/sbin/buywhere-gross-adds.sh', [], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    // Output format is "GROSS NEW products: 12,345 in 24.0h (= 12,345/day) | updates ..."
    // We surface the formatted line as the value (it includes the per-day rate),
    // and add the underlying source.
    const line = String(stdout ?? '').trim().split('\n').pop() || '';
    const m = line.match(/GROSS NEW products:\s*(.+?in\s*[\d.]+h[^|]*)/);
    gross = {
      value: m ? m[1].trim() : line,
      unit: 'products/day',
      definition:
        'Delta of pg_stat_user_tables.n_tup_ins on products (inserts only; updates excluded).',
      source: '/root/pgstat_products_daily.log via buywhere-gross-adds.sh',
    };
  } catch (err) {
    gross = {
      value: null,
      unit: 'products/day',
      definition:
        'Delta of pg_stat_user_tables.n_tup_ins on products (inserts only; updates excluded).',
      source: '/root/pgstat_products_daily.log via buywhere-gross-adds.sh',
      reason: `n/a — ${(err as Error).message?.slice(0, 200) || 'unreadable'}`,
    };
  }

  return {
    gross_new_products_per_day: gross,
    catalog_rows_reltuples: {
      value: Number(relRes.rows[0]?.reltuples ?? 0),
      unit: 'rows (estimate)',
      definition:
        'Estimated product rows from pg_class.reltuples. Instant; no COUNT(*) scan.',
      source: 'pg_class.reltuples (products)',
    },
    merchants_with_products: {
      value: Number(merchRes.rows[0]?.merchants_with_products ?? 0),
      unit: 'merchants',
      definition:
        'Merchants with at least one product (products_count > 0). Sample-based estimate (1% Bernoulli).',
      source: 'merchants.products_count > 0 (TABLESAMPLE BERNOULLI 1)',
    },
  };
}

// ─── Indexation line (4seen findings store) ────────────────────────────
async function loadIndexation(windowDays: number): Promise<TruthResponse['indexation']> {
  // The findings store DSN is kept in /home/paperclip/.secrets/findings-store-url.
  // We do NOT bake it into the codebase; the live value is read at request time
  // via an env var (FINDINGS_STORE_URL) that the deploy script sets. If absent,
  // surface n/a so the admin portal can still render.
  const dsn = process.env.FINDINGS_STORE_URL;
  if (!dsn) {
    return {
      index_line: {
        value: null,
        unit: 'index line',
        definition:
          '4seen daily index_daily finding: Google-verified indexed, Bing InIndex, sitemap URLs, dead, new announced.',
        source: 'findings store (product=buywhere)',
        reason: 'n/a — FINDINGS_STORE_URL not configured',
      },
      source: 'env FINDINGS_STORE_URL',
    };
  }
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const r = await pool.query<{
        google_indexed: string | null;
          bing_inindex: string | null;
          sitemap_urls: string | null;
          dead: string | null;
          new_announced: string | null;
        }>(
          `SELECT
             (data->>'google_indexed') AS google_indexed,
             (data->>'bing_inindex')   AS bing_inindex,
             (data->>'sitemap_urls')   AS sitemap_urls,
             (data->>'dead')           AS dead,
             (data->>'new_announced')  AS new_announced
           FROM index_daily
          WHERE product = 'buywhere'
            AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY created_at DESC
          LIMIT 1`,
          [windowDays],
        );
      const row = r.rows[0];
      if (!row) {
        return {
          index_line: {
            value: null,
            unit: 'index line',
            definition:
              '4seen daily index_daily finding: Google-verified indexed, Bing InIndex, sitemap URLs, dead, new announced.',
            source: 'findings store (product=buywhere)',
            reason: 'n/a — no index_daily row in window',
          },
          source: 'findings store (product=buywhere)',
        };
      }
      const value = JSON.stringify({
        google_indexed: row.google_indexed,
        bing_inindex: row.bing_inindex,
        sitemap_urls: row.sitemap_urls,
        dead: row.dead,
        new_announced: row.new_announced,
      });
      return {
        index_line: {
          value,
          unit: 'index line',
          definition:
            '4seen daily index_daily finding: Google-verified indexed, Bing InIndex, sitemap URLs, dead, new announced.',
          source: 'findings store (product=buywhere)',
        },
        source: 'findings store (product=buywhere)',
      };
    } finally {
      await pool.end().catch(() => {});
    }
  } catch (err) {
    return {
      index_line: {
        value: null,
        unit: 'index line',
        definition:
          '4seen daily index_daily finding: Google-verified indexed, Bing InIndex, sitemap URLs, dead, new announced.',
        source: 'findings store (product=buywhere)',
        reason: `n/a — ${(err as Error).message?.slice(0, 200) || 'fetch failed'}`,
      },
      source: 'findings store (product=buywhere)',
    };
  }
}

// ─── PostHog traffic (human pageviews, fetcher pageviews, answer-engine referrals) ──
async function loadTraffic(windowDays: number): Promise<TruthResponse['traffic']> {
  // Server-side PostHog query. We use HogQL via POSTHOG_PAT (per
  // METRICS-DEFINITIONS § Where the numbers live: server-side only, 15-min cache).
  // POSTHOG_PAT is read at request time from env (the deploy writes it from
  // /home/paperclip/.secrets/fleet-secrets.json). If absent, surface n/a.
  const pat = process.env.POSTHOG_PAT;
  const projectId = process.env.POSTHOG_PROJECT_ID || '415112';
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  if (!pat) {
    return {
      human_pageviews: { value: null, unit: 'pageviews', definition: 'posthog-js $pageview (browser JS ran).', source: 'PostHog', reason: 'n/a — POSTHOG_PAT not configured' },
      fetcher_pageviews: { value: null, unit: 'pageviews', definition: 'server-side pageview_server with agent_family in (ClaudeBot, ChatGPT-User, ...).', source: 'PostHog', reason: 'n/a — POSTHOG_PAT not configured' },
      answer_engine_referrals: { value: null, unit: 'pageviews', definition: 'human $pageview whose $referring_domain in (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, bing.com/Copilot).', source: 'PostHog', reason: 'n/a — POSTHOG_PAT not configured' },
      source: 'PostHog (POSTHOG_PAT)',
    };
  }
  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    // HogQL query: total pageviews, distinct fetcher pageviews, answer-engine referrals.
    // We bound is_internal=true (probes) out.
    const body = JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query: `
          SELECT
            countIf(event = '$pageview' AND properties.is_internal IS DISTINCT FROM true) AS human_pageviews,
            countIf(event = 'pageview_server' AND properties.is_internal IS DISTINCT FROM true) AS fetcher_pageviews,
            countIf(
              event = '$pageview'
              AND properties.is_internal IS DISTINCT FROM true
              AND properties.$referring_domain IN ('chatgpt.com','perplexity.ai','claude.ai','gemini.google.com','copilot.microsoft.com','bing.com')
            ) AS answer_engine_referrals
          FROM events
          WHERE timestamp >= toDateTime('${since}')
            AND event IN ('$pageview','pageview_server')
        `,
      },
    });
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`PostHog ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { results?: Array<[number, number, number]> };
    const row = json.results?.[0] ?? [0, 0, 0];
    const [humanPV, fetcherPV, aerefs] = row;
    return {
      human_pageviews: {
        value: Number(humanPV ?? 0),
        unit: 'pageviews',
        definition: 'posthog-js $pageview (browser JS ran).',
        source: 'PostHog (server-side HogQL)',
      },
      fetcher_pageviews: {
        value: Number(fetcherPV ?? 0),
        unit: 'pageviews',
        definition: 'server-side pageview_server with agent_family in (ClaudeBot, ChatGPT-User, ...).',
        source: 'PostHog (server-side HogQL)',
      },
      answer_engine_referrals: {
        value: Number(aerefs ?? 0),
        unit: 'pageviews',
        definition: 'human $pageview whose $referring_domain in (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, bing.com/Copilot).',
        source: 'PostHog (server-side HogQL)',
      },
      source: 'PostHog (server-side HogQL, POSTHOG_PAT)',
    };
  } catch (err) {
    return {
      human_pageviews: { value: null, unit: 'pageviews', definition: 'posthog-js $pageview (browser JS ran).', source: 'PostHog', reason: `n/a — ${(err as Error).message?.slice(0, 200)}` },
      fetcher_pageviews: { value: null, unit: 'pageviews', definition: 'server-side pageview_server.', source: 'PostHog', reason: `n/a — ${(err as Error).message?.slice(0, 200)}` },
      answer_engine_referrals: { value: null, unit: 'pageviews', definition: 'answer-engine $referring_domain.', source: 'PostHog', reason: `n/a — ${(err as Error).message?.slice(0, 200)}` },
      source: 'PostHog (server-side HogQL)',
    };
  }
}

// ─── Growth programme: aeo-page-gate audit line ───────────────────────
async function loadGrowth(): Promise<TruthResponse['growth']> {
  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['/usr/local/sbin/aeo-page-gate.py', '--audit'],
      { timeout: 10_000, maxBuffer: 256 * 1024 },
    );
    // Audit output is a JSON-ish or text line per spec; surface the relevant
    // counts (live / fresh / gate-pass) parsed from the text.
    const live = (String(stdout ?? '').match(/live[^\d]*(\d+)/i) || [])[1];
    const fresh = (String(stdout ?? '').match(/fresh[^\d]*(\d+)/i) || [])[1];
    const gate = (String(stdout ?? '').match(/gate[-_ ]?pass[^\d]*(\d+)/i) || [])[1];
    return {
      gate_audit_line: {
        value: JSON.stringify({
          live: live ? Number(live) : null,
          fresh: fresh ? Number(fresh) : null,
          gate_pass: gate ? Number(gate) : null,
          raw_excerpt: String(stdout ?? '').trim().split('\n').slice(0, 5).join(' | ').slice(0, 400),
        }),
        unit: 'pages',
        definition:
          'aeo-page-gate.py --audit: intent pages live / fresh / gate-pass; daily growth programme rollup.',
        source: '/usr/local/sbin/aeo-page-gate.py --audit',
      },
      source: '/usr/local/sbin/aeo-page-gate.py --audit',
    };
  } catch (err) {
    return {
      gate_audit_line: {
        value: null,
        unit: 'pages',
        definition:
          'aeo-page-gate.py --audit: intent pages live / fresh / gate-pass; daily growth programme rollup.',
        source: '/usr/local/sbin/aeo-page-gate.py --audit',
        reason: `n/a — ${(err as Error).message?.slice(0, 200)}`,
      },
      source: '/usr/local/sbin/aeo-page-gate.py --audit',
    };
  }
}

// ─── Dead-link rate (was_dead_at_click) ───────────────────────────────
async function loadDeadLinks(windowDays: number): Promise<TruthResponse['dead_links']> {
  const r = await catalogDb.query<{
    total: string;
    dead: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE was_dead_at_click IS NOT NULL)::bigint AS total,
       COUNT(*) FILTER (WHERE was_dead_at_click = true)::bigint        AS dead
     FROM affiliate_clicks
     WHERE clicked_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [windowDays],
  );
  const total = Number(r.rows[0]?.total ?? 0);
  const dead = Number(r.rows[0]?.dead ?? 0);
  const rate = total > 0 ? (dead / total) * 100 : null;
  return {
    dead_link_rate_was_dead_at_click: {
      value: rate === null ? null : Number(rate.toFixed(2)),
      unit: '%',
      definition:
        'Share of sampled product URLs returning 404/410 on a HEAD/GET, plus was_dead_at_click share from redirect-time.',
      source: 'affiliate_clicks.was_dead_at_click',
    },
    source: 'affiliate_clicks.was_dead_at_click',
  };
}

// ─── Handler ──────────────────────────────────────────────────────────
const router = Router();

router.get('/v1/admin/metrics/truth', adminAuth, async (req: Request, res: Response) => {
  const rawWindow = String(req.query.window ?? '30d');
  if (rawWindow !== '1d' && rawWindow !== '7d' && rawWindow !== '30d') {
    res.status(400).json({
      error: 'INVALID_WINDOW',
      message: 'window must be one of 1d | 7d | 30d',
      received: rawWindow,
    });
    return;
  }
  const window = parseWindow(rawWindow);
  const windowDays = WINDOW_DAYS[window];
  const key = cacheKey(window);

  // Try cache first.
  const cachedRaw = await redis.get(key).catch(() => null);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as TruthResponse & { _cached_at: string };
      const age = Math.round((Date.now() - new Date(cached._cached_at).getTime()) / 1000);
      res.json({ ...cached, cache_hit: true, cache_age_seconds: age });
      return;
    } catch {
      // fall through and recompute
    }
  }

  // Run all the loads in parallel. Each is wrapped in try/catch internally so
  // a single failure (e.g. findings store unreachable) yields n/a on that one
  // line, not a 500 for the whole payload.
  const [clicks, api, catalog, indexation, traffic, growth, deadLinks] = await Promise.all([
    loadClicks(windowDays).catch((e) => ({
      human_clicks: { value: null, unit: 'clicks', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      fetcher_clicks: { value: null, unit: 'clicks', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      unclassified_clicks: { value: null, unit: 'clicks', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      unverified_clicks: { value: null, unit: 'clicks', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      by_source: [],
      by_source_page_top_20: [],
    } as TruthResponse['clicks'])),
    loadApi(windowDays).catch((e) => ({
      external_requests: { value: null, unit: 'requests', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      external_keys: { value: null, unit: 'keys', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      new_external_keys: { value: null, unit: 'keys', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      anonymous_requests: { value: null, unit: 'requests', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
    } as TruthResponse['api'])),
    loadCatalog().catch((e) => ({
      gross_new_products_per_day: { value: null, unit: 'products/day', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      catalog_rows_reltuples: { value: null, unit: 'rows', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      merchants_with_products: { value: null, unit: 'merchants', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
    } as TruthResponse['catalog'])),
    loadIndexation(windowDays).catch((e) => ({
      index_line: { value: null, unit: 'index line', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      source: 'findings store',
    } as TruthResponse['indexation'])),
    loadTraffic(windowDays).catch((e) => ({
      human_pageviews: { value: null, unit: 'pageviews', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      fetcher_pageviews: { value: null, unit: 'pageviews', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      answer_engine_referrals: { value: null, unit: 'pageviews', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      source: 'PostHog',
    } as TruthResponse['traffic'])),
    loadGrowth().catch((e) => ({
      gate_audit_line: { value: null, unit: 'pages', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      source: 'aeo-page-gate.py',
    } as TruthResponse['growth'])),
    loadDeadLinks(windowDays).catch((e) => ({
      dead_link_rate_was_dead_at_click: { value: null, unit: '%', definition: '', source: '', reason: `n/a — ${(e as Error).message?.slice(0, 200)}` },
      source: 'affiliate_clicks.was_dead_at_click',
    } as TruthResponse['dead_links'])),
  ]);

  const payload: TruthResponse & { _cached_at: string } = {
    window,
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    cache_hit: false,
    cache_age_seconds: 0,
    clicks,
    api,
    catalog,
    indexation,
    traffic,
    growth,
    dead_links: deadLinks,
    _cached_at: new Date().toISOString(),
  };

  // Cache the assembled payload for 15 minutes (independent of window).
  await redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS).catch((e) => {
    console.warn('[metrics-truth] cache write failed:', (e as Error).message);
  });

  res.json({ ...payload, cache_hit: false, cache_age_seconds: 0 });
});

export default router;
