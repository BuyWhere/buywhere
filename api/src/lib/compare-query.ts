// BUY-53179: accept both UUID and numeric IDs (products.id is a bigint, surfaced as text
// by the API). The API's own search returns numeric IDs, so UUID_RE-only validation
// rejected legitimate compare requests from search results.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRODUCT_ID_RE = /^\d+$/;

export function buildCompareProductsQuery(ids: string[]): { text: string; values: [string[]] } {
  const numericIds = ids.filter((id) => PRODUCT_ID_RE.test(id));

  // BWEXT minted-ID: ids listed by /v1/products can exist only in a live child table,
  // so compare must resolve them there too. `products` wins (src 0) when an id is in
  // both; every child lookup rides that child's id index. See lib/liveChildLookup.ts.
  return {
    text: `WITH requested AS (
             SELECT id, ord FROM unnest($1::bigint[]) WITH ORDINALITY AS r(id, ord)
           ), hits AS (
             SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 0 AS src FROM requested JOIN products p ON p.id = requested.id
             UNION ALL SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 1 AS src FROM requested JOIN products_partitioned_sg p ON p.id = requested.id
             UNION ALL SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 2 AS src FROM requested JOIN products_partitioned_us p ON p.id = requested.id
             UNION ALL SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 3 AS src FROM requested JOIN products_partitioned_au p ON p.id = requested.id
             UNION ALL SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 4 AS src FROM requested JOIN products_partitioned_gb p ON p.id = requested.id
             UNION ALL SELECT p.id, p.sku AS source_id, p.source AS domain, p.url, p.title, p.price, p.currency, p.image_url, p.metadata, p.category_path, p.brand, p.avg_rating AS rating, p.review_count, p.updated_at, p.region, p.country_code, requested.ord, 5 AS src FROM requested JOIN products_partitioned_ca p ON p.id = requested.id
           )
           SELECT id, source_id, domain, url, title, price, currency, image_url, metadata,
                  category_path, brand, rating, review_count, updated_at, region, country_code
           FROM (SELECT DISTINCT ON (ord) * FROM hits ORDER BY ord, src) d
           ORDER BY ord`,
    values: [numericIds],
  };
}
