"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const VALID_ONBOARDING_STAGES = ['interested', 'data_received', 'first_indexed_product', 'active'];
const router = (0, express_1.Router)();
// POST /v1/merchants/upsert — create or update a merchant
router.post('/upsert', apiKey_1.requireApiKey, async (req, res) => {
    const body = req.body;
    if (!body.id || typeof body.id !== 'string') {
        res.status(400).json({ error: 'id is required and must be a string' });
        return;
    }
    if (!body.name || typeof body.name !== 'string') {
        res.status(400).json({ error: 'name is required and must be a string' });
        return;
    }
    if (!body.source || typeof body.source !== 'string') {
        res.status(400).json({ error: 'source is required and must be a string' });
        return;
    }
    const id = body.id.trim();
    const name = body.name.trim();
    const source = body.source.trim();
    const country = (body.country || 'SG').slice(0, 2);
    const domain = typeof body.domain === 'string' ? body.domain.trim() : null;
    const contact_email = typeof body.contact_email === 'string' ? body.contact_email.trim() : null;
    const contact_phone = typeof body.contact_phone === 'string' ? body.contact_phone.trim() : null;
    const scraping_priority = typeof body.scraping_priority === 'string' ? body.scraping_priority.trim() : null;
    const is_active = body.is_active !== undefined ? Boolean(body.is_active) : true;
    let onboarding_stage = body.onboarding_stage || 'interested';
    if (!VALID_ONBOARDING_STAGES.includes(onboarding_stage)) {
        res.status(400).json({
            error: `onboarding_stage must be one of: ${VALID_ONBOARDING_STAGES.join(', ')}`
        });
        return;
    }
    const first_indexed_at = body.first_indexed_at
        ? new Date(body.first_indexed_at).toISOString()
        : null;
    const products_count = body.products_count !== undefined && Number.isInteger(body.products_count)
        ? body.products_count
        : null;
    try {
        const result = await config_1.db.query(`INSERT INTO merchants (id, name, source, country, domain, contact_email, contact_phone, scraping_priority, is_active, onboarding_stage, first_indexed_at, products_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           name           = EXCLUDED.name,
           source         = EXCLUDED.source,
           country        = EXCLUDED.country,
           domain         = COALESCE(EXCLUDED.domain, merchants.domain),
           contact_email  = COALESCE(EXCLUDED.contact_email, merchants.contact_email),
           contact_phone  = COALESCE(EXCLUDED.contact_phone, merchants.contact_phone),
           scraping_priority = COALESCE(EXCLUDED.scraping_priority, merchants.scraping_priority),
           is_active      = COALESCE(EXCLUDED.is_active, merchants.is_active),
           onboarding_stage = EXCLUDED.onboarding_stage,
           first_indexed_at = COALESCE(EXCLUDED.first_indexed_at, merchants.first_indexed_at),
           products_count = COALESCE(EXCLUDED.products_count, merchants.products_count)
         RETURNING id, name, source, country, domain, contact_email, contact_phone, is_active, scraping_priority, onboarding_stage, first_indexed_at, products_count, created_at, updated_at, last_scraped_at, scrape_error`, [id, name, source, country, domain, contact_email, contact_phone, scraping_priority, is_active, onboarding_stage, first_indexed_at, products_count]);
        const merchant = result.rows[0];
        res.status(200).json(merchantRowToResponse(merchant));
    }
    catch (err) {
        console.error('[merchants/upsert] DB error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /v1/merchants/list — list merchants with product counts (legacy, from products table)
router.get('/list', apiKey_1.requireApiKey, async (req, res) => {
    const country = (req.query.country || 'SG').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    try {
        const result = await config_1.db.query(`SELECT domain, country_code, region,
                COUNT(*) as product_count,
                COUNT(DISTINCT category_path) as category_count
         FROM products
         WHERE country_code = $1 AND domain IS NOT NULL
         GROUP BY domain, country_code, region
         ORDER BY product_count DESC
         LIMIT $2`, [country, limit]);
        res.json({
            data: result.rows.map((row) => ({
                domain: row.domain,
                country_code: row.country_code,
                product_count: parseInt(row.product_count, 10),
                category_count: parseInt(row.category_count, 10),
            })),
            meta: { total: result.rows.length, country },
        });
    }
    catch (err) {
        console.error('[merchants/list] DB error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /v1/merchants — list merchants from merchants table with filters
router.get('/', apiKey_1.requireApiKey, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const is_active = req.query.is_active;
    const onboarding_stage = req.query.onboarding_stage;
    const country = req.query.country;
    const conditions = [];
    const params = [];
    let paramIdx = 0;
    if (is_active !== undefined) {
        paramIdx++;
        conditions.push(`is_active = $${paramIdx}`);
        params.push(is_active === 'true');
    }
    if (onboarding_stage) {
        paramIdx++;
        conditions.push(`onboarding_stage = $${paramIdx}`);
        params.push(onboarding_stage);
    }
    if (country) {
        paramIdx++;
        conditions.push(`country = $${paramIdx}`);
        params.push(country.toUpperCase());
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
        paramIdx++;
        params.push(limit);
        const limitParam = paramIdx;
        paramIdx++;
        params.push(offset);
        const offsetParam = paramIdx;
        const countResult = await config_1.db.query(`SELECT COUNT(*) as total FROM merchants ${whereClause}`, params.slice(0, limitParam - 1));
        const total = parseInt(countResult.rows[0].total, 10);
        const result = await config_1.db.query(`SELECT id, name, source, country, domain, contact_email, contact_phone,
                is_active, scraping_priority, onboarding_stage, first_indexed_at,
                products_count, last_scraped_at, scrape_error, created_at, updated_at
         FROM merchants
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`, params);
        res.json({
            merchants: result.rows.map(merchantRowToResponse),
            total,
            limit,
            offset,
            has_more: offset + limit < total,
        });
    }
    catch (err) {
        console.error('[merchants/] DB error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /v1/merchants/:id — get a single merchant
router.get('/:id', apiKey_1.requireApiKey, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await config_1.db.query(`SELECT id, name, source, country, domain, contact_email, contact_phone,
                is_active, scraping_priority, onboarding_stage, first_indexed_at,
                products_count, last_scraped_at, scrape_error, created_at, updated_at
         FROM merchants WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: `Merchant '${id}' not found` });
            return;
        }
        res.json(merchantRowToResponse(result.rows[0]));
    }
    catch (err) {
        console.error('[merchants/:id] DB error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Shared onboard logic — used by both /onboard and /onboard/webhook
async function handleOnboardMerchant(req, res) {
    const body = req.body;
    const errors = [];
    if (!body.id || typeof body.id !== 'string')
        errors.push('id is required');
    if (!body.name || typeof body.name !== 'string')
        errors.push('name is required');
    if (!body.source || typeof body.source !== 'string')
        errors.push('source is required');
    if (!body.pdpa_consent) {
        errors.push('PDPA consent is required. Cannot onboard merchant without explicit consent for data processing.');
    }
    if (errors.length > 0) {
        res.status(400).json({ error: errors.join('; ') });
        return;
    }
    const id = body.id.trim();
    const name = body.name.trim();
    const source = body.source.trim();
    const country = (body.country || 'SG').slice(0, 2);
    const domain = typeof body.domain === 'string' ? body.domain.trim() : null;
    const contact_email = typeof body.contact_email === 'string' ? body.contact_email.trim() : null;
    const contact_phone = typeof body.contact_phone === 'string' ? body.contact_phone.trim() : null;
    const scraping_priority = typeof body.scraping_priority === 'string' ? body.scraping_priority.trim() : 'medium';
    const data_submission_type = typeof body.data_submission_type === 'string' ? body.data_submission_type.trim() : 'api';
    const referral_source = typeof body.referral_source === 'string' ? body.referral_source.trim() : null;
    const pdpa_consent_at = typeof body.pdpa_consent_at === 'string' ? new Date(body.pdpa_consent_at).toISOString() : new Date().toISOString();
    try {
        // Check if merchant already exists
        const existing = await config_1.db.query('SELECT id, onboarding_stage FROM merchants WHERE id = $1', [id]);
        let merchant;
        let message;
        if (existing.rows.length > 0) {
            // Update existing merchant to data_received
            const result = await config_1.db.query(`UPDATE merchants SET
           onboarding_stage = 'data_received',
           contact_email = COALESCE($2, contact_email),
           contact_phone = COALESCE($3, contact_phone),
           scraping_priority = COALESCE($4, scraping_priority),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, source, country, domain, contact_email, contact_phone,
                   is_active, scraping_priority, onboarding_stage, first_indexed_at,
                   products_count, last_scraped_at, scrape_error, created_at, updated_at`, [id, contact_email, contact_phone, scraping_priority]);
            merchant = result.rows[0];
            message = 'Merchant already existed — updated to data_received stage.';
        }
        else {
            // Create new merchant
            const result = await config_1.db.query(`INSERT INTO merchants (id, name, source, country, domain, contact_email, contact_phone,
                 scraping_priority, is_active, onboarding_stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'interested')
         RETURNING id, name, source, country, domain, contact_email, contact_phone,
                   is_active, scraping_priority, onboarding_stage, first_indexed_at,
                   products_count, last_scraped_at, scrape_error, created_at, updated_at`, [id, name, source, country, domain, contact_email, contact_phone, scraping_priority]);
            merchant = result.rows[0];
            // Transition to data_received
            await config_1.db.query(`UPDATE merchants SET onboarding_stage = 'data_received', updated_at = NOW() WHERE id = $1`, [id]);
            merchant.onboarding_stage = 'data_received';
            message = 'Merchant onboarded successfully. PDPA consent recorded.';
        }
        // Log the merchant event
        try {
            await config_1.db.query(`INSERT INTO merchant_events (merchant_id, event_type, event_data)
         VALUES ($1, $2, $3)`, [
                id,
                'data_received',
                JSON.stringify({
                    pdpa_consent_at,
                    data_submission_type,
                    referral_source,
                }),
            ]);
        }
        catch (err) {
            console.warn('[merchants/onboard] Failed to log event (non-fatal):', err);
        }
        res.status(201).json({
            merchant: merchantRowToResponse(merchant),
            onboarding_stage: merchant.onboarding_stage,
            pdpa_consent_recorded: true,
            message,
        });
    }
    catch (err) {
        console.error('[merchants/onboard] DB error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
}
// POST /v1/merchants/onboard — PDPA consent onboarding flow (BUY-6932)
router.post('/onboard', async (req, res) => {
    await handleOnboardMerchant(req, res);
});
// POST /v1/merchants/onboard/webhook — webhook variant (BUY-6932)
router.post('/onboard/webhook', async (req, res) => {
    const body = req.body;
    if (!body.merchant_id || typeof body.merchant_id !== 'string') {
        res.status(400).json({ error: 'merchant_id is required' });
        return;
    }
    if (!body.name || typeof body.name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    if (!body.source || typeof body.source !== 'string') {
        res.status(400).json({ error: 'source is required' });
        return;
    }
    if (!body.pdpa_consent) {
        res.status(400).json({ error: 'pdpa_consent is required' });
        return;
    }
    // Normalize to the same body shape as /onboard
    req.body = {
        id: body.merchant_id,
        name: body.name,
        source: body.source,
        country: body.country || 'SG',
        domain: body.domain,
        contact_email: body.contact_email,
        contact_phone: body.contact_phone,
        scraping_priority: body.scraping_priority || 'medium',
        pdpa_consent: Boolean(body.pdpa_consent),
        pdpa_consent_at: body.pdpa_consent_at || new Date().toISOString(),
        data_submission_type: body.data_submission_type || 'webhook',
        referral_source: body.referral_source,
    };
    await handleOnboardMerchant(req, res);
});
function merchantRowToResponse(row) {
    return {
        id: row.id,
        name: row.name,
        source: row.source,
        country: row.country,
        domain: row.domain,
        contact_email: row.contact_email,
        contact_phone: row.contact_phone,
        is_active: row.is_active,
        scraping_priority: row.scraping_priority,
        onboarding_stage: row.onboarding_stage,
        first_indexed_at: row.first_indexed_at,
        products_count: row.products_count,
        last_scraped_at: row.last_scraped_at,
        scrape_error: row.scrape_error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
exports.default = router;
