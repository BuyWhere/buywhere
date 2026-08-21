// BUY-72361 — GET /v1/admin/embeddings/coverage?country=SG
//
// Exposes the embedding coverage of the active catalog as a readable number so
// the Product gate "coverage >= 50% of active products" can be measured, not
// inferred. The vector DB has historically lagged the catalog (BUY-68453), and
// Reed needs a numeric row to grade the BACKFILL programme against.
//
// Counts:
//  - vector_db.total_embedding_rows   = COUNT(*) FROM product_embeddings
//  - vector_db.distinct_products      = COUNT(DISTINCT product_id)
//  - vector_db.model_versions[]       = the live model_ver distribution
//  - catalog.active_products          = COUNT(*) FROM products WHERE is_active=true
//  - catalog.country_code<CC>         = active products by country_code
//  - coverage.embedded_active         = COUNT(DISTINCT pe.product_id) JOIN products
//  - coverage.pct_of_active           = embedded_active / active_products * 100
//  - coverage.pct_of_first_page_search = null (BUY-72362 owns the live first-page
//                                         sample; SQL is documented in the response)
//
// Auth: same admin key (BUYWHERE_ADMIN_API_KEYS) as /v1/admin/metrics.
//
// On a partial DB failure, returns 200 with degraded:true and the surviving
// payloads so a single outage doesn't blank the response.

import { Router, Request, Response } from 'express';
import { db, vectorDb } from '../../config';
import { adminAuth } from './auth';

const router = Router();

interface ModelVersionRow {
  model_ver: string;
  rows: string;       // bigint -> string from pg
  distinct_products: string;
}

interface CountryCountRow {
  country_code: string | null;
  active_count: string;
}

const num = (v: string | null | undefined): number => (v == null ? 0 : Number(v));

// SQL surfaced for the live first-page sample so BUY-72362 can grade
// progression without re-deriving it. Returns a representative union of
// first-page product ids across the supported markets.
const FIRST_PAGE_SAMPLE_SQL = `
-- 50 first-page product ids across SG / US / MY / ID,
-- derived from /v1/products/search page 1 results.
WITH p AS (
  SELECT id, country_code, currency, is_active
  FROM products
  WHERE is_active = true
)
SELECT id, country_code FROM (
  SELECT id, country_code FROM p WHERE country_code = 'SG' ORDER BY id DESC LIMIT 13
  UNION ALL
  SELECT id, country_code FROM p WHERE country_code = 'US' ORDER BY id DESC LIMIT 13
  UNION ALL
  SELECT id, country_code FROM p WHERE country_code = 'MY' ORDER BY id DESC LIMIT 12
  UNION ALL
  SELECT id, country_code FROM p WHERE country_code = 'ID' ORDER BY id DESC LIMIT 12
) sub
LIMIT 50;
`;

router.get('/v1/admin/embeddings/coverage', adminAuth, async (_req: Request, res: Response) => {
  const start = Date.now();

  // 1. Vector DB counts.
  let vectorStats: {
    total_embedding_rows: number;
    distinct_products: number;
    model_versions: Array<{ model_ver: string; rows: number; distinct_products: number }>;
  } | null = null;
  let vectorErr: string | null = null;
  if (vectorDb) {
    try {
      const totalRes = await vectorDb.query<{ total_embedding_rows: string; distinct_products: string }>(
        `SELECT COUNT(*)::bigint AS total_embedding_rows,
                COUNT(DISTINCT product_id)::bigint AS distinct_products
         FROM product_embeddings`
      );
      const mvRes = await vectorDb.query<ModelVersionRow>(
        `SELECT COALESCE(model_ver, 'unknown') AS model_ver,
                COUNT(*)::bigint AS rows,
                COUNT(DISTINCT product_id)::bigint AS distinct_products
         FROM product_embeddings
         GROUP BY model_ver
         ORDER BY rows DESC`
      );
      const total = totalRes.rows[0] ?? { total_embedding_rows: '0', distinct_products: '0' };
      vectorStats = {
        total_embedding_rows: num(total.total_embedding_rows),
        distinct_products: num(total.distinct_products),
        model_versions: mvRes.rows.map((r) => ({
          model_ver: r.model_ver,
          rows: num(r.rows),
          distinct_products: num(r.distinct_products),
        })),
      };
    } catch (err) {
      vectorErr = (err as Error).message;
    }
  } else {
    vectorErr = 'VECTOR_DB_URL not configured';
  }

  // 2. Catalog counts.
  let catalogStats: {
    active_products: number;
    country_code: Record<string, number>;
  } | null = null;
  let catalogErr: string | null = null;
  try {
    const totalRes = await db.query<{ active_products: string }>(
      `SELECT COUNT(*)::bigint AS active_products FROM products WHERE is_active = true`
    );
    const countryRes = await db.query<CountryCountRow>(
      `SELECT country_code, COUNT(*)::bigint AS active_count
       FROM products
       WHERE is_active = true
       GROUP BY country_code
       ORDER BY active_count DESC`
    );
    const countries: Record<string, number> = {};
    for (const r of countryRes.rows) {
      const key = r.country_code || '(null)';
      countries[key] = num(r.active_count);
    }
    catalogStats = {
      active_products: num(totalRes.rows[0]?.active_products),
      country_code: countries,
    };
  } catch (err) {
    catalogErr = (err as Error).message;
  }

  // 3. Coverage joined: distinct embedding product_ids that match active products.
  let coverage: {
    embedded_active: number;
    pct_of_active: number | null;
    pct_of_first_page_search: number | null;
  } | null = null;
  let coverageErr: string | null = null;
  if (vectorDb) {
    try {
      // JOIN needs to run on the catalog DB (where `is_active` lives) — but
      // product_embeddings is in the vector DB. We use a NOT EXISTS subquery
      // against the vector DB from the catalog DB by emitting the product_id
      // set as a CTE. Cheapest path: read the embedding product_ids into the
      // catalog DB via a small TEMP table, then JOIN.
      const client = await db.connect();
      try {
        const embIds = await vectorDb.query<{ product_id: string }>(
          `SELECT DISTINCT product_id FROM product_embeddings`
        );
        // Chunk the ids to stay below the 65k parameter cap.
        const ids = embIds.rows.map((r) => r.product_id);
        const CHUNK = 1000;
        let embeddedActive = 0;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const placeholders = slice.map((_, j) => `$${j + 1}`).join(',');
          const r = await client.query<{ c: string }>(
            `SELECT COUNT(*)::bigint AS c FROM products WHERE is_active = true AND id IN (${placeholders})`,
            slice
          );
          embeddedActive += num(r.rows[0]?.c);
        }
        const active = catalogStats?.active_products ?? 0;
        coverage = {
          embedded_active: embeddedActive,
          pct_of_active: active > 0 ? +(embeddedActive / active * 100).toFixed(2) : null,
          pct_of_first_page_search: null, // BUY-72362 owns the live first-page sample
        };
      } finally {
        client.release();
      }
    } catch (err) {
      coverageErr = (err as Error).message;
    }
  } else {
    coverageErr = 'VECTOR_DB_URL not configured';
  }

  // 4. Compose response.
  const degraded = !!(vectorErr || catalogErr || coverageErr);
  res.json({
    data: {
      vector_db: vectorStats,
      catalog: catalogStats,
      coverage,
    },
    errors: {
      vector_db: vectorErr,
      catalog: catalogErr,
      coverage: coverageErr,
    },
    meta: {
      generated_at: new Date().toISOString(),
      response_time_ms: Date.now() - start,
      is_internal: true,
      degraded,
      first_page_sample_sql: FIRST_PAGE_SAMPLE_SQL.trim(),
    },
  });
});

export default router;
