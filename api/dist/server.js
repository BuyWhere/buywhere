"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const categories_1 = __importDefault(require("./routes/categories"));
const redirect_1 = __importDefault(require("./routes/redirect"));
const wellknown_1 = __importDefault(require("./routes/wellknown"));
const docs_1 = __importDefault(require("./routes/docs"));
const pages_1 = __importDefault(require("./routes/pages"));
const publicCategories_1 = __importDefault(require("./routes/publicCategories"));
const publicCompare_1 = __importDefault(require("./routes/publicCompare"));
const mcp_1 = __importDefault(require("./routes/mcp"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const config_1 = require("./config");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: false }));
    // Health check
    app.get('/health', async (_req, res) => {
        try {
            const result = await config_1.db.query('SELECT COUNT(*) FROM products');
            res.json({
                status: 'ok',
                ts: new Date().toISOString(),
                catalog: { total_products: parseInt(result.rows[0].count, 10) },
            });
        }
        catch (err) {
            res.status(500).json({ status: 'error', error: String(err) });
        }
    });
    // MCP / OpenAI plugin discovery
    app.use('/.well-known', wellknown_1.default);
    app.get('/openapi.json', (req, res) => (0, wellknown_1.default)(req, res, () => { }));
    // Docs
    app.use('/docs', docs_1.default);
    // MCP JSON-RPC endpoint (Model Context Protocol)
    app.use('/mcp', mcp_1.default);
    // v1 API
    app.use('/v1/auth', auth_1.default);
    app.use('/v1/products', products_1.default);
    app.use('/v1/categories', categories_1.default);
    app.use('/v1/analytics', analytics_1.default);
    // Affiliate redirect (no /v1 prefix — short URLs)
    app.use('/r', redirect_1.default);
    // Public HTML pages with Schema.org JSON-LD (no auth — crawlable by AI agents)
    app.use('/p', pages_1.default); // /p/:id — product page
    app.use('/c', publicCategories_1.default); // /c/:slug — category page
    app.use('/compare', publicCompare_1.default); // /compare?ids=id1,id2 — comparison page
    // GEO / AI-crawler discoverability
    app.get('/robots.txt', (_req, res) => {
        res.type('text/plain').send([
            'User-agent: *',
            'Allow: /',
            '',
            '# AI crawlers — explicitly allowed for GEO and LLM training/citations',
            'User-agent: GPTBot',
            'Allow: /',
            '',
            'User-agent: Claude-Web',
            'Allow: /',
            '',
            'User-agent: PerplexityBot',
            'Allow: /',
            '',
            'User-agent: Bytespider',
            'Allow: /',
            '',
            'User-agent: CCBot',
            'Allow: /',
            '',
            'User-agent: Applebot-Extended',
            'Allow: /',
            '',
            'User-agent: YouBot',
            'Allow: /',
            '',
            'User-agent: cohere-ai',
            'Allow: /',
            '',
            'Sitemap: https://buywhere.ai/sitemap.xml',
        ].join('\n'));
    });
    app.get('/llms.txt', (_req, res) => {
        res.type('text/plain').send(`# BuyWhere\n\nBuyWhere is a structured product catalog and price comparison API for AI agents and LLM applications. We provide real-time pricing, availability, and product data from Singapore's major e-commerce platforms (Lazada, Shopee, Best Denki, and others).\n\n## What we offer\n- REST API: GET /v1/products, GET /v1/offers, GET /v1/categories\n- MCP endpoint: https://mcp.buywhere.io/v1/mcp\n- Schema.org-compatible product data (Product, Offer, ItemList)\n- Coverage: 2M+ Singapore products across 20+ merchants\n- Use cases: price comparison agents, shopping assistants, market research tools\n\n## Documentation\n- API docs: https://docs.buywhere.io\n- MCP guide: https://docs.buywhere.io/mcp\n- GitHub: https://github.com/BuyWhere/buywhere\n\n## Licensing\nFree tier: 1,000 API calls/month. Commercial plans available.\n`);
    });
    // 404 fallback
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    return app;
}
