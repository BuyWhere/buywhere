"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UUID_RE = void 0;
exports.buildCompareProductsQuery = buildCompareProductsQuery;
exports.UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function buildCompareProductsQuery(ids) {
    return {
        text: `SELECT p.id, p.sku AS source_id, p.source AS domain, p.url,
                  p.title, p.price, p.currency, p.image_url, p.metadata,
                  p.category_path, p.brand, p.avg_rating AS rating, p.review_count,
                  p.updated_at, p.region, p.country_code
           FROM unnest($1::uuid[]) WITH ORDINALITY AS requested(id, ord)
           JOIN products p ON p.id = requested.id
           ORDER BY requested.ord`,
        values: [ids],
    };
}
