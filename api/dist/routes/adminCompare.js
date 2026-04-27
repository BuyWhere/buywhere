"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
// Admin auth middleware — checks Authorization: Bearer <ADMIN_API_KEY>
function requireAdminKey(req, res, next) {
    if (!ADMIN_API_KEY) {
        res.status(503).json({ error: 'Admin API not configured' });
        return;
    }
    const auth = req.headers['authorization'] || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key || key !== ADMIN_API_KEY) {
        res.status(401).json({ error: 'Admin API key required' });
        return;
    }
    next();
}
// Slug validation: kebab-case ASCII, ≤70 chars
function isValidSlug(slug) {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 70;
}
function bustCache(slug) {
    config_1.redis.del(`compare:slug:${slug}`).catch(() => { });
}
// GET /admin/comparison-pages — list all pages (all statuses)
router.get('/', requireAdminKey, async (_req, res) => {
    const result = await config_1.db.query(`SELECT id, slug, category, status, expert_summary, hero_image_url,
            published_at, metadata, product_ids, created_at, updated_at
     FROM comparison_pages
     ORDER BY updated_at DESC`).catch((err) => { throw err; });
    res.json({ data: result.rows, total: result.rows.length });
});
// POST /admin/comparison-pages — create a new comparison page
router.post('/', requireAdminKey, async (req, res) => {
    const { slug, product_ids, category, status, expert_summary, hero_image_url, metadata } = req.body;
    if (!slug || !Array.isArray(product_ids) || product_ids.length === 0 || !category) {
        res.status(400).json({ error: 'slug, product_ids (non-empty UUID array), and category are required' });
        return;
    }
    if (!isValidSlug(slug)) {
        res.status(400).json({ error: 'slug must be kebab-case ASCII, max 70 chars' });
        return;
    }
    const validCategories = ['electronics', 'grocery', 'home', 'health'];
    if (!validCategories.includes(category)) {
        res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
        return;
    }
    const pageStatus = status || 'draft';
    const validStatuses = ['draft', 'published', 'archived'];
    if (!validStatuses.includes(pageStatus)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
    }
    const publishedAt = pageStatus === 'published' ? new Date() : null;
    const result = await config_1.db.query(`INSERT INTO comparison_pages
       (slug, product_ids, category, status, expert_summary, hero_image_url, published_at, metadata)
     VALUES ($1, $2::uuid[], $3, $4, $5, $6, $7, $8)
     RETURNING *`, [
        slug,
        product_ids,
        category,
        pageStatus,
        expert_summary || null,
        hero_image_url || null,
        publishedAt,
        metadata ? JSON.stringify(metadata) : null,
    ]).catch((err) => {
        if (err.code === '23505')
            throw Object.assign(new Error('slug already exists'), { statusCode: 409 });
        throw err;
    });
    if (pageStatus === 'published')
        bustCache(slug);
    res.status(201).json(result.rows[0]);
});
// PATCH /admin/comparison-pages/:id — update an existing page
router.patch('/:id', requireAdminKey, async (req, res) => {
    const { id } = req.params;
    const { slug, product_ids, category, status, expert_summary, hero_image_url, metadata } = req.body;
    // Fetch current row to get old slug for cache busting
    const current = await config_1.db.query(`SELECT slug, status FROM comparison_pages WHERE id = $1`, [id]).catch(() => null);
    if (!current || current.rows.length === 0) {
        res.status(404).json({ error: 'Comparison page not found' });
        return;
    }
    const oldSlug = current.rows[0].slug;
    const oldStatus = current.rows[0].status;
    if (slug !== undefined && !isValidSlug(slug)) {
        res.status(400).json({ error: 'slug must be kebab-case ASCII, max 70 chars' });
        return;
    }
    if (product_ids !== undefined && (!Array.isArray(product_ids) || product_ids.length === 0)) {
        res.status(400).json({ error: 'product_ids must be a non-empty UUID array' });
        return;
    }
    const validCategories = ['electronics', 'grocery', 'home', 'health'];
    if (category !== undefined && !validCategories.includes(category)) {
        res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
        return;
    }
    const validStatuses = ['draft', 'published', 'archived'];
    if (status !== undefined && !validStatuses.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
    }
    // Compute published_at: set when transitioning to published
    let publishedAt;
    if (status === 'published' && oldStatus !== 'published') {
        publishedAt = new Date();
    }
    const setClauses = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;
    const addField = (val, col, transform) => {
        if (val !== undefined) {
            setClauses.push(`${col} = $${idx++}`);
            params.push(transform ? transform(val) : val);
        }
    };
    if (slug !== undefined)
        addField(slug, 'slug');
    // product_ids passed as UUID[] literal
    if (product_ids !== undefined) {
        setClauses.push(`product_ids = $${idx++}::uuid[]`);
        params.push(product_ids);
    }
    addField(category, 'category');
    addField(status, 'status');
    addField(expert_summary, 'expert_summary');
    addField(hero_image_url, 'hero_image_url');
    addField(metadata, 'metadata', (v) => JSON.stringify(v));
    if (publishedAt) {
        setClauses.push(`published_at = $${idx++}`);
        params.push(publishedAt);
    }
    params.push(id);
    const result = await config_1.db.query(`UPDATE comparison_pages SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`, params).catch((err) => {
        if (err.code === '23505')
            throw Object.assign(new Error('slug already exists'), { statusCode: 409 });
        throw err;
    });
    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Comparison page not found' });
        return;
    }
    // Bust cache for old slug and new slug (if changed)
    bustCache(oldSlug);
    const newSlug = (slug || oldSlug);
    if (newSlug !== oldSlug)
        bustCache(newSlug);
    res.json(result.rows[0]);
});
// Error handler for this router
router.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});
exports.default = router;
