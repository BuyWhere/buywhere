"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// GET /v1/catalog/stats — catalog-level aggregate statistics
// Unauthenticated — used by MCP server info, monitor, and discovery tools
router.get('/stats', async (_req, res) => {
    try {
        const productsResult = await config_1.db.query(`
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(DISTINCT source)::int AS total_merchants,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days')::int AS products_added_7d,
        COUNT(DISTINCT country_code)::int AS total_countries
      FROM products WHERE is_active = true
    `);
        let totalRegisteredMerchants = 0;
        try {
            const merchantsResult = await config_1.db.query('SELECT COUNT(*)::int AS count FROM merchants');
            totalRegisteredMerchants = merchantsResult.rows[0].count;
        }
        catch {
            // merchants table may not exist in all environments
        }
        const stats = productsResult.rows[0];
        res.json({
            data: {
                total_products: stats.total_products,
                total_merchants: stats.total_merchants,
                products_added_7d: stats.products_added_7d,
                total_countries: stats.total_countries,
                total_registered_merchants: totalRegisteredMerchants,
            },
            meta: { ts: new Date().toISOString() },
        });
    }
    catch (err) {
        console.error('[catalog/stats] error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
