"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.warmSearchCache = warmSearchCache;
const express_1 = require("express");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const readReplica_1 = require("../lib/readReplica");
const apiKey_1 = require("../middleware/apiKey");
const agentDetect_1 = require("../middleware/agentDetect");
const posthog_1 = require("../analytics/posthog");
const cacheStats_1 = require("../monitoring/cacheStats");
const queryLog_1 = require("../middleware/queryLog");
const response_1 = require("../lib/response");
const compare_query_1 = require("../lib/compare-query");
const queryPreprocessor_1 = require("../lib/queryPreprocessor");
const shipsTo_1 = require("../lib/shipsTo");
const instrumentation_1 = require("../lib/instrumentation");
const embedProducts_1 = require("../jobs/embedProducts");
// BUY-31302: 1-hour TTL (was 120s). Reduces cold-miss frequency from every 2min to every 1hr.
// Combined with startup warm-up, cold cache drops to <1s for all seeded queries.
const SEARCH_CACHE_TTL_SECONDS = 3600;
// BUY-41572: bumped from 5s → 15s as a temporary measure so the 50-query hybrid
// eval (BUY-41140) can complete against the live DB. Roundhouse EXPLAIN happy
// path is still ~15-75ms; the 5s ceiling was below the latency budget the API
// advertises and produced 504 upstream_timeout on every search. Mirrors the
// BUY-33985 deals endpoint fix at 15s.
// Sprint A (2026-07-03): env-tunable latency budget. Agents abandon long before
// 15s; degraded-200s replace 504s below so a slow answer is still an answer.
const SEARCH_STATEMENT_TIMEOUT_MS = Math.max(1000, Number(process.env.SEARCH_STATEMENT_TIMEOUT_MS) || 8000);
const SEARCH_HANDLER_TIMEOUT_MS = Math.max(2000, Number(process.env.SEARCH_HANDLER_TIMEOUT_MS) || 10000);
const SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS = 48;
const SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION = 'deliver-to-v6'; // bumped: invalidate pre-fix cached empties/degraded results after the ORDER BY updated_at removal
// BUY-52082: public /v1/products/search now consumes keyword|semantic|hybrid
// using the same Jina + pgvector stack as the MCP tool. If vector infra is
// unavailable, semantic/hybrid requests fall back to the keyword path.
const VALID_SEARCH_MODES = new Set(['keyword', 'semantic', 'hybrid']);
const DEFAULT_SEARCH_MODE = 'keyword';
const VECTOR_CANDIDATE_CAP = 1000;
const HYBRID_RRF_K = 60;
// BUY-34291: cap per-query work_mem to 4MB (down from 64MB default) so concurrent
// search requests don't compete for shared_buffers. Without this, the planner's
// Bitmap Heap Scan on the partial GIN index uses up to 64MB per query, and
// with 50-slot pool × 64MB = 3.2GB potential — exceeds the 2GB shared_buffers.
// Observed production symptom: queries that plan in 29ms in isolation take 10s+
// under concurrent load with PostgreSQL errors
// `could not resize shared memory segment... No space left on device` (SQLSTATE 53200).
// 4MB is enough for the 200-row top-N sort + Nested Loop pkey lookups.
const SEARCH_WORK_MEM = '4MB';
const SEO_SEARCH_FALLBACK_SOURCE = 'seo_search_fallback';
const GENERAL_SEARCH_FALLBACK_TIMEOUT_MS = Math.max(250, Number(process.env.GENERAL_SEARCH_FALLBACK_TIMEOUT_MS) || 1200);
// Express 4 doesn't catch async rejections — unhandled errors crash the process.
// This wrapper ensures all async route handlers return 500 instead of crashing.
function asyncHandler(fn) {
    return (req, res) => {
        fn(req, res).catch((err) => {
            console.error(`[products] unhandled error on ${req.method} ${req.path}:`, err?.message || err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    };
}
// BUY-62624: dedupe product rows by id. A LEFT JOIN on affiliate_links can fan out
// one row per matching affiliate link (same product, multiple tracking URLs), which
// renders identical product cards. Keep the first occurrence (highest-ranked/first in
// the ordered result set) and drop the rest. Applied to every search result path.
function dedupeProductRows(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const id = String(row.id);
        if (seen.has(id))
            continue;
        seen.add(id);
        out.push(row);
    }
    return out;
}
function shiftSqlPlaceholders(sql, offset) {
    return sql.replace(/\$(\d+)/g, (_, idx) => `$${Number(idx) + offset}`);
}
// ── Search-tier path (Phase 3). Serves from the RAM-fitting `search_products` tier
// (quality-gated ~113M rows, ~4.7GB GIN that fits the replica cache -> no timeouts).
// AND-first-then-OR for precision+recall. Returns true if it responded; returns false
// on ANY error/replica issue so the caller falls through to the archive path unchanged
// (hybrid = zero recall risk). Default-on after BUY-61117; opt out with
// SEARCH_USE_TIER=0 or force with ?_tier=1 (test override).
async function tryTierSearch(req, res, p) {
    const lexemes = p.q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
    if (lexemes.length === 0)
        return false;
    const tsOr = lexemes.join(' | ');
    const conds = [];
    const params = [];
    let i = 1;
    const qIdx = i;
    params.push(p.q);
    i++; // $1 = raw q (rank + AND match)
    const orIdx = i;
    params.push(tsOr);
    i++; // $2 = OR lexeme string
    if (p.minPrice != null || p.maxPrice != null) {
        conds.push(`sp.currency = $${i}`);
        params.push(p.currency);
        i++;
    } // hotfix: currency restricts recall only when price-filtering
    if (p.countryCode) {
        conds.push(`sp.country_code = $${i}`);
        params.push(p.countryCode);
        i++;
    }
    if (p.minPrice != null && Number.isFinite(p.minPrice)) {
        conds.push(`sp.price >= $${i}`);
        params.push(p.minPrice);
        i++;
    }
    if (p.maxPrice != null && Number.isFinite(p.maxPrice)) {
        conds.push(`sp.price <= $${i}`);
        params.push(p.maxPrice);
        i++;
    }
    if (p.brand) {
        conds.push(`sp.brand ILIKE $${i}`);
        params.push(`%${p.brand}%`);
        i++;
    }
    if (p.domain) {
        conds.push(`sp.source = $${i}`);
        params.push(p.domain);
        i++;
    }
    // DEF-02: category filter that actually works — normalize the stored category to a
    // slug (lower, spaces->hyphens) and compare to the slug param, instead of the old
    // broken `category ILIKE '%pet-supplies%'` substring match.
    if (p.category) {
        conds.push(`lower(regexp_replace(coalesce(sp.category,''),'\\s+','-','g')) = lower($${i})`);
        params.push(p.category);
        i++;
    }
    let dtIdx = 0;
    if (p.deliverTo) {
        dtIdx = i;
        params.push(p.deliverTo);
        i++;
    } // rank-only: local-first ordering, never filters
    const filterSql = conds.length ? ' AND ' + conds.join(' AND ') : '';
    const limitIdx = i;
    params.push(p.limit + 1);
    i++;
    const offsetIdx = i;
    params.push(p.offset);
    i++;
    const orderPrefix = dtIdx ? `(sp.country_code = $${dtIdx}) DESC NULLS LAST, ` : '';
    const cols = `sp.id, sp.source AS domain, sp.url, al.destination_url AS affiliate_url,
    sp.title, sp.price, sp.currency, sp.image_url, sp.region, sp.country_code, sp.updated_at, sp.in_stock,
    jsonb_build_object('brand', sp.brand, 'category', sp.category,
      'availability', CASE WHEN sp.in_stock IS FALSE THEN 'out_of_stock' ELSE 'in_stock' END) AS metadata`;
    const mkQuery = (match, extraFilter = '') => `
    WITH cand AS (
      SELECT id, search_vector FROM search_products sp
      WHERE ${match}${filterSql}${extraFilter}
      -- perf: no ORDER BY — sorting forces enumeration of the FULL match set before
      -- LIMIT (broad OR fallbacks time out at the 4s tier cap; same anti-pattern as
      -- the archive fix in 9e3ad8e, measured 60x there). LIMIT stops early; ts_rank
      -- below ranks the bounded candidate set.
      LIMIT 5000
    ), top AS (
      SELECT id, ts_rank(search_vector, plainto_tsquery('english', $${qIdx})) AS rank
      FROM cand ORDER BY rank DESC LIMIT 200
    )
    SELECT ${cols}, top.rank AS _fts_rank
    FROM top JOIN search_products sp ON sp.id = top.id
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    ORDER BY ${orderPrefix}top.rank DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const andMatch = `sp.search_vector @@ plainto_tsquery('english', $${qIdx}) AND $${orIdx}::text IS NOT NULL`;
    const orMatch = `sp.search_vector @@ to_tsquery('english', $${orIdx})`;
    const titleFallbackQuery = `
    SELECT ${cols}, 0 AS _fts_rank
    FROM search_products sp
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    WHERE lower(sp.title) LIKE lower($${qIdx} || '%')${filterSql}
    ORDER BY ${orderPrefix}sp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const tokenTitleFallbackQuery = `
    SELECT ${cols}, 0 AS _fts_rank
    FROM search_products sp
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    WHERE lower(sp.title) LIKE lower('%' || $${qIdx} || '%')${filterSql}
    ORDER BY ${orderPrefix}sp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    let client;
    try {
        client = await (0, readReplica_1.servingReadDbConnect)();
    }
    catch {
        return false;
    }
    try {
        await client.query('BEGIN');
        // 6500 (was 4000, 2026-07-18): measured cold tier queries complete in 4.5-6.7s;
        // at 4s they timed out and fell to the archive path which then burned to the 10s
        // handler cap (cache-miss p50 was 4-7s for real agents). 6.5s converts that band
        // into tier successes while leaving headroom inside the 10s handler budget.
        await client.query(`SET LOCAL statement_timeout = '6500'`);
        await client.query(`SET LOCAL gin_fuzzy_search_limit = 0`); // fuzzy sampling breaks multi-word AND
        await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
        let rows = lexemes.length === 1 ? (await client.query(titleFallbackQuery, params)).rows : [];
        if (rows.length === 0) {
            rows = (await client.query(mkQuery(andMatch), params)).rows;
            // BUY-65420: cheap title-contains LIKE before the expensive to_tsquery OR-match.
            // Broad multi-word queries (e.g. "wireless headphones", "nike shoes") produce too
            // many GIN candidates for OR-FTS and timeout at 6500ms. The substring match on
            // the smaller search_products tier is fast and catches the common case.
            if (rows.length === 0 && lexemes.length > 1) {
                rows = (await client.query(tokenTitleFallbackQuery, params)).rows;
            }
            if (rows.length === 0 && lexemes.length > 1) {
                rows = (await client.query(mkQuery(orMatch), params)).rows; // recall fallback
            }
            if (rows.length === 0) {
                rows = (await client.query(titleFallbackQuery, params)).rows;
            }
            if (rows.length === 0 && lexemes.length === 1) {
                rows = (await client.query(tokenTitleFallbackQuery, params)).rows;
            }
        }
        // deliver_to local-first pass (2026-07-14): the cand CTE gathers the NEWEST 5000
        // matches by id, a window that churns under ~4.5M-rows/day ingest and often
        // contains zero rows from the user's country. Run a targeted pass over the
        // composite GIN (country_code, search_vector) and prepend those rows so
        // local products always lead the page when they exist.
        if (dtIdx && rows.length > 0) {
            await client.query('SAVEPOINT localpass'); // a failed local pass must not poison the tx (COMMIT would fail -> archive fallback)
            try {
                const localRows = (await client.query(mkQuery(andMatch, ` AND sp.country_code = $${dtIdx}`), params)).rows;
                if (localRows.length > 0) {
                    const localIds = new Set(localRows.map((r) => String(r.id)));
                    rows = [...localRows, ...rows.filter((r) => !localIds.has(String(r.id)))].slice(0, p.limit + 1);
                }
            }
            catch {
                await client.query('ROLLBACK TO SAVEPOINT localpass').catch(() => { }); /* local pass is best-effort — global rows already in hand */
            }
        }
        await client.query('COMMIT');
        client.release();
        if (rows.length === 0) {
            return false;
        }
        if (res.headersSent)
            return true;
        const hasMore = rows.length > p.limit;
        const pageRows = hasMore ? rows.slice(0, p.limit) : rows;
        const products = pageRows.map((r) => (0, response_1.buildProduct)(r, p.currency, p.compact));
        const total = p.offset + rows.length;
        const responseBody = (0, response_1.buildSearchResponse)(products, total, p.limit, p.offset, Date.now() - p.requestStart, false);
        responseBody.source = 'search_products_tier';
        annotateDeliverTo(responseBody, p.deliverTo, p.includeUnshippable !== false, p.q);
        config_1.redis.set(p.cacheKey, JSON.stringify(responseBody), 'EX', 3600).catch(() => { });
        res.set('X-Search-Tier', '1');
        res.json(responseBody);
        return true;
    }
    catch (e) {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* ignore */ }
        try {
            client.release();
        }
        catch { /* ignore */ }
        console.warn('[tier] fell back to archive:', e?.message);
        return false;
    }
}
async function getCachedQueryEmbedding(query, geminiKey) {
    try {
        const embedKey = `qembed:${Buffer.from(query).toString('base64').slice(0, 48)}`;
        const cached = await config_1.redis.get(embedKey).catch(() => null);
        if (cached)
            return cached;
        // BUY-52466: switched from Jina to Google gemini-embedding-001 (512-dim).
        const vector = await (0, embedProducts_1.embedQuery)(query, geminiKey);
        await config_1.redis.set(embedKey, vector, 'EX', 60).catch(() => { });
        return vector;
    }
    catch (err) {
        console.warn('[products.search] embed query failed, falling back to keyword:', err.message);
        return null;
    }
}
function mergeRrfCandidateIds(ftsIds, semanticIds, limit) {
    const ftsRank = new Map(ftsIds.map((id, idx) => [id, idx + 1]));
    const semanticRank = new Map(semanticIds.map((id, idx) => [id, idx + 1]));
    const allIds = new Set([...ftsIds, ...semanticIds]);
    return [...allIds]
        .map((id) => ({
        id,
        score: 1 / (HYBRID_RRF_K + (ftsRank.get(id) ?? VECTOR_CANDIDATE_CAP + 1)) +
            1 / (HYBRID_RRF_K + (semanticRank.get(id) ?? VECTOR_CANDIDATE_CAP + 1)),
    }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.id);
}
function isSeoHeadQuery(query) {
    return query.trim().split(/\s+/).filter(Boolean).length >= 2;
}
// deliver_to soft contract (2026-07-14): annotate availability relative to the END
// USER's country, optionally filter to local-only, and hint agents to pass deliver_to.
// v1 labels (merchant-country == deliver_to -> 'local', else 'unknown') until
// per-merchant ships-to enrichment lands. Never hides results unless the caller
// explicitly sets include_unshippable=false.
function annotateDeliverTo(body, deliverTo, includeUnshippable, q) {
    const items = body.data || [];
    const meta = body.meta;
    if (deliverTo) {
        for (const it of items) {
            if (it.country_code === deliverTo) {
                it.availability = 'local';
                continue;
            }
            // ships-to upgrade (2026-07-15): merchant-level scope from merchant_shipping.
            const scope = (0, shipsTo_1.shipScopeForUrl)(it.url);
            it.availability = scope === 'worldwide' ? 'ships_to_you'
                : scope === 'domestic' ? 'unavailable'
                    : 'unknown';
        }
        if (!includeUnshippable) {
            const kept = items.filter((it) => it.availability === 'local' || it.availability === 'ships_to_you');
            body.data = kept;
            if (meta)
                meta.total = kept.length;
        }
        if (meta)
            meta.deliver_to = deliverTo;
    }
    else if (q && meta) {
        meta.hint = "Pass deliver_to=<ISO-3166 country of your end user, e.g. deliver_to=SG> to rank products deliverable to them first (adds an availability label per product). Add include_unshippable=false to return only same-country products.";
    }
}
function isLaptopSearchQuery(query) {
    return /\b(laptop|notebook|macbook)\b/i.test(query);
}
function buildSearchTokens(query) {
    return query.toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean)
        .slice(0, 6);
}
const router = (0, express_1.Router)();
// GET /v1/products
// List products with pagination + filter + sort (API v1 contract).
// Query params: page (default 1), limit (default 20, max 100),
//               category (slug, matches category_path[1] case-insensitively),
//               sort (price|name|created_at), order (asc|desc),
//               country_code (default SG), currency
// Response: { data: Product[], pagination: { page, limit, total, total_pages } }
const LIST_SORT_COLUMNS = {
    price: 'price',
    name: 'title',
    created_at: 'created_at',
};
const LIST_SORT_TTL_SECONDS = 60;
router.get('/', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.list'), asyncHandler(async (req, res) => {
    res.locals.cacheHit = false;
    // Backward compatibility: early public docs and clients used
    // `/v1/products?query=...` for search. Treat that as the canonical
    // bounded search route instead of falling through to the unsearched list
    // query, which is intentionally optimized for paginated browsing.
    const legacyQuery = req.query.query;
    if (legacyQuery && !req.query.q) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) {
            if (value === undefined)
                continue;
            const targetKey = key === 'query' ? 'q' : key;
            if (Array.isArray(value)) {
                for (const item of value)
                    searchParams.append(targetKey, String(item));
            }
            else {
                searchParams.set(targetKey, String(value));
            }
        }
        return res.redirect(307, `/v1/products/search?${searchParams.toString()}`);
    }
    const requestStart = Date.now();
    // Pagination — contract defaults: page=1, limit=20, max 100
    const rawPage = parseInt(req.query.page || '1');
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawLimit = parseInt(req.query.limit || '20');
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 100);
    const offset = (page - 1) * limit;
    // Filters — country defaults to SG to prevent cross-region pollution (BUY-6598)
    const category = req.query.category;
    const countryCode = req.query.country_code?.toUpperCase() || 'SG';
    const currency = req.query.currency || (response_1.COUNTRY_CURRENCY[countryCode] || 'SGD');
    // Sort — whitelist to safe columns, default to created_at desc
    const sortParam = req.query.sort || 'created_at';
    const sortColumn = LIST_SORT_COLUMNS[sortParam] || 'created_at';
    const orderParam = req.query.order?.toLowerCase();
    const order = orderParam === 'asc' ? 'ASC' : 'DESC';
    const cacheKey = `list:${currency}:${countryCode}:${category || ''}:${sortColumn}:${order}:${page}:${limit}`;
    try {
        const cached = await (0, cacheStats_1.recordQueryCacheLookup)(config_1.redis, cacheKey, () => config_1.redis.get(cacheKey));
        if (cached) {
            const parsed = JSON.parse(cached);
            parsed.pagination.response_time_ms = Date.now() - requestStart;
            (0, instrumentation_1.recordProductViewsBulk)({
                productIds: (parsed.data || parsed.products || parsed.results || [])
                    .map((product) => product.id)
                    .filter(Boolean),
                source: 'products.list.cache',
                req,
            });
            res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
            res.set('X-Cache', 'HIT');
            res.locals.cacheHit = true;
            return res.json(parsed);
        }
    }
    catch (_) {
        // Redis miss or error — fall through to DB
    }
    const conditions = ['currency = $1', 'is_active = true', 'price > 0'];
    const params = [currency];
    let idx = 2;
    if (countryCode) {
        conditions.push(`country_code = $${idx}`);
        params.push(countryCode);
        idx++;
    }
    if (category) {
        // Treat the contract's `category` param as a slug — match category_path[1]
        // case-insensitively so "electronics" and "Electronics" both work.
        conditions.push(`LOWER(category_path[1]) = LOWER($${idx})`);
        params.push(category);
        idx++;
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const SELECT_COLUMNS = `products.id, products.sku AS source_id, products.source AS domain, products.url,
                NULL::text AS affiliate_url,
                products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
                products.region, products.country_code, products.created_at, products.description, products.brand, products.mpn, products.gtin,
                products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
    // Use id DESC — primary key index is the only valid index on this table (created_at/is_active
    // indexes are invalid due to interrupted CONCURRENTLY builds; BUY-39987 tracks the rebuild).
    // Sort param is honoured for id-tied pages but the primary sort is always id DESC.
    const orderBy = `ORDER BY products.id DESC`;
    const [countResult, dataResult] = await Promise.all([
        // Fast statistical estimate — avoids a full 65M-row COUNT seq scan. The returned value
        // is approximate (pg_class.reltuples is updated by VACUUM/ANALYZE) but accurate enough
        // for pagination totals. Exact counts would hit the 30s statement_timeout.
        config_1.db.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'products'`),
        config_1.db.query(`SELECT ${SELECT_COLUMNS}
         FROM products
         ${whereClause}
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]),
    ]);
    const total = parseInt(countResult.rows[0].count, 10);
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = dataResult.rows.map((row) => (0, response_1.buildProduct)(row, currency, false));
    // BUY-52474: log a product_view per rendered result card so `product_views`
    // grows from real /v1 list traffic. Fire-and-forget; idempotency is
    // enforced in the helper.
    (0, instrumentation_1.recordProductViewsBulk)({
        productIds: data.map((p) => p.id),
        source: 'products.list',
        req,
    });
    const body = {
        data,
        pagination: {
            page,
            limit,
            total,
            total_pages,
            response_time_ms: Date.now() - requestStart,
        },
    };
    config_1.redis.set(cacheKey, JSON.stringify(body), 'EX', LIST_SORT_TTL_SECONDS).catch(() => { });
    if (res.headersSent)
        return;
    res.json(body);
}));
// GET /v1/products/search
// Query params: q, domain, region, country, category, category_id, category_path,
//               brand, merchant_id, availability, min_price, max_price,
//               currency, limit, offset, page, fields, sort, sort_by, source_page, compact
router.get('/search', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.search'), asyncHandler(async (req, res) => {
    // BUY-33987: hard ceiling on the entire request. Even if the per-statement
    // `SET LOCAL statement_timeout` races with the pool's on-connect
    // `SET statement_timeout = 30000`, the response will fire at 5s and the
    // socket will close. Mirrors the BUY-33985 deals fix.
    res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, () => {
        if (!res.headersSent) {
            // Degraded 200, not 504: a fast honest partial answer keeps BuyWhere in the
            // agent's toolchain; a 504 gets the tool dropped from rotation.
            res.status(200).json({
                data: [],
                meta: {
                    total: 0,
                    limit: 20,
                    offset: 0,
                    response_time_ms: Date.now() - requestStart,
                    cached: false,
                    degraded: true,
                },
            });
        }
    });
    const requestStart = Date.now();
    const rawQuery = (req.query.q || req.query.query) || '';
    const domain = req.query.domain;
    const region = req.query.region;
    const category = req.query.category;
    const categoryId = req.query.category_id;
    const categoryPath = req.query.category_path ? req.query.category_path.split(',').map(p => p.trim()).filter(Boolean) : undefined;
    const brand = req.query.brand;
    const merchantId = req.query.merchant_id;
    const availability = req.query.availability;
    const rawFields = req.query.fields || undefined;
    const fields = rawFields ? rawFields.split(',').map(f => f.trim()).filter(Boolean) : undefined;
    const sort = (req.query.sort || req.query.sort_by) || undefined;
    // country_code is the canonical param; `country` is kept as a backward-compat alias.
    // Default to SG when neither country nor region is specified (BUY-6598: prevent cross-region accessory pollution).
    const explicitCountry = (req.query.country_code || req.query.country)?.toUpperCase() || undefined;
    const countryCode = explicitCountry; // hotfix(search): drop silent SG hard-filter default that excluded ~87% untagged catalog
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price) : undefined;
    // Infer default currency from country_code when not explicitly provided.
    // Price filters (min_price/max_price) apply in this inferred currency.
    const currency = req.query.currency || (countryCode ? (response_1.COUNTRY_CURRENCY[countryCode] || 'SGD') : 'SGD');
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const rawPage = parseInt(req.query.page || '0');
    const rawOffset = parseInt(req.query.offset || '0');
    const offset = rawPage > 0 ? (rawPage - 1) * limit : rawOffset;
    const sourcePage = req.query.source_page;
    const compact = req.query.compact === 'true';
    const rawMode = req.query.mode?.toLowerCase();
    const searchMode = rawMode && VALID_SEARCH_MODES.has(rawMode) ? rawMode : DEFAULT_SEARCH_MODE;
    // deliver_to soft contract (2026-07-14): the END USER's country. Ranks local-first
    // and labels availability; never hard-filters (country_code remains the hard filter).
    const deliverTo = (req.query.deliver_to || '').toUpperCase() || undefined;
    const includeUnshippable = req.query.include_unshippable !== 'false';
    // BUY-42589: canonicalize SG retailer brand names (harvey norman, courts, gaincity, etc.)
    // to source= filters. The retailer name is in the source field, not in product titles,
    // so FTS alone returns near-zero matches even when 10k+ products exist.
    const { cleanedQuery, canonicalSources } = (0, queryPreprocessor_1.preprocessSearchQuery)(rawQuery, minPrice, maxPrice);
    const q = cleanedQuery || rawQuery;
    res.locals.cacheHit = false;
    // Sprint C (1.4): normalize the q component of the cache key — lowercase,
    // sorted, punctuation-stripped token set — so "Running Shoes", "running shoe s"
    // orderings and casings share one cache entry (AND/OR matching is order-
    // independent, so results are identical). Falls back to trimmed lowercase q
    // when normalization strips everything (pure-punctuation queries).
    const qNorm = q.toLowerCase().trim().split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).sort().join(' ')
        || q.toLowerCase().trim();
    const cacheKey = `fts:${SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION}:${qNorm}:${domain || ''}:${region || ''}:${countryCode || ''}:${category || ''}:${categoryId || ''}:${categoryPath?.join(',') || ''}:${brand || ''}:${merchantId || ''}:${availability || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${sort || ''}:${fields?.join(',') || ''}:${compact ? 'c' : 'f'}:${searchMode}:${deliverTo || ''}:${includeUnshippable ? '1' : '0'}`;
    try {
        const cached = await (0, cacheStats_1.recordQueryCacheLookup)(config_1.redis, cacheKey, () => config_1.redis.get(cacheKey));
        if (cached) {
            const parsed = JSON.parse(cached);
            const elapsed = Date.now() - requestStart;
            parsed.cached = true;
            parsed.response_time_ms = elapsed;
            const cachedProducts = parsed.products || parsed.results || parsed.data || [];
            (0, instrumentation_1.recordProductViewsBulk)({
                productIds: cachedProducts
                    .map((product) => product.id)
                    .filter(Boolean),
                source: 'products.search.cache',
                queryHash: q ? (0, crypto_1.createHash)('sha256').update(q.toLowerCase()).digest('hex').slice(0, 32) : null,
                req,
            });
            res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
            res.set('X-Cache', 'HIT');
            res.locals.cacheHit = true;
            return res.json(parsed);
        }
    }
    catch (_) {
        // Redis miss or error — fall through to DB
    }
    res.locals.cacheHit = false;
    // BUY-33987: only active products are surfaced to API consumers; the partial
    // GIN index `products_*_search_vector_idx WHERE is_active = true` lets the
    // planner skip dead rows and the inactive non-leaf rows that previously
    // bloated the bitmap. EXPLAIN ANALYZE on roundhouse (post-fix) shows the
    // planner switches to the partial index and execution drops to ~15-30ms.
    // BUY-60385: Exclude zero-price products from search results (deceptive $0.00
    // prices from upstream feeds). A meaningful price > $0 is a basic data quality
    // requirement for any product listing. Products with $0 prices are either
    // out-of-stock markers, missing price fields, or feed parsing errors.
    // BUY-61117: make the RAM-fitting search tier the default for keyword search.
    // Hermes QA found the archive path still returns degraded:true,total=0 for
    // common cold broad queries across SG+US. Tier-first preserves Richmond's
    // single-table archive constraints because it falls through unchanged on any
    // tier error, and SEARCH_USE_TIER=0 remains a runtime kill switch.
    const useSearchTier = req.query._tier === '1' || (req.query._tier !== '0' && process.env.SEARCH_USE_TIER !== '0');
    res.locals.cacheHit = false;
    if (q && searchMode === 'keyword' && useSearchTier) {
        const handled = await tryTierSearch(req, res, {
            q, countryCode, currency, limit, offset, minPrice, maxPrice,
            category, brand, domain, compact, requestStart, cacheKey,
            deliverTo, includeUnshippable,
        });
        if (handled)
            return;
    }
    const baseConditions = ['is_active = true', 'price > 0'];
    const baseParams = [];
    let baseIdx = 1;
    if (minPrice !== undefined || maxPrice !== undefined) {
        baseConditions.push(`currency = $${baseIdx}`);
        baseParams.push(currency);
        baseIdx++;
    }
    // BUY-42589: SG retailer brand queries (harvey norman, courts, gaincity, etc.)
    // map to source= filters since the retailer name is in the source field, not
    // in individual product titles/brands. When only the retailer name was typed
    // (cleanedQuery is empty), fall back to source-only search.
    if (canonicalSources && canonicalSources.length > 0) {
        const sourcePlaceholders = canonicalSources.map((_, i) => `$${baseIdx + i}`).join(',');
        baseConditions.push(`source IN (${sourcePlaceholders})`);
        baseParams.push(...canonicalSources);
        baseIdx += canonicalSources.length;
    }
    if (domain) {
        baseConditions.push(`source = $${baseIdx}`);
        baseParams.push(domain);
        baseIdx++;
    }
    if (region) {
        baseConditions.push(`region = $${baseIdx}`);
        baseParams.push(region);
        baseIdx++;
    }
    if (countryCode) {
        baseConditions.push(`(country_code = $${baseIdx} OR country_code IS NULL)`);
        baseParams.push(countryCode);
        baseIdx++;
    }
    if (category) {
        baseConditions.push(`category ILIKE $${baseIdx}`);
        baseParams.push(`%${category}%`);
        baseIdx++;
    }
    if (brand) {
        baseConditions.push(`brand ILIKE $${baseIdx}`);
        baseParams.push(`%${brand}%`);
        baseIdx++;
    }
    if (availability) {
        const avail = availability.toLowerCase();
        if (avail === 'in_stock') {
            baseConditions.push(`(metadata->>'availability' = $${baseIdx} OR (metadata->>'availability' IS NULL AND is_active = true))`);
            baseParams.push(avail);
            baseIdx++;
        }
        else if (avail === 'out_of_stock') {
            baseConditions.push(`(metadata->>'availability' = $${baseIdx} OR (metadata->>'availability' IS NULL AND is_active = false))`);
            baseParams.push(avail);
            baseIdx++;
        }
        else if (avail === 'preorder' || avail === 'discontinued') {
            baseConditions.push(`metadata->>'availability' = $${baseIdx}`);
            baseParams.push(avail);
            baseIdx++;
        }
    }
    if (categoryId) {
        baseConditions.push(`category_id = $${baseIdx}`);
        baseParams.push(categoryId);
        baseIdx++;
    }
    if (categoryPath && categoryPath.length > 0) {
        const pathPlaceholders = categoryPath.map((_, i) => `$${baseIdx + i}`).join(',');
        baseConditions.push(`category_path @> ARRAY[${pathPlaceholders}]::text[]`);
        baseParams.push(...categoryPath);
        baseIdx += categoryPath.length;
    }
    if (merchantId) {
        baseConditions.push(`merchant_id = $${baseIdx}`);
        baseParams.push(merchantId);
        baseIdx++;
    }
    if (minPrice !== undefined) {
        baseConditions.push(`price >= $${baseIdx}`);
        baseParams.push(minPrice);
        baseIdx++;
    }
    if (maxPrice !== undefined) {
        baseConditions.push(`price <= $${baseIdx}`);
        baseParams.push(maxPrice);
        baseIdx++;
    }
    const searchConditions = [...baseConditions];
    const searchParams = [...baseParams];
    let ftsParamIdx = 0;
    let ftsOrParamIdx = 0;
    let ftsOrFn = 'to_tsquery';
    if (q) {
        // Use full-text search via GIN-indexed search_vector only.
        // The ILIKE fallback was removed: it defeats the GIN index and causes full table scans (3s vs 130ms).
        // MATCH with OR-semantics (to_tsquery 'a | b') so a multi-word query does not require
        // EVERY lexeme in one product. plainto_tsquery AND-joined them ('run' & 'shoe') which gave
        // near-zero recall on the skewed catalog ('running shoes'->0 while 'running'->N, 'shoes'->N).
        // RANK still uses plainto_tsquery (below) so products matching MORE terms sort to the top.
        ftsParamIdx = searchParams.length + 1; // RANK param (plainto / AND-relevance)
        searchParams.push(q);
        const tsOr = q.trim().split(/\s+/)
            .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');
        // Sprint A 0.2: if q is pure punctuation, tsOr is empty — NEVER fall back to
        // feeding raw q into to_tsquery ("no operand in tsquery" -> 500). Use
        // plainto_tsquery for the OR slot instead: it is safe on arbitrary input and
        // yields an empty tsquery (0 results, 200) on junk.
        ftsOrFn = tsOr ? 'to_tsquery' : 'plainto_tsquery';
        ftsOrParamIdx = searchParams.length + 1; // MATCH param (OR-recall)
        searchParams.push(tsOr || q);
        searchConditions.push(`search_vector @@ ${ftsOrFn}('english', $${ftsOrParamIdx})`);
    }
    // AND-first-then-OR (BUY search-tail 2026-07-03): the two match strings + a
    // multi-word flag, used at execution to try the strict plainto (AND) match
    // before the broad to_tsquery (OR) match. See execFtsQuery below.
    const ftsIsMultiWord = q ? q.trim().split(/\s+/).filter(Boolean).length > 1 : false;
    const ftsLexemes = q
        ? q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
        : [];
    const ftsOrMatch = `search_vector @@ ${ftsOrFn}('english', $${ftsOrParamIdx})`;
    // The OR->AND swap below drops the to_tsquery($ftsOrParamIdx) reference, which
    // would orphan that bind param (Postgres: \"could not determine data type of
    // parameter\"). Keep it referenced with an always-true typed no-op so the param
    // stays typed. tsOr is never null (we push `tsOr || q`).
    // Sprint A 1.1-delta: strict pass uses websearch_to_tsquery — same AND semantics
    // as plainto but adds quoted-phrase + '-term' support and is safe on raw input.
    const ftsAndMatch = `search_vector @@ websearch_to_tsquery('english', $${ftsParamIdx}) AND $${ftsOrParamIdx}::text IS NOT NULL`;
    const whereClause = searchConditions.length ? `WHERE ${searchConditions.join(' AND ')}` : '';
    // BUY-33987: SEARCH_STATEMENT_TIMEOUT_MS and SEARCH_HANDLER_TIMEOUT_MS are
    // declared at the top of the file so res.setTimeout() (above) can reference
    // them by lexical scope.
    // Top-N candidates ranked by ts_rank before joining full rows.
    const CANDIDATE_CAP = 200;
    const specColumns = `created_at, description, brand, mpn, gtin, category_path, category, merchant_id, avg_rating, review_count`;
    const specColumnsJoined = `products.created_at, products.description, products.brand, products.mpn, products.gtin, products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
    const joinedColumns = `products.id, products.sku AS source_id, products.source AS domain, products.url,
               al.destination_url AS affiliate_url,
               products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
               products.region, products.country_code, ${specColumnsJoined}`;
    const VALID_SORT = new Set(['relevance', 'price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed']);
    const effectiveSort = sort && VALID_SORT.has(sort) ? sort : undefined;
    const useFtsRanking = (!effectiveSort || effectiveSort === 'relevance') && ftsParamIdx;
    const useSgFreshnessGuardrail = countryCode === 'SG' && (!effectiveSort || effectiveSort === 'relevance') && Boolean(q);
    const freshSearchConditions = useSgFreshnessGuardrail
        ? [...searchConditions, `products.updated_at >= NOW() - INTERVAL '${SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS} hours'`]
        : searchConditions;
    const freshWhereClause = freshSearchConditions.length ? `WHERE ${freshSearchConditions.join(' AND ')}` : '';
    const recentSliceConditions = useSgFreshnessGuardrail
        ? [...baseConditions, `products.updated_at >= NOW() - INTERVAL '${SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS} hours'`]
        : baseConditions;
    const recentSliceWhereClause = recentSliceConditions.length ? `WHERE ${recentSliceConditions.join(' AND ')}` : '';
    const broadRecentSliceWhereClause = baseConditions.length ? `WHERE ${baseConditions.join(' AND ')}` : '';
    function buildSortOrder() {
        if (!effectiveSort || effectiveSort === 'relevance')
            return 'products.updated_at DESC';
        switch (effectiveSort) {
            case 'price_asc': return 'products.price ASC, products.updated_at DESC';
            case 'price_desc': return 'products.price DESC, products.updated_at DESC';
            case 'newest': return 'products.updated_at DESC';
            case 'highest_rated': return 'products.avg_rating DESC NULLS LAST, products.updated_at DESC';
            case 'most_reviewed': return 'products.review_count DESC NULLS LAST, products.updated_at DESC';
            default: return 'products.updated_at DESC';
        }
    }
    // BUY-31302: fix broken search from BUY-28677 (countParams/dataParams/buildDataQuery were
    // never defined, causing ReferenceError → 100% 500 rate).
    // Use LIMIT-pushdown CTE: rank top CANDIDATE_CAP IDs via GIN index, join full rows for
    // only those. Eliminates the separate COUNT query that doubled DB load. Over-fetch by 1
    // to derive has_more without a second scan.
    let dataResult;
    let total = 0;
    let hasMore;
    const requestedRows = limit + 1;
    const limitParamIdx = searchParams.length + 1;
    const offsetParamIdx = searchParams.length + 2;
    const dataParams = [...searchParams, requestedRows, offset];
    // BUY-60112/60117: 5000 was too small — only 23/12062 "dog food" SG products
    // BUY-60123 v2: 50000 is too large — bounded CTE times out at 8s on prod with 1.5M fresh SG products in 48h.
    // Reducing to 2000 keeps the scan in <50ms on the index (products_sg_updated_at_idx). Recall is acceptable
    // because the bounded slice is a fallback — any results beat a degraded 8s timeout.
    // landed in the top-5000-by-id slice. 50k captures 125+ and stays ~50ms on the
    // replica ( MATERIALIZED CTE forces sequential scan of 50k rows, ~50ms cold).
    const RECENT_SLICE_CAP = 2000;
    const seoFallbackTerms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const seoFallbackConditions = baseConditions;
    const seoFallbackParams = baseParams;
    const seoFallbackSourceParamIdx = seoFallbackParams.length + 1;
    const seoFallbackTermStartIdx = seoFallbackSourceParamIdx + 1;
    const seoFallbackTermConditions = seoFallbackTerms.map((_, i) => `products.title ILIKE $${seoFallbackTermStartIdx + i}`);
    const seoFallbackLimitParamIdx = seoFallbackTermStartIdx + seoFallbackTerms.length;
    const seoFallbackOffsetParamIdx = seoFallbackLimitParamIdx + 1;
    const seoFallbackWhereClause = `WHERE ${[
        ...seoFallbackConditions,
        `source = $${seoFallbackSourceParamIdx}`,
        ...(seoFallbackTermConditions.length ? [`(${seoFallbackTermConditions.join(' OR ')})`] : []),
    ].join(' AND ')}`;
    const seoFallbackQuery = `
      WITH fallback_ids AS (
        SELECT id, updated_at
        FROM products
        ${seoFallbackWhereClause}
        ORDER BY updated_at DESC
        LIMIT $${seoFallbackLimitParamIdx} OFFSET $${seoFallbackOffsetParamIdx}
      )
      SELECT ${joinedColumns}
      FROM fallback_ids
      JOIN products ON products.id = fallback_ids.id
      LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
      ORDER BY fallback_ids.updated_at DESC
    `;
    const seoFallbackParamsWithPage = [
        ...seoFallbackParams,
        SEO_SEARCH_FALLBACK_SOURCE,
        ...seoFallbackTerms.map((term) => `%${term}%`),
        requestedRows,
        offset,
    ];
    const laptopSearchTerms = buildSearchTokens(q);
    const isLaptopSearch = q ? isLaptopSearchQuery(q) : false;
    const laptopPositiveTerms = laptopSearchTerms.filter((term) => !['laptop', 'notebook'].includes(term));
    const laptopTermStartIdx = baseIdx;
    const laptopTermConditions = laptopPositiveTerms.map((_, i) => `products.title ILIKE $${laptopTermStartIdx + i}`);
    const laptopLimitParamIdx = laptopTermStartIdx + laptopPositiveTerms.length;
    const laptopOffsetParamIdx = laptopLimitParamIdx + 1;
    const laptopFallbackWhereClause = `WHERE ${[
        ...baseConditions,
        `(products.title ILIKE '%laptop%' OR products.title ILIKE '%notebook%' OR products.title ILIKE '%macbook%' OR products.category ILIKE '%laptop%' OR array_to_string(products.category_path, ' ') ILIKE '%laptop%')`,
        ...(laptopTermConditions.length ? laptopTermConditions : []),
    ].join(' AND ')}`;
    const laptopAccessoryDemotionSql = `
      CASE
        WHEN products.title ~* '\\m(skin|skins|decal|decals|sticker|stickers|sleeve|sleeves|case|cases|cover|covers|protector|protectors)\\M'
          OR products.category ~* '\\m(accessor|accessory|accessories|skin|skins|decal|decals|sleeve|sleeves|case|cases|cover|covers)\\M'
          OR array_to_string(products.category_path, ' ') ~* '\\m(accessor|accessory|accessories|skin|skins|decal|decals|sleeve|sleeves|case|cases|cover|covers)\\M'
        THEN 1 ELSE 0
      END`;
    const laptopFallbackQuery = `
      SELECT ${joinedColumns}, ${laptopAccessoryDemotionSql} AS _accessory_rank
      FROM products
      LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
      ${laptopFallbackWhereClause}
      ORDER BY _accessory_rank ASC, products.updated_at DESC, products.id DESC
      LIMIT $${laptopLimitParamIdx} OFFSET $${laptopOffsetParamIdx}
    `;
    const laptopFallbackParams = [
        ...baseParams,
        ...laptopPositiveTerms.map((term) => `%${term}%`),
        requestedRows,
        offset,
    ];
    const generalFallbackTermConditions = seoFallbackTerms.map((_, i) => `products.title ILIKE $${baseIdx + i}`);
    const generalFallbackLimitParamIdx = baseIdx + seoFallbackTerms.length;
    const generalFallbackWhereClause = `WHERE ${[
        ...baseConditions,
        ...(generalFallbackTermConditions.length ? [`(${generalFallbackTermConditions.join(' OR ')})`] : []),
    ].join(' AND ')}`;
    const generalFallbackQuery = `
      SELECT ${joinedColumns}
      FROM products
      LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
      ${generalFallbackWhereClause}
      ORDER BY products.updated_at DESC
      LIMIT $${generalFallbackLimitParamIdx}
    `;
    const generalFallbackParams = [
        ...baseParams,
        ...seoFallbackTerms.map((term) => `%${term}%`),
        requestedRows,
    ];
    const sendFallbackProducts = async (rows, source) => {
        dataResult = { rows: dedupeProductRows(rows) };
        total = dataResult.rows.length;
        hasMore = dataResult.rows.length > limit;
        if (hasMore)
            dataResult.rows = dataResult.rows.slice(0, limit);
        const responseTimeMs = Date.now() - requestStart;
        const fallbackProducts = dataResult.rows.map((row) => (0, response_1.buildProduct)(row, currency, compact));
        const responseBody = (0, response_1.buildSearchResponse)(fallbackProducts, total, limit, offset, responseTimeMs, hasMore);
        annotateDeliverTo(responseBody, deliverTo, includeUnshippable, q);
        config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => { });
        res.set('X-Search-Fallback', source);
        res.json(responseBody);
    };
    let dataQuery;
    if (useFtsRanking) {
        // BUY-59923: do not sort every FTS hit by ts_rank. High-cardinality brand
        // terms (`iphone 16 pro`, `dyson airwrap`) can match millions of SG rows;
        // `ORDER BY ts_rank(...) LIMIT 200` still computes rank for the full hit set
        // and was timing out at the 15s edge. Bound first by the partition-pruned id
        // index, then rank that small slice for response relevance.
        const rankedWhereClause = useSgFreshnessGuardrail ? freshWhereClause : whereClause;
        dataQuery = `
        WITH recent_hits AS MATERIALIZED (
          SELECT id, country_code
          FROM products
          ${rankedWhereClause}
          -- perf(search): no ORDER BY updated_at — sorting the full FTS match set
          -- (67K–millions of rows) forced a heap scan of every match (nike cold 8.2s->0.14s,
          -- espresso machine 3.7s->0.26s). LIMIT stops early; candidates ranked by ts_rank below.
          LIMIT ${CANDIDATE_CAP}
        ), top_ids AS (
          SELECT rh.id, rh.country_code,
                 ts_rank(rhp.search_vector, plainto_tsquery('english', $${ftsParamIdx})) *
                 CASE
                   WHEN lower(rhp.title) LIKE '%laptop%'
                     AND lower(rhp.title) NOT LIKE '%sleeve%'
                     AND lower(rhp.title) NOT LIKE '%case%'
                     AND lower(rhp.title) NOT LIKE '%bag%'
                     AND lower(rhp.title) NOT LIKE '%stand%'
                     AND lower(rhp.title) NOT LIKE '%pad%'
                     AND lower(rhp.title) NOT LIKE '%cooler%'
                     AND lower(rhp.title) NOT LIKE '%adapter%'
                     AND lower(rhp.title) NOT LIKE '%dock%'
                     AND lower(rhp.title) NOT LIKE '%hub%'
                     AND lower(rhp.title) NOT LIKE '%lock%'
                     AND lower(rhp.title) NOT LIKE '%briefcase%'
                     AND lower(rhp.title) NOT LIKE '%charger%'
                     AND lower(rhp.title) NOT LIKE '%table%'
                   THEN 2.0
                   ELSE 1.0
                 END AS rank
          FROM recent_hits rh
          JOIN products rhp ON rhp.id = rh.id
          ORDER BY rank DESC, rh.id DESC
        )
        SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
        FROM top_ids
        JOIN products ON products.id = top_ids.id AND products.country_code = top_ids.country_code
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY top_ids.rank DESC
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;
    }
    else {
        dataQuery = `
        SELECT ${joinedColumns}
        FROM products
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ${useSgFreshnessGuardrail ? freshWhereClause : whereClause}
        ORDER BY ${buildSortOrder()}
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;
    }
    let client;
    try {
        client = await (0, readReplica_1.servingReadDbConnect)();
    }
    catch (err) {
        if (err instanceof readReplica_1.ReplicaUnavailableError) {
            res.status(503).json({
                error: 'search_replica_unavailable',
                message: err.message,
            });
            return;
        }
        throw err;
    }
    try {
        await client.query('BEGIN');
        // BUY-45671: cap per-query work_mem and disable *parallel* query under load.
        //
        // History: BUY-34291 set `enable_bitmapscan = off` to avoid the
        // `could not resize shared memory segment ... No space left on device`
        // (SQLSTATE 53200) error. But disabling bitmap scans entirely makes the
        // GIN `search_vector` partial index unusable (GIN is only reachable via a
        // bitmap scan), so the planner fell back to a `products_*_currency_idx`
        // btree scan + filter — a near-full scan of products_us (~860k rows).
        // Measured on prod 2026-06-13: `enable_bitmapscan=off` → 35,400ms (504s on
        // every search); `enable_bitmapscan=on` → 161-267ms via the GIN index.
        //
        // The 53200 error came from *parallel* bitmap heap scans: each parallel
        // worker allocates its bitmap in dynamic shared memory (/dev/shm). A
        // single-process bitmap heap scan uses work_mem only and never touches
        // that pool. So we keep bitmap scans on (index usable) but force the
        // search query to run non-parallel. The 53200 catch below stays as a
        // belt-and-suspenders 503 fallback.
        await client.query(`SET LOCAL work_mem = '${SEARCH_WORK_MEM}'`);
        await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
        await client.query(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT_MS}'`);
        await client.query(`SET LOCAL gin_fuzzy_search_limit = 0`);
        // AND-first-then-OR execution (non-SG relevance multi-word queries only; SG
        // queries are already bounded by the freshness guardrail, so their OR cost is
        // capped). Try the strict plainto (AND) match first — a small, fast candidate
        // set (e.g. products literally titled \"dog food\") that avoids unioning the
        // huge \"dog\" | \"food\" posting lists on the memory-starved search replica.
        // Fall back to the broad OR match only when AND under-fills the page (preserves
        // recall for skewed-catalog terms like \"running shoes\" where no product has
        // both lexemes). Non-FTS/sorted queries just run the base query + the existing
        // SG-freshness fallback, unchanged.
        const execFtsQuery = async (baseQuery) => {
            if (useFtsRanking && ftsIsMultiWord) {
                // BUY-61117: the previous bounded SG path materialized a 2000-row slice of
                // ALL fresh SG products (no FTS in the CTE WHERE) then applied the FTS
                // filter after materialization. Without a (country_code, updated_at)
                // index, scanning 1.5M+ fresh SG rows took seconds per query, and the
                // 10-query fallback ladder exceeded the handler timeout → degraded 0-result
                // responses. Fix: include the FTS match IN the CTE WHERE so the GIN index
                // (idx_products_search_country) bounds the scan to matching products only,
                // then sort+limit the small result set. This mirrors the single-word
                // dataQuery pattern that already works in <100ms for SG.
                const runBoundedSgMatch = async (matchExpr, params = dataParams, sliceWhereClause = recentSliceWhereClause) => {
                    const boundedQuery = `
              WITH recent_candidates AS MATERIALIZED (
                SELECT id, country_code
                FROM products
                ${sliceWhereClause}
                  AND ${matchExpr}
                -- perf(search): no ORDER BY updated_at (same early-stop fix as recent_hits above)
                LIMIT ${CANDIDATE_CAP}
              ), top_ids AS (
                SELECT rc.id, rc.country_code, ts_rank(rcp.search_vector, plainto_tsquery('english', $${ftsParamIdx})) AS rank
                FROM recent_candidates rc
                JOIN products rcp ON rcp.id = rc.id
                ORDER BY rank DESC, rc.id DESC
                LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
              )
              SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
              FROM top_ids
              JOIN products ON products.id = top_ids.id AND products.country_code = top_ids.country_code
              LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
              ORDER BY top_ids.rank DESC
            `;
                    return client.query(boundedQuery, params);
                };
                if (useSgFreshnessGuardrail) {
                    // BUY-61117: simplified 4-step ladder. AND match first (precise),
                    // then OR match (recall). Each step tries fresh-48h first, then broad.
                    // The GIN index bounds each query to matching products only, so each
                    // step is fast (<100ms typical). If all 4 steps return 0 rows, the
                    // outer 57014 catch fires the ILIKE timeout fallback as before.
                    let boundedRes = await runBoundedSgMatch(ftsAndMatch);
                    if (boundedRes.rows.length > 0)
                        return boundedRes;
                    boundedRes = await runBoundedSgMatch(ftsAndMatch, dataParams, broadRecentSliceWhereClause);
                    if (boundedRes.rows.length > 0)
                        return boundedRes;
                    boundedRes = await runBoundedSgMatch(ftsOrMatch);
                    if (boundedRes.rows.length > 0)
                        return boundedRes;
                    return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
                }
                // perf+relevance: gather via the BOUNDED id-only AND match (proven ~140ms cold,
                // both-term precise), mirroring the SG path above. The old string-swapped unbounded
                // andQuery fell through to OR-junk in prod (coffee maker -> 'Peacemaker' chair).
                const andQuery = baseQuery.split(ftsOrMatch).join(ftsAndMatch); // retained for SG-widen refs below
                let andRes = await runBoundedSgMatch(ftsAndMatch);
                // SG queries embed the freshness guardrail; if the strict AND match finds
                // nothing fresh, widen it past the freshness window before giving up on AND.
                if (useSgFreshnessGuardrail && andRes.rows.length === 0) {
                    const andFresh = freshWhereClause.split(ftsOrMatch).join(ftsAndMatch);
                    const andBroad = whereClause.split(ftsOrMatch).join(ftsAndMatch);
                    andRes = await client.query(andQuery.replace(andFresh, andBroad), dataParams);
                }
                // BUY-60052: broad 3+ token first-touch queries can still hit the slow
                // zero-AND -> broad-OR fallback (`iphone 16 pro` was observed at 8.5s
                // degraded on a cold SG replica). Before touching OR, try bounded
                // N-1 strict passes (drop one lexeme, keep AND semantics) so common
                // modifier/model queries still return relevant rows from the same
                // recent_hits CTE without unioning huge OR posting lists.
                if (andRes.rows.length === 0 && ftsLexemes.length >= 3) {
                    const relaxedQueries = [...new Map(ftsLexemes
                            .map((lexeme, dropIdx) => ({ lexeme, query: ftsLexemes.filter((__, idx) => idx !== dropIdx).join(' ') }))
                            .sort((a, b) => a.lexeme.length - b.lexeme.length)
                            .map((entry) => [entry.query, entry.query])).values()];
                    for (const relaxedQuery of relaxedQueries) {
                        const relaxedParamIdx = dataParams.length + 1;
                        const relaxedMatch = `search_vector @@ websearch_to_tsquery('english', $${relaxedParamIdx}) AND $${ftsOrParamIdx}::text IS NOT NULL`;
                        const relaxedSql = baseQuery.split(ftsOrMatch).join(relaxedMatch);
                        const relaxedParams = [...dataParams, relaxedQuery];
                        let relaxedRes = await client.query(relaxedSql, relaxedParams);
                        if (useSgFreshnessGuardrail && relaxedRes.rows.length === 0) {
                            const relaxedFresh = freshWhereClause.split(ftsOrMatch).join(relaxedMatch);
                            const relaxedBroad = whereClause.split(ftsOrMatch).join(relaxedMatch);
                            relaxedRes = await client.query(relaxedSql.replace(relaxedFresh, relaxedBroad), relaxedParams);
                        }
                        if (relaxedRes.rows.length > 0)
                            return relaxedRes;
                    }
                }
                // BUY-60112: the remaining zero-AND SG path was still dropping into the
                // broad OR GIN scan and returning 8s degraded empty responses for broad
                // terms (`dog food`, `wireless headphones`, `iphone 16 pro`). Keep OR
                // semantics for recall, but evaluate them over a bounded recent id slice
                // first so first-touch stays fast without re-enabling OR top-up.
                // BUY-59847: non-SG broad probes (e.g. `wireless headphones`, `baby formula`,
                // `dog food`, `nintendo switch`) had zero matches on the strict AND pass
                // then dropped into the unbounded OR top-up below. The OR scan can churn
                // the 4GB replica for the full 8s statement_timeout and return degraded
                // 0-result pages. Reuse the GIN-bounded CTE path (same as SG) over the
                // country/currency broad slice — bounded by CANDIDATE_CAP rows so the
                // scan stays index-friendly — for any zero-AND multi-word non-SG query,
                // before falling through to the unbounded OR top-up.
                if (andRes.rows.length === 0) {
                    const recentSliceRes = await runBoundedSgMatch(ftsOrMatch);
                    if (recentSliceRes.rows.length > 0)
                        return recentSliceRes;
                    return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
                }
                if (andRes.rows.length === 0 && useSgFreshnessGuardrail) {
                    const recentSliceRes = await runBoundedSgMatch(ftsOrMatch);
                    if (recentSliceRes.rows.length > 0)
                        return recentSliceRes;
                    return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
                }
                // Strict AND matches rank first (precise). Sprint C: if AND under-fills
                // the page, TOP UP from the broad OR match (dedup by id) so the page is
                // full without losing precision-first ordering. The OR top-up is best-
                // effort: if it times out on the memory-starved replica, serve the AND
                // rows alone rather than discarding good results for a degraded payload.
                if (andRes.rows.length >= requestedRows)
                    return andRes;
                // Budget guard: the OR top-up can cost up to a full statement timeout on a
                // cold replica. Only attempt it when the request still has comfortable
                // headroom inside the handler window; otherwise a thin-but-precise page
                // NOW beats a degraded empty page at the handler timeout.
                // KILL-SWITCH (2026-07-03): top-up DEFAULT OFF — sustained ~18/hr degraded
                // searches traced to broad OR scans churning the 4GB replica buffers.
                // Re-enable with SEARCH_OR_TOPUP=1 once the search tier (plan Phase 3)
                // gives OR scans a working set that fits in RAM.
                if (andRes.rows.length > 0 && process.env.SEARCH_OR_TOPUP !== '1')
                    return andRes;
                if (andRes.rows.length > 0 && Date.now() - requestStart > 2000)
                    return andRes;
                if (andRes.rows.length > 0) {
                    try {
                        let orRes = await client.query(baseQuery, dataParams);
                        if (useSgFreshnessGuardrail && orRes.rows.length === 0) {
                            orRes = await client.query(baseQuery.replace(freshWhereClause, whereClause), dataParams);
                        }
                        const seenIds = new Set(andRes.rows.map((r0) => String(r0.id)));
                        const merged = [...andRes.rows];
                        for (const row of orRes.rows) {
                            if (merged.length >= requestedRows)
                                break;
                            const rid = String(row.id);
                            if (!seenIds.has(rid)) {
                                seenIds.add(rid);
                                merged.push(row);
                            }
                        }
                        return { rows: merged };
                    }
                    catch {
                        // OR top-up timed out/failed — the transaction is aborted, so recover
                        // it and serve the precise AND rows we already have.
                        await client.query('ROLLBACK').catch(() => { });
                        await client.query('BEGIN').catch(() => { });
                        await client.query(`SET LOCAL work_mem = '${SEARCH_WORK_MEM}'`).catch(() => { });
                        await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`).catch(() => { });
                        await client.query(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT_MS}'`).catch(() => { });
                        return andRes;
                    }
                }
            }
            let r = await client.query(baseQuery, dataParams);
            if (useSgFreshnessGuardrail && r.rows.length === 0) {
                r = await client.query(baseQuery.replace(freshWhereClause, whereClause), dataParams);
            }
            return r;
        };
        const geminiKey = process.env.GEMINI_API_KEY ?? '';
        const activeVectorDb = q !== '' && searchMode !== 'keyword' && config_1.vectorDb != null && geminiKey !== ''
            ? config_1.vectorDb
            : null;
        // BUY-60082: SEO landing head queries may have curated fallback rows even
        // when broad multi-token FTS is too expensive. Read those rows first via a
        // tightly bounded source/country/currency predicate so `/api/products/search`
        // returns real product cards instead of the degraded empty timeout response.
        // BUY-59982 / BUY-60623: laptop category queries are high-cardinality in FTS
        // and can burn the full request budget before any fallback runs. They also
        // matched accessory SKUs (skins/decals/sleeves) too strongly. Use a bounded
        // product-intent path first, with accessories demoted behind actual laptops.
        if (isLaptopSearch && countryCode === 'US' && offset === 0 && !domain && !merchantId && !canonicalSources?.length) {
            const laptopFallbackResult = await client.query(laptopFallbackQuery, laptopFallbackParams);
            if (laptopFallbackResult.rows.length > 0) {
                await client.query('COMMIT');
                client.release();
                await sendFallbackProducts(laptopFallbackResult.rows, 'laptop_product_intent');
                return;
            }
        }
        // BUY perf 2026-07-14: this SEO-head pre-empt ran a slow title-ILIKE seq scan (~8s)
        // BEFORE the FTS path for EVERY >=2-word query (isSeoHeadQuery = "2+ words"), returning
        // ILIKE junk ("coffee maker" -> "Coffee Cookie Stamp"). Now that the FTS candidate gather
        // is fast (~150ms), skip the pre-empt so FTS serves relevant results. Re-enable for
        // curated SEO landing rows only via SEO_HEAD_PREEMPT=1.
        if (process.env.SEO_HEAD_PREEMPT === '1' && q && isSeoHeadQuery(q) && offset === 0 && !domain && !merchantId && !canonicalSources?.length) {
            const seoFallbackResult = await client.query(seoFallbackQuery, seoFallbackParamsWithPage);
            if (seoFallbackResult.rows.length > 0) {
                await client.query('COMMIT');
                client.release();
                await sendFallbackProducts(seoFallbackResult.rows, SEO_SEARCH_FALLBACK_SOURCE);
                return;
            }
        }
        if (activeVectorDb) {
            const queryVector = await getCachedQueryEmbedding(q, geminiKey);
            if (queryVector) {
                const candidateCap = Math.min(Math.max(requestedRows * 10, 200), VECTOR_CANDIDATE_CAP);
                const semanticCandidates = await activeVectorDb.query(`SELECT product_id FROM product_embeddings
             ORDER BY embedding <=> $1::vector
             LIMIT $2`, [queryVector, candidateCap]);
                const rawSemanticIds = semanticCandidates.rows.map((row) => row.product_id);
                let filteredSemanticIds = [];
                if (rawSemanticIds.length > 0) {
                    const vectorFilterQuery = `
              SELECT id
              FROM products
              WHERE id = ANY($1::bigint[]) AND ${baseConditions.map((condition) => shiftSqlPlaceholders(condition, 1)).join(' AND ')}
            `;
                    const vectorFilterResult = await client.query(vectorFilterQuery, [rawSemanticIds, ...baseParams]);
                    const allowedIds = new Set(vectorFilterResult.rows.map((row) => row.id));
                    filteredSemanticIds = rawSemanticIds.filter((id) => allowedIds.has(id));
                }
                let rankedCandidateIds = filteredSemanticIds;
                if (searchMode === 'hybrid') {
                    const ftsCandidates = await client.query(`SELECT id
               FROM products
              ${useSgFreshnessGuardrail ? freshWhereClause : whereClause}
               ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC
               LIMIT 200`, searchParams);
                    rankedCandidateIds = mergeRrfCandidateIds(ftsCandidates.rows.map((row) => row.id), filteredSemanticIds, candidateCap);
                }
                total = rankedCandidateIds.length;
                hasMore = total > offset + limit;
                if (total === 0) {
                    dataResult = { rows: [] };
                }
                else if (!effectiveSort || effectiveSort === 'relevance') {
                    const pageIds = rankedCandidateIds.slice(offset, offset + requestedRows);
                    const detailResult = await client.query(`SELECT ${joinedColumns}
               FROM products
               LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
               WHERE products.id = ANY($1::bigint[])`, [pageIds]);
                    const byId = new Map(detailResult.rows.map((row) => [row.id, row]));
                    dataResult = {
                        rows: pageIds.map((id) => byId.get(id)).filter(Boolean),
                    };
                }
                else {
                    dataResult = await client.query(`SELECT ${joinedColumns}
               FROM products
               LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
               WHERE products.id = ANY($1::bigint[])
               ORDER BY ${buildSortOrder()}
               LIMIT $2 OFFSET $3`, [rankedCandidateIds, requestedRows, offset]);
                }
            }
            else {
                dataResult = await execFtsQuery(dataQuery);
            }
        }
        else {
            dataResult = await execFtsQuery(dataQuery);
        }
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        const pgErr = err;
        if (pgErr.code === '57014') {
            if (q && offset === 0 && !domain && !merchantId && !canonicalSources?.length) {
                try {
                    await client.query('BEGIN');
                    await client.query(`SET LOCAL statement_timeout = '${GENERAL_SEARCH_FALLBACK_TIMEOUT_MS}'`);
                    const fallbackResult = await client.query(generalFallbackQuery, generalFallbackParams);
                    await client.query('COMMIT');
                    if (fallbackResult.rows.length > 0 && !res.headersSent) {
                        client.release();
                        await sendFallbackProducts(fallbackResult.rows, 'general_search_fallback');
                        return;
                    }
                }
                catch {
                    await client.query('ROLLBACK').catch(() => { });
                }
            }
            // BUY-60112/60117 last-resort: SG multi-word zero-AND queries time out on
            // the unbounded GIN scan. Use a simple ILIKE scan — no id threshold (IDs are
            // in the trillions for this table, so id > 800000000 matches ALL rows and
            // forces a slow index scan). ORDER BY id DESC + LIMIT lets Postgres push the
            // limit into a parallel sequential scan of just the matching rows (~700ms cold).
            if (countryCode === 'SG' && ftsParamIdx && ftsIsMultiWord && !domain && !merchantId && !canonicalSources?.length) {
                try {
                    const tokens = q.trim().split(/\s+/).filter(Boolean);
                    const ilikeConditions = tokens.map((_, i) => `title ILIKE $${baseIdx + i}`);
                    const ilikeParams = tokens.map((t) => `%${t}%`);
                    const sgFallbackQuery = `
              SELECT ${joinedColumns}, 0 AS _fts_rank
              FROM products
              WHERE ${baseConditions.join(' AND ')}
                AND (${ilikeConditions.join(' AND ')})
              ORDER BY id DESC
              LIMIT $${baseIdx + tokens.length} OFFSET $${baseIdx + tokens.length + 1}
            `;
                    await client.query('BEGIN');
                    const sgFallbackResult = await client.query(sgFallbackQuery, [...baseParams, ...ilikeParams, requestedRows, offset]);
                    await client.query('COMMIT');
                    if (sgFallbackResult.rows.length > 0 && !res.headersSent) {
                        client.release();
                        await sendFallbackProducts(sgFallbackResult.rows, 'sg_timeout_fallback');
                        return;
                    }
                }
                catch {
                    await client.query('ROLLBACK').catch(() => { });
                }
            }
            client.release();
            if (!res.headersSent) {
                res.status(200).json({
                    data: [],
                    meta: {
                        total: 0,
                        limit: 20,
                        offset: 0,
                        response_time_ms: 0,
                        cached: false,
                        degraded: true,
                    },
                });
            }
            return;
        }
        // BUY-34291: shared_buffers exhaustion (SQLSTATE 53200) under load — return
        // 503 with retry hint instead of crashing. The query was correct; the DB
        // is just under memory pressure. Client should retry.
        if (pgErr.code === '53200' || (typeof err?.message === 'string' && err.message.includes('No space left on device'))) {
            client.release();
            if (!res.headersSent) {
                res.status(503).json({ error: 'Search temporarily unavailable', reason: 'db_memory_pressure', retry_after_ms: 1000 });
            }
            return;
        }
        client.release();
        throw err;
    }
    client.release();
    // BUY-62624: collapse affiliate_links fan-out duplicates before pagination
    // math so hasMore reflects distinct results.
    dataResult.rows = dedupeProductRows(dataResult.rows);
    if (typeof hasMore === 'undefined') {
        hasMore = dataResult.rows.length > limit;
        if (hasMore)
            dataResult.rows.pop();
        total = offset + dataResult.rows.length + (hasMore ? 1 : 0);
    }
    else if (dataResult.rows.length > limit) {
        dataResult.rows = dataResult.rows.slice(0, limit);
    }
    const responseTimeMs = Date.now() - requestStart;
    const products = dataResult.rows.map((row) => (0, response_1.buildProduct)(row, currency, compact));
    // Apply field selection if `fields` param is specified
    let filteredProducts = products;
    if (fields && fields.length > 0) {
        const VALID_FIELDS = new Set([
            'id', 'name', 'price', 'url', 'merchant', 'category', 'country',
            'ingested_at', 'updated_at', 'description', 'image_url', 'images',
            'brand', 'sku', 'mpn', 'gtin', 'availability', 'compare_at_price',
            'rating', 'title', 'country_code', 'region',
            'canonical_id', 'normalized_price_usd', 'structured_specs',
            'comparison_attributes', 'metadata', 'original_price', 'discount_pct',
            'affiliate_url', 'click_url', 'affiliate_redirect_url',
            'has_affiliate_tracking', 'is_affiliate', 'affiliate_disclosure',
        ]);
        const requested = fields.filter(f => VALID_FIELDS.has(f));
        if (requested.length > 0) {
            filteredProducts = products.map(p => {
                const picked = {};
                for (const f of requested) {
                    if (f in p) {
                        picked[f] = p[f];
                    }
                }
                return picked;
            });
        }
    }
    const responseBody = (0, response_1.buildSearchResponse)(filteredProducts, total, limit, offset, responseTimeMs, hasMore ?? false);
    annotateDeliverTo(responseBody, deliverTo, includeUnshippable, q);
    // Cache result in Redis (fire-and-forget)
    config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => { });
    // Extract categories from results for analytics
    const categories = extractCategories(products);
    // BUY-31298: pass behavioral context to queryLogMiddleware via res.locals so the
    // single trackApiUsage call captures all fields (api_key_id, result_status, latency_ms
    // are always present on the middleware event — no duplicate legacy event needed).
    if (req.apiKeyRecord) {
        res.locals.queryIntent = inferQueryIntent(q, domain, minPrice, maxPrice);
        res.locals.productCategories = categories;
        res.locals.signupChannel = req.apiKeyRecord.signupChannel;
        res.locals.sourcePage = sourcePage || null;
        (0, posthog_1.trackProductSearch)({
            apiKey: (0, apiKey_1.hashKey)(req.apiKeyRecord.key),
            apiKeyId: req.apiKeyRecord.id,
            queryText: q,
            resultCount: products.length,
            responseTimeMs,
        });
    }
    // BUY-52474: log a product_view per search-result card so the
    // `product_views` table grows from real /v1 search traffic. We use a
    // queryHash so dedup-keyed views from the same search query collapse
    // into a single row per (product, query, second). Fire-and-forget.
    (0, instrumentation_1.recordProductViewsBulk)({
        productIds: products.map((p) => p.id),
        source: 'products.search',
        queryHash: q ? (0, crypto_1.createHash)('sha256').update(q.toLowerCase()).digest('hex').slice(0, 32) : null,
        req,
    });
    if (res.headersSent)
        return;
    res.json(responseBody);
}));
// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
// BUY-60309: reduced timeouts (DEALS_QUERY_TIMEOUT_MS=4500, DEALS_RESPONSE_TIMEOUT_MS=5000),
// removed COUNT query, bounded sampling from recent active candidates.
// Timeout/cancel returns HTTP 200 with degraded envelope instead of 504.
// BUY-33985: dedicated client with statement_timeout + res.setTimeout to prevent hangs.
// BUY-41572: previously bumped from 5s → 15s (now reduced per BUY-60309).
const DEALS_QUERY_TIMEOUT_MS = 4500;
const DEALS_RESPONSE_TIMEOUT_MS = 5000;
const DEALS_SAMPLE_CAP = 5000; // max candidates to sample for deals
router.get('/deals', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.deals'), asyncHandler(async (req, res) => {
    res.locals.cacheHit = false;
    const start = Date.now();
    const currency = req.query.currency || 'SGD';
    const countryCode = (req.query.country_code || req.query.country)?.toUpperCase() || undefined;
    const minDiscount = parseFloat(req.query.min_discount || '10');
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const cacheKey = `deals:${currency}:${countryCode || ''}:${minDiscount}:${limit}:${offset}`;
    try {
        const cached = await (0, cacheStats_1.recordQueryCacheLookup)(config_1.redis, cacheKey, () => config_1.redis.get(cacheKey));
        if (cached) {
            const parsed = JSON.parse(cached);
            parsed.cached = true;
            parsed.response_time_ms = Date.now() - start;
            (0, instrumentation_1.recordProductViewsBulk)({
                productIds: (parsed.products || parsed.results || parsed.data || [])
                    .map((product) => product.id)
                    .filter(Boolean),
                source: 'products.deals.cache',
                req,
            });
            res.locals.cacheHit = true;
            return res.json(parsed);
        }
    }
    catch (_) { }
    // Express-side response timeout. Fires after DEALS_RESPONSE_TIMEOUT_MS
    // regardless of the DB state — guarantees the socket closes within 5s
    // so the client never sees a 30s+ hang.
    // BUY-60309: returns HTTP 200 with degraded envelope instead of 504.
    res.setTimeout(DEALS_RESPONSE_TIMEOUT_MS, () => {
        if (!res.headersSent) {
            try {
                res.status(200).json({
                    data: [],
                    meta: {
                        total: 0,
                        limit: 20,
                        offset: 0,
                        response_time_ms: Date.now() - start,
                        cached: false,
                        degraded: true,
                    },
                });
            }
            catch (_) { }
        }
    });
    // Deals: prefer a populated discount_pct column (BUY-14332/BUY-64109), fall
    // back to inline computation only if the column is absent or empty.
    const dealConditions = ['currency = $1', 'price > 0'];
    const dealParams = [currency];
    let dealIdx = 2;
    let useDiscountCol = true;
    // Probe whether discount_pct is usable (cached per-process). BUY-64109: the
    // production table has a populated plain numeric discount_pct column, so
    // requiring is_generated = 'ALWAYS' incorrectly forced the metadata fallback.
    if (typeof router._hasDiscountPct === 'undefined') {
        try {
            const probe = await config_1.db.query(`SELECT c.is_generated, EXISTS (
             SELECT 1 FROM products
             WHERE is_active = true AND price > 0 AND discount_pct > 0
             LIMIT 1
           ) AS has_positive_discounts
           FROM information_schema.columns c
           WHERE c.table_name = 'products' AND c.column_name = 'discount_pct'
           LIMIT 1`);
            router._hasDiscountPct = probe.rows.length > 0
                && (probe.rows[0].is_generated === 'ALWAYS' || probe.rows[0].has_positive_discounts === true);
        }
        catch {
            router._hasDiscountPct = false;
        }
    }
    useDiscountCol = router._hasDiscountPct;
    if (useDiscountCol) {
        dealConditions.push(`discount_pct >= $${dealIdx}`);
    }
    else {
        dealConditions.push(`(metadata->>'original_price')::numeric > price`);
        dealConditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $${dealIdx}`);
    }
    dealParams.push(minDiscount);
    dealIdx++;
    if (countryCode) {
        dealConditions.push(`country_code = $${dealIdx}`);
        dealParams.push(countryCode);
        dealIdx++;
    }
    const discountSelect = useDiscountCol
        ? 'discount_pct'
        : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const discountOrder = useDiscountCol
        ? 'discount_pct DESC'
        : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;
    // BUY-60309: removed COUNT query and added bounded sampling.
    // Sample recent active candidates, then filter/order that bounded slice.
    // BUY-45692: deals is a heavy aggregate rollup — route to the read replica
    // when available (readDb() falls back to primary if unconfigured or lagging),
    // isolating it from interactive /v1/products/search on the primary.
    const dealsClient = await (0, readReplica_1.readDb)().connect();
    let deals = [];
    let total = 0;
    let degraded = false;
    try {
        // BUY-34291: cap work_mem too (same shared_buffers pressure reasoning as search)
        await dealsClient.query(`SET work_mem = '${SEARCH_WORK_MEM}'`);
        await dealsClient.query(`SET statement_timeout = ${DEALS_QUERY_TIMEOUT_MS}`);
        // BUY-64109: first take a bounded recent active slice, then filter/order it.
        // Filtering discount_pct before the LIMIT misses newly backfilled deals when
        // the planner chooses a slow full-table path and times out.
        const candidateParams = [DEALS_SAMPLE_CAP, ...dealParams, limit, offset];
        const filterConditions = dealConditions
            .map((condition) => condition.replace(/\$(\d+)/g, (_match, idx) => `$${Number(idx) + 1}`))
            .join(' AND ');
        const sampleResult = await dealsClient.query(`SELECT *
         FROM (
           SELECT id, sku AS source_id, source AS domain, url,
                  title, price,
                  CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                       THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
                  currency, image_url, metadata, updated_at,
                  region, country_code, created_at, description, brand, mpn, gtin,
                  category_path, category, merchant_id, avg_rating, review_count,
                  ${discountSelect}
           FROM products
           WHERE is_active = true AND price > 0
           ORDER BY updated_at DESC
           LIMIT $1
         ) _recent_deals
         WHERE ${filterConditions}
         ORDER BY updated_at DESC
         LIMIT $${candidateParams.length - 1} OFFSET $${candidateParams.length}`, candidateParams);
        // Filter and order the bounded sample in memory (fast, no DB timeout risk)
        const sampleDeals = sampleResult.rows
            .filter(row => {
            // Apply discount threshold - already in WHERE but double-check for safety
            const discountPct = row.discount_pct;
            return discountPct !== null && discountPct >= minDiscount;
        })
            .sort((a, b) => {
            // Order by discount descending, then updated_at descending
            const discountDiff = (b.discount_pct || 0) - (a.discount_pct || 0);
            if (discountDiff !== 0)
                return discountDiff;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        })
            .slice(offset, offset + limit);
        total = sampleDeals.length; // Return actual count of sampled results
        deals = sampleDeals.map((row) => (0, response_1.buildProduct)(row, currency, false));
    }
    catch (err) {
        // BUY-60309: on timeout/cancel, return HTTP 200 degraded instead of crashing
        const pgErr = err;
        if (pgErr.code === '57014' || pgErr.code === '57000') {
            // Query cancelled or statement timeout
            degraded = true;
            deals = [];
            total = 0;
        }
        else {
            throw err; // Re-throw other errors
        }
    }
    finally {
        dealsClient.release();
    }
    const responseBody = (0, response_1.buildSearchResponse)(deals, total, limit, offset, Date.now() - start, false, degraded);
    config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => { });
    // BUY-52474: log a product_view per deals card so /v1/products/deals drives
    // product_views growth alongside /search and /:id.
    (0, instrumentation_1.recordProductViewsBulk)({
        productIds: deals.map((p) => p.id),
        source: 'products.deals',
        req,
    });
    res.locals.cacheHit = false;
    res.json(responseBody);
}));
// GET /v1/products/compare?ids=id1,id2,id3
router.get('/compare', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.compare'), asyncHandler(async (req, res) => {
    const start = Date.now();
    const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 10);
    if (ids.length < 2) {
        res.status(400).json({ error: 'Provide at least 2 product IDs via ?ids=id1,id2' });
        return;
    }
    // BUY-53179: accept both UUID and numeric product IDs. The API's own
    // /v1/products/search returns numeric IDs like 1126150856089603981, so
    // UUID-only validation breaks the contract between search and compare.
    const invalidIds = ids.filter((id) => {
        const trimmed = id.trim();
        return !compare_query_1.UUID_RE.test(trimmed) && !compare_query_1.PRODUCT_ID_RE.test(trimmed);
    });
    if (invalidIds.length > 0) {
        res.status(400).json({ error: `Invalid product ID(s): ${invalidIds.join(', ')}` });
        return;
    }
    const { text, values } = (0, compare_query_1.buildCompareProductsQuery)(ids);
    const result = await config_1.db.query(text, values);
    const products = result.rows.map((row) => (0, response_1.buildProduct)(row, 'SGD', false));
    const uniqueCurrencies = [...new Set(products.map((p) => p.price.currency).filter(Boolean))];
    const currenciesMixed = uniqueCurrencies.length > 1;
    const responseBody = (0, response_1.buildSearchResponse)(products, products.length, ids.length, 0, Date.now() - start, false);
    // BUY-52474: log a product_view per side-by-side product card so the
    // /v1/products/compare surface also drives product_views growth.
    (0, instrumentation_1.recordProductViewsBulk)({
        productIds: products.map((p) => p.id),
        source: 'products.compare',
        req,
    });
    res.json({
        ...responseBody,
        currencies_mixed: currenciesMixed,
        ...(currenciesMixed && {
            currency_warning: `Products span multiple currencies (${uniqueCurrencies.join(', ')}). Prices are not comparable across currencies — do not aggregate or rank by price in comparison_summary.`,
        }),
    });
}));
// GET /v1/products/:id/price-history — daily aggregated price history (BUY-2345)
// Query params: days (30|90|180, default 30)
router.get('/:id/price-history', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.price-history'), asyncHandler(async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    if (!compare_query_1.PRODUCT_ID_RE.test(String(id))) {
        res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
        return;
    }
    const days = Math.min(parseInt(req.query.days || '30'), 180);
    const [productResult, historyResult] = await Promise.all([
        config_1.db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
        config_1.db.query(`SELECT
           DATE(recorded_at AT TIME ZONE 'UTC') AS day,
           currency,
           MIN(price)::float AS min_price,
           MAX(price)::float AS max_price,
           ROUND(AVG(price)::numeric, 2)::float AS avg_price,
           COUNT(*) AS data_points
         FROM price_history
         WHERE product_id = $1
           AND recorded_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE(recorded_at AT TIME ZONE 'UTC'), currency
         ORDER BY day ASC`, [id, days]),
    ]);
    if (productResult.rows.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const p = productResult.rows[0];
    const daily = historyResult.rows.map((row) => ({
        day: row.day,
        currency: row.currency,
        min: row.min_price,
        max: row.max_price,
        avg: row.avg_price,
        data_points: parseInt(row.data_points, 10),
    }));
    const allPrices = daily.length
        ? { min: Math.min(...daily.map((d) => d.min)), max: Math.max(...daily.map((d) => d.max)), avg: +(daily.reduce((a, d) => a + d.avg, 0) / daily.length).toFixed(2) }
        : null;
    res.json({
        data: {
            product_id: p.id,
            title: p.title,
            current_price: p.price ? parseFloat(p.price) : null,
            currency: p.currency,
            daily,
            stats: allPrices,
        },
        meta: { days, response_time_ms: Date.now() - start },
    });
}));
// GET /v1/products/:id/prices — price history from price_snapshots
router.get('/:id/prices', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.prices'), asyncHandler(async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    if (!compare_query_1.PRODUCT_ID_RE.test(String(id))) {
        res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
        return;
    }
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const [productResult, historyResult] = await Promise.all([
        config_1.db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
        config_1.db.query(`SELECT price, currency, recorded_at AS scraped_at
         FROM price_history
         WHERE product_id = $1 AND recorded_at >= NOW() - ($2 || ' days')::interval
         ORDER BY recorded_at ASC`, [id, days]),
    ]);
    if (productResult.rows.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const p = productResult.rows[0];
    const history = historyResult.rows.map((row) => ({
        price: parseFloat(row.price),
        currency: row.currency,
        at: row.scraped_at,
    }));
    const prices = history.map((h) => h.price);
    res.json({
        data: {
            product_id: p.id,
            title: p.title,
            current_price: p.price ? parseFloat(p.price) : null,
            currency: p.currency,
            history,
            stats: prices.length
                ? { min: Math.min(...prices), max: Math.max(...prices), avg: +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2), data_points: prices.length }
                : null,
        },
        meta: { days, response_time_ms: Date.now() - start },
    });
}));
// GET /v1/products/:id/similar — BUY-41134 Find-Similar endpoint
// Primary: KNN on pre-computed embedding from embedding-store.product_embeddings.
// Fallback: same brand + category (B-tree index) if embedding not yet populated.
// Latency target: p95 ≤ 200 ms under load.
router.get('/:id/similar', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.similar'), asyncHandler(async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    if (!compare_query_1.PRODUCT_ID_RE.test(String(id))) {
        res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
        return;
    }
    const limit = Math.min(parseInt(req.query.limit || '10'), 20);
    // Verify product exists in main DB
    const srcResult = await config_1.db.query(`SELECT id, title, brand, category_path, currency, country_code
       FROM products WHERE id = $1`, [id]);
    if (srcResult.rows.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const src = srcResult.rows[0];
    // Phase 1: Try embedding-based KNN (vector store).
    // BUY-54718 / BUY-41137 / BUY-54796: use the shared vectorDb pool and the
    // live public.product_embeddings schema so this route follows the Railway
    // wiring instead of a separate VECTOR_STORE_DATABASE_URL.
    let similar = [];
    let similarityFallback = false;
    if (config_1.vectorDb) {
        try {
            // Fetch pre-computed embedding for this product.
            const embResult = await config_1.vectorDb.query(`SELECT embedding FROM public.product_embeddings
           WHERE product_id = $1`, [id]);
            if (embResult.rows.length > 0) {
                const embeddingStr = embResult.rows[0].embedding;
                // KNN: rows with smallest cosine distance first.
                const knnResult = await config_1.vectorDb.query(`SELECT product_id,
                    1 - (embedding <=> $1::vector) AS score
             FROM public.product_embeddings
             WHERE product_id != $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`, [embeddingStr, id, limit]);
                const knnIds = knnResult.rows.map((r) => String(r.product_id));
                const knnScores = new Map(knnResult.rows.map((r) => [String(r.product_id), parseFloat(r.score)]));
                if (knnIds.length > 0) {
                    // Fetch full product details from main DB.
                    const placeholders = knnIds.map((_, i) => `$${i + 1}`).join(',');
                    const detailResult = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                      image_url, brand, category_path, region, country_code
               FROM products
               WHERE id IN (${placeholders})`, knnIds);
                    const detailById = new Map(detailResult.rows.map((row) => [String(row.id), row]));
                    similar = knnIds.flatMap((knnId) => {
                        const row = detailById.get(knnId);
                        return row ? [{
                                ...row,
                                _similarity: knnScores.get(knnId) ?? null,
                            }] : [];
                    });
                }
            }
            else {
                // No embedding yet — fall through to fallback.
                similarityFallback = true;
            }
        }
        catch (err) {
            console.warn('[similar] vector KNN failed, using fallback:', err.message);
            similarityFallback = true;
        }
    }
    // Phase 2 (fallback): same brand + category, or FTS on title
    if (similarityFallback || similar.length === 0) {
        const currency = src.currency || 'SGD';
        const sourceCountry = src.country_code || null;
        const brand = src.brand || null;
        const topCategory = src.category_path?.[0] || null;
        if (brand && topCategory) {
            const params = [id, brand, topCategory, currency];
            let where = `id != $1 AND brand = $2 AND category_path[1] = $3 AND currency = $4`;
            if (sourceCountry) {
                where += ` AND country_code = $5`;
                params.push(sourceCountry);
            }
            params.push(limit);
            const bcResult = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                  image_url, brand, category_path, region, country_code
           FROM products
           WHERE ${where}
           ORDER BY updated_at DESC
           LIMIT $${params.length}`, params);
            similar = bcResult.rows.map((row) => ({ ...row, _similarity: null }));
        }
        if (similar.length < limit && src.title) {
            const needed = limit - similar.length;
            const existingIds = [id, ...similar.map((r) => r.id)];
            const placeholders = existingIds.map((_, i) => `$${i + 1}`).join(',');
            let ftsIdx = existingIds.length + 1;
            let ftsWhere = `id NOT IN (${placeholders}) AND currency = $${ftsIdx}`;
            const ftsParams = [...existingIds, currency];
            ftsIdx++;
            ftsWhere += ` AND search_vector @@ plainto_tsquery('english', $${ftsIdx})`;
            ftsParams.push(src.title);
            ftsIdx++;
            if (sourceCountry) {
                ftsWhere += ` AND country_code = $${ftsIdx}`;
                ftsParams.push(sourceCountry);
                ftsIdx++;
            }
            ftsParams.push(needed);
            const ftsResult = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                  image_url, brand, category_path, region, country_code
           FROM products
           WHERE ${ftsWhere}
           ORDER BY updated_at DESC
           LIMIT $${ftsParams.length}`, ftsParams);
            similar = [...similar, ...ftsResult.rows.map((row) => ({ ...row, _similarity: null }))];
        }
    }
    const data = similar.slice(0, limit).map((row) => ({
        id: row.id,
        source: row.source_id,
        domain: row.domain,
        url: row.url,
        title: row.title,
        price: row.price ? parseFloat(row.price) : null,
        currency: row.currency,
        image_url: row.image_url || null,
        brand: row.brand || null,
        category_path: row.category_path || null,
        region: row.region || null,
        country_code: row.country_code || null,
        similarity: row._similarity ?? null,
    }));
    res.json({
        data,
        meta: {
            source_id: id,
            count: data.length,
            method: config_1.vectorDb && !similar.length ? 'fallback' : config_1.vectorDb ? 'knn' : 'fallback',
            response_time_ms: Date.now() - start,
        },
    });
}));
// GET /v1/products/featured
// Keep this route above /:id so Express does not treat "featured" as a product id.
router.get('/featured', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.featured'), asyncHandler(async (req, res) => {
    res.locals.cacheHit = false;
    const start = Date.now();
    const rawCountry = req.query.country_code || req.query.country;
    const countryCode = rawCountry?.toUpperCase() || 'SG';
    const currency = req.query.currency || (response_1.COUNTRY_CURRENCY[countryCode] || 'SGD');
    const limit = Math.min(parseInt(req.query.limit || '12'), 50);
    const offset = Math.max(parseInt(req.query.offset || '0'), 0);
    const compact = req.query.compact === 'true';
    const cacheKey = `featured:${countryCode}:${currency}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
    try {
        const cached = await (0, cacheStats_1.recordQueryCacheLookup)(config_1.redis, cacheKey, () => config_1.redis.get(cacheKey));
        if (cached) {
            const parsed = JSON.parse(cached);
            parsed.cached = true;
            parsed.response_time_ms = Date.now() - start;
            (0, instrumentation_1.recordProductViewsBulk)({
                productIds: (parsed.products || parsed.results || parsed.data || [])
                    .map((product) => product.id)
                    .filter(Boolean),
                source: 'products.featured.cache',
                req,
            });
            res.locals.cacheHit = true;
            return res.json(parsed);
        }
    }
    catch (_) { }
    const result = await (0, readReplica_1.readDb)().query(`SELECT id, sku AS source_id, source AS domain, url,
              NULL::text AS affiliate_url,
              title, price, currency, image_url, metadata, updated_at,
              region, country_code
       FROM products
       WHERE is_active = true
         AND country_code = $1
         AND currency = $2
         AND price IS NOT NULL
       ORDER BY id DESC
       LIMIT $3 OFFSET $4`, [countryCode, currency, limit, offset]);
    const products = result.rows.map((row) => (0, response_1.buildProduct)(row, currency, compact));
    const responseBody = (0, response_1.buildSearchResponse)(products, products.length, limit, offset, Date.now() - start, false);
    config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', 300).catch(() => { });
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.locals.cacheHit = false;
    res.json(responseBody);
}));
// GET /v1/products/:id
router.get('/:id', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.get'), asyncHandler(async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    if (!compare_query_1.PRODUCT_ID_RE.test(String(id))) {
        res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
        return;
    }
    let result;
    try {
        result = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url,
                title, price, currency, image_url, metadata, updated_at,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count
         FROM products WHERE id = $1`, [id]);
    }
    catch (err) {
        console.error('[products/:id] db query error:', err);
        res.status(500).json({ error: 'Internal server error' });
        return;
    }
    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const row = result.rows[0];
    const product = (0, response_1.buildProduct)(row, 'SGD', false);
    if (req.apiKeyRecord) {
        const elapsedMs = Date.now() - start;
        // BUY-31298: feed behavioral context through res.locals; trackApiUsage via
        // queryLogMiddleware always captures api_key_id, result_status, latency_ms.
        res.locals.queryIntent = 'lookup';
        res.locals.productCategories = extractCategories([product]);
        res.locals.signupChannel = req.apiKeyRecord.signupChannel;
        (0, posthog_1.trackProductView)({
            apiKey: (0, apiKey_1.hashKey)(req.apiKeyRecord.key),
            apiKeyId: req.apiKeyRecord.id,
            productId: row.id,
            retailer: row.domain,
            category: (Array.isArray(row.category_path) ? row.category_path[0] : (typeof row.category_path === 'string' ? row.category_path.split(' > ')[0] : null)),
            latencyMs: elapsedMs,
        });
    }
    // BUY-52474: log a product_view for /v1/products/:id detail renders so the
    // `product_views` table grows from real /v1 detail traffic. Fire-and-forget
    // so the response is never blocked on the insert.
    (0, instrumentation_1.recordProductView)({
        productId: row.id,
        source: 'products.get',
        req,
    });
    const responseBody = (0, response_1.buildSearchResponse)([product], 1, 1, 0, Date.now() - start, false);
    res.json(responseBody);
}));
function inferQueryIntent(q, domain, minPrice, maxPrice) {
    const lower = q.toLowerCase();
    if (minPrice !== undefined && maxPrice !== undefined)
        return 'price_check';
    if (/\bvs\b|compare|comparison|difference/i.test(lower))
        return 'comparison';
    if (/buy|purchase|order|checkout/i.test(lower))
        return 'purchase_intent';
    if (q.length === 0 && domain)
        return 'bulk_catalog';
    if (q.length > 0)
        return 'discovery';
    return 'bulk_catalog';
}
// POST /v1/products/ingest
// Bulk ingest products from scraper agents. Requires API key auth.
// Upserts on (platform, platform_id) — safe to re-run.
router.post('/ingest', apiKey_1.requireApiKey, asyncHandler(async (req, res) => {
    const start = Date.now();
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Body must be a non-empty array of products' });
        return;
    }
    if (items.length > 500) {
        res.status(400).json({ error: 'Maximum 500 products per request' });
        return;
    }
    const VALID_PLATFORMS = new Set([
        'amazon_sg', 'amazon_uk', 'amazon_us', 'asos', 'audiohouse', 'bestdenki', 'books_com_tw', 'bukalapak',
        'carousell', 'castlery', 'challenger', 'coldstorage', 'coupang', 'courts',
        'decathlon', 'ezbuy', 'fairprice', 'flipkart', 'fortytwo', 'gaincity', 'giant',
        'guardian', 'harvey_norman', 'hengfohtong', 'hipvan', 'iherb', 'ikea', 'ishopchangi', 'kohepets',
        'lazada', 'lovebonito', 'maybelline', 'merchant_direct', 'metro', 'mothercare', 'motherswork',
        'mustafa', 'myntra', 'nike', 'petloverscentre', 'popular', 'qoo10', 'rakuten',
        'redmart', 'robinsons', 'sasa', 'sephora', 'shein', 'shengsiong', 'shopee',
        'stereo', 'tangs', 'tiki', 'tokopedia', 'toysrus', 'uniqlo', 'vuori', 'watsons', 'zalora',
    ]);
    const rows = [];
    const errors = [];
    for (let i = 0; i < items.length; i++) {
        const p = items[i];
        if (!p || typeof p !== 'object') {
            errors.push(`[${i}] not an object`);
            continue;
        }
        if (!p.platform || !VALID_PLATFORMS.has(p.platform)) {
            errors.push(`[${i}] invalid or missing platform`);
            continue;
        }
        if (!p.name || typeof p.name !== 'string') {
            errors.push(`[${i}] missing name`);
            continue;
        }
        if (!p.price || isNaN(parseFloat(p.price))) {
            errors.push(`[${i}] missing or invalid price`);
            continue;
        }
        if (!p.product_url && !p.productUrl) {
            errors.push(`[${i}] missing product_url`);
            continue;
        }
        const platformId = p.platform_id || p.platformId || p.product_id || p.id || '';
        const sku = p.sku || platformId || `${p.platform}-${i}`;
        rows.push({
            id: require('crypto').randomUUID(),
            platform: p.platform,
            platformId,
            sku,
            name: String(p.name).slice(0, 1000),
            price: parseFloat(p.price),
            currency: p.currency || (p.country_code ? response_1.COUNTRY_CURRENCY[p.country_code.toUpperCase()] : null) || (p.countryCode ? response_1.COUNTRY_CURRENCY[p.countryCode.toUpperCase()] : null) || 'SGD',
            gtin: p.gtin ? String(p.gtin).slice(0, 14) : undefined,
            mpn: p.mpn ? String(p.mpn).slice(0, 100) : undefined,
            productUrl: p.product_url || p.productUrl,
            merchantId: p.merchant_id || p.merchantId || p.platform,
            merchantName: p.merchant_name || p.merchantName || p.platform,
            originalPrice: p.original_price || p.originalPrice
                ? (() => {
                    const op = parseFloat(p.original_price || p.originalPrice);
                    const cp = parseFloat(p.price);
                    return !isNaN(op) && !isNaN(cp) && op > cp && op <= cp * 10 ? op : undefined;
                })()
                : undefined,
            brand: p.brand ? String(p.brand).slice(0, 200) : undefined,
            description: p.description ? String(p.description).slice(0, 5000) : undefined,
            imageUrl: p.image_url || p.imageUrl || undefined,
            images: Array.isArray(p.images) ? p.images.slice(0, 20) : undefined,
            categoryPath: Array.isArray(p.category_path || p.categoryPath)
                ? (p.category_path || p.categoryPath).slice(0, 10)
                : ['Uncategorized'],
            availability: p.availability || 'in_stock',
            region: p.region || undefined,
            countryCode: p.country_code || p.countryCode || undefined,
        });
    }
    if (rows.length === 0) {
        res.status(400).json({ error: 'No valid products', validation_errors: errors });
        return;
    }
    // Auto-create merchant records for any new merchant IDs (BUY-8788)
    const uniqueMerchants = new Map();
    for (const r of rows) {
        if (!uniqueMerchants.has(r.merchantId)) {
            uniqueMerchants.set(r.merchantId, {
                name: r.merchantName,
                source: r.platform,
                country: r.countryCode || 'SG',
            });
        }
    }
    for (const [mid, info] of uniqueMerchants) {
        await config_1.db.query(`INSERT INTO merchants (id, name, source, country, is_active, onboarding_stage)
         VALUES ($1, $2, $3, $4, true, 'active')
         ON CONFLICT (id) DO NOTHING`, [mid, info.name, info.source, info.country]).catch(() => { });
    }
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
        const result = await config_1.db.query(`INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code, gtin, mpn,
            search_vector)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,
                 to_tsvector('english',
                   COALESCE($4,'') || ' ' ||
                   COALESCE($11,'') || ' ' ||
                   COALESCE(array_to_string($10::text[],' '),'')
                 ))
         ON CONFLICT (sku, source, country_code)
         DO UPDATE SET
           title = EXCLUDED.title,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           image_url = EXCLUDED.image_url,
           metadata = products.metadata || EXCLUDED.metadata,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           gtin = COALESCE(EXCLUDED.gtin, products.gtin),
           mpn = COALESCE(EXCLUDED.mpn, products.mpn),
           search_vector = to_tsvector('english',
             COALESCE(EXCLUDED.title,'') || ' ' ||
             COALESCE(EXCLUDED.brand,'') || ' ' ||
             COALESCE(array_to_string(EXCLUDED.category_path,' '),'')
           ),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`, [
            r.sku, r.platform, r.merchantId, r.name, r.description || null,
            r.price, r.currency, r.productUrl, r.imageUrl || null,
            r.categoryPath.length ? `{${r.categoryPath.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}` : '{}',
            r.brand || null,
            JSON.stringify({ original_price: r.originalPrice, merchant_name: r.merchantName, availability: r.availability }),
            // products is partitioned by country_code; the partition's `region`
            // column is NOT NULL and the column default ('sg') only applies when
            // the column is omitted from the INSERT. We're listing the column,
            // so we must supply a value. Default to country_code lowercased,
            // then 'sg' as the last-resort fallback.
            r.region || (r.countryCode ? r.countryCode.toLowerCase() : null) || 'sg',
            r.countryCode || null,
            r.gtin || null, r.mpn || null,
        ]).catch(() => null);
        if (result && result.rows[0]) {
            if (result.rows[0].is_insert)
                inserted++;
            else
                updated++;
        }
    }
    res.status(207).json({
        accepted: rows.length,
        inserted,
        updated,
        skipped: items.length - rows.length,
        validation_errors: errors.length > 0 ? errors : undefined,
        duration_ms: Date.now() - start,
    });
}));
function extractCategories(products) {
    const cats = new Set();
    for (const p of products) {
        const source = p.domain || (typeof p.merchant === 'object' ? p.merchant?.domain : p.merchant) || '';
        if (source) {
            const domainName = source.replace('.sg', '').replace('.com', '');
            cats.add(domainName);
        }
        if (p.metadata && typeof p.metadata === 'object') {
            const meta = p.metadata;
            if (typeof meta['category'] === 'string')
                cats.add(meta['category']);
            if (typeof meta['sub_category'] === 'string')
                cats.add(meta['sub_category']);
        }
    }
    return Array.from(cats).slice(0, 10);
}
// ─────────────────────────────────────────────────────────────
// Cache warm-up — BUY-31302
// Runs once at startup, seeds Redis with results for the most common
// search queries × country combos. Cold queries hit DB at 3-10s; warm
// queries return from Redis in <5ms. With 3600s TTL most queries stay
// warm across basket runs.
// ─────────────────────────────────────────────────────────────
const WARM_SEED_QUERIES = [
    // SG — high-traffic consumer electronics & daily items
    { q: 'iPhone 15 Pro', country: 'SG' },
    { q: 'Samsung Galaxy S24', country: 'SG' },
    { q: 'laptop', country: 'SG' },
    { q: 'wireless earbuds', country: 'SG' },
    { q: 'running shoes', country: 'SG' },
    { q: 'coffee maker', country: 'SG' },
    { q: 'rice cooker', country: 'SG' },
    { q: 'air fryer', country: 'SG' },
    { q: 'bluetooth speaker', country: 'SG' },
    { q: 'gaming mouse', country: 'SG' },
    { q: 'monitor 27 inch', country: 'SG' },
    { q: 'mechanical keyboard', country: 'SG' },
    { q: 'Nike shoes', country: 'SG' },
    { q: 'Adidas sneakers', country: 'SG' },
    { q: 'hand cream moisturizer', country: 'SG' },
    { q: 'sunscreen SPF 50', country: 'SG' },
    { q: 'vitamin C supplement', country: 'SG' },
    { q: 'yoga mat', country: 'SG' },
    { q: 'power bank', country: 'SG' },
    { q: 'tablet', country: 'SG' },
    // US — high-traffic
    { q: 'iPhone 15 Pro', country: 'US' },
    { q: 'laptop', country: 'US' },
    { q: 'wireless earbuds', country: 'US' },
    { q: 'running shoes', country: 'US' },
    { q: 'coffee maker', country: 'US' },
    { q: 'air fryer', country: 'US' },
    { q: 'bluetooth speaker', country: 'US' },
    { q: 'gaming mouse', country: 'US' },
    { q: 'monitor', country: 'US' },
    { q: 'mechanical keyboard', country: 'US' },
];
async function warmSearchCache() {
    const startMs = Date.now();
    let warmed = 0;
    let skipped = 0;
    for (const { q, country } of WARM_SEED_QUERIES) {
        try {
            const currency = country === 'US' ? 'USD' : 'SGD';
            const limit = 20;
            const offset = 0;
            // Must match the handler's cacheKey exactly:
            // fts:q:domain:region:country:category:catId:catPath:brand:merchantId:avail:currency:minP:maxP:limit:offset:sort:fields:compact
            // With all defaults empty: fts:q:::country:::::::currency:::limit:offset:::f
            const cacheKey = `fts:${q}:::${country}:::::::${currency}:::${limit}:${offset}:::f`;
            const existing = await config_1.redis.get(cacheKey).catch(() => null);
            if (existing) {
                skipped++;
                continue;
            }
            // Sprint C: stagger cold warm-queries so the 4-min loop doesn't stampede
            // the replica with all seeds at once.
            await new Promise((resolve) => setTimeout(resolve, 1500));
            // Build the query the same way the handler does
            // BUY-33987: include `is_active = true` so the warm CTE matches the
            // handler's CTE exactly AND so the planner can pick the partial GIN
            // index `products_*_search_vector_idx WHERE is_active = true`. Without
            // this, the warm path is slower than the live path and the warm cache
            // becomes a liability instead of an asset.
            const conditions = ['currency = $1', 'is_active = true', 'price > 0'];
            const params = [currency];
            let idx = 2;
            const ftsParamIdx = idx;
            conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
            params.push(q);
            idx++;
            conditions.push(`country_code = $${idx}`);
            params.push(country);
            idx++;
            const whereClause = `WHERE ${conditions.join(' AND ')}`;
            const CANDIDATE_CAP = 200;
            const specColumnsJoined = `products.created_at, products.description, products.brand, products.mpn, products.gtin, products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
            const joinedColumns = `products.id, products.sku AS source_id, products.source AS domain, products.url,
                 al.destination_url AS affiliate_url,
                 products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
                 products.region, products.country_code, ${specColumnsJoined}`;
            // BUY-32028: remove ts_rank ORDER BY (missed by e8f407dc BUY-31540 in warmSearchCache
            // CTE). The warmSearchCache path was excluded from the original fix; on broad US queries
            // (laptop+US = 70k+ matches) the CTE materializes all matches before LIMIT and
            // exceeds the warm-up window, leaving cache cold and forcing the live handler onto the
            // same slow path. Mirrors the live handler's CTE exactly so warm entries match cache keys.
            const dataQuery = `
        WITH top_ids AS (
          SELECT id, country_code
          FROM products
          ${whereClause}
          ORDER BY id DESC
          LIMIT ${CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}
        FROM top_ids
        JOIN products ON products.id = top_ids.id AND products.country_code = top_ids.country_code
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY products.updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
            params.push(limit + 1, offset);
            const result = await config_1.db.query(dataQuery, params);
            const hasMore = result.rows.length > limit;
            if (hasMore)
                result.rows.pop();
            const total = result.rows.length + (hasMore ? 1 : 0);
            const products = result.rows.map((row) => (0, response_1.buildProduct)(row, currency, false));
            const responseBody = (0, response_1.buildSearchResponse)(products, total, limit, offset, 0, hasMore);
            await config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS);
            warmed++;
        }
        catch (err) {
            // Non-fatal: log but don't block startup
            console.warn(`[cache-warm] failed for q="${q}" country=${country}:`, err?.message);
        }
    }
    const elapsed = Date.now() - startMs;
    console.log(`[cache-warm] done: ${warmed} warmed, ${skipped} already cached, ${elapsed}ms`);
}
exports.default = router;
