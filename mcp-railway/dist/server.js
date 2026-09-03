"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const sentry_1 = require("./sentry");
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const categories_1 = __importDefault(require("./routes/categories"));
const redirect_1 = __importDefault(require("./routes/redirect"));
const wellknown_1 = __importStar(require("./routes/wellknown"));
const docs_1 = __importDefault(require("./routes/docs"));
const pages_1 = __importDefault(require("./routes/pages"));
const publicCategories_1 = __importDefault(require("./routes/publicCategories"));
const publicCompare_1 = __importDefault(require("./routes/publicCompare"));
const compareSlug_1 = __importDefault(require("./routes/compareSlug"));
const adminCompare_1 = __importDefault(require("./routes/adminCompare"));
const mcp_1 = __importDefault(require("./routes/mcp"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const revenue_1 = __importDefault(require("./routes/revenue"));
const sitemapCompare_1 = __importDefault(require("./routes/sitemapCompare"));
const landing_1 = __importDefault(require("./routes/landing"));
const clicks_1 = __importDefault(require("./routes/clicks"));
const oauth_1 = __importDefault(require("./routes/oauth"));
const merchants_1 = __importDefault(require("./routes/merchants"));
const ingest_1 = __importDefault(require("./routes/ingest"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const keys_1 = __importDefault(require("./routes/keys"));
const usage_1 = __importDefault(require("./routes/usage"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const routes_1 = __importDefault(require("./monitoring/routes"));
const middleware_1 = require("./monitoring/middleware");
const latency_1 = require("./middleware/latency");
const uptime_1 = __importDefault(require("./routes/admin/uptime"));
const metrics_1 = __importDefault(require("./routes/admin/metrics"));
const config_1 = require("./config");
const DISCOVERY_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';
const AGENTS_TXT_CONTENT = `# BuyWhere AI Agents Discovery
User-agent: *
MCP: https://api.buywhere.ai/mcp/sse
A2A: https://api.buywhere.ai/.well-known/agent.json
API: https://api.buywhere.ai/v1
API-Docs: https://api.buywhere.ai/docs
Auth: X-API-Key
Auth-Url: https://api.buywhere.ai/v1/auth/register
Register: POST https://api.buywhere.ai/v1/auth/register {"agent_name":"<your-agent>"} -> instant free API key, no email or human signup required
`;
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({
        origin: (process.env.CORS_ALLOWED_ORIGINS || 'https://us.buywhere.com,https://buywhere.ai').split(',').map((o) => o.trim()),
        credentials: true,
    }));
    app.use((_req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        next();
    });
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ extended: false }));
    app.use((0, compression_1.default)());
    // Sentry request context — attaches user/country/method for error tracking
    app.use(sentry_1.sentryRequestHandler);
    // Latency monitoring middleware for P95 calculation
    app.use(middleware_1.latencyMiddleware);
    // BUY-22737 / BUY-35381: per-request histogram ring buffer. Mounted after
    // the existing market-based latency middleware so it doesn't interfere.
    // Skips /v1/admin/* so internal polling does not pollute customer metrics.
    app.use(latency_1.histogramLatencyMiddleware);
    // Health check - fast in-process check as required by BUY-3280
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            ts: new Date().toISOString(),
            fix: 'BUY-14407-v1',
        });
    });
    // BUY-31272: lightweight DB health — single SELECT 1 instead of schema introspection
    let dbHealthColumns = null;
    app.get('/health/db', async (_req, res) => {
        try {
            await config_1.db.query(`SELECT 1`);
            if (!dbHealthColumns) {
                try {
                    const cols = await config_1.db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`);
                    dbHealthColumns = cols.rows.map((r) => r.column_name);
                }
                catch {
                    dbHealthColumns = [];
                }
            }
            res.set('Cache-Control', 'public, max-age=10');
            res.json({ status: 'ok', columns: dbHealthColumns || [], avg_rating_test: 'pass', ts: new Date().toISOString() });
        }
        catch (err) {
            res.status(500).json({ status: 'error', error: err.message || String(err), ts: new Date().toISOString() });
        }
    });
    // /api/health — alias for monitors still using the v3 path (BUY-20969)
    app.get('/api/health', (_req, res) => {
        res.json({
            status: 'ok',
            ts: new Date().toISOString(),
            fix: 'BUY-18176-v5',
        });
    });
    // BUY-47470: watchdogs still probing /api/monitoring/health on api.buywhere.ai
    // need a public process-liveness surface, not the auth-gated reporting routes.
    app.get('/api/monitoring/health', (_req, res) => {
        res.json({
            status: 'ok',
            ts: new Date().toISOString(),
            fix: 'BUY-47470-v1',
        });
    });
    // /healthz — backwards-compatible alias for /health (BUY-18347)
    // Old dedicated MCP container (Cloud Run) used /healthz as its Knative liveness probe path.
    // Railway buywhere-api now owns mcp.buywhere.ai; alias keeps legacy probes and monitors working.
    app.get('/healthz', (_req, res) => {
        res.json({
            status: 'ok',
            ts: new Date().toISOString(),
        });
    });
    app.get('/health/redis', async (_req, res) => {
        try {
            const pong = await config_1.redis.ping();
            res.json({
                status: pong === 'PONG' ? 'ok' : 'degraded',
                redis: pong,
                ts: new Date().toISOString(),
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'redis_unreachable';
            res.status(503).json({
                status: 'down',
                error: message,
                ts: new Date().toISOString(),
            });
        }
    });
    // MCP / OpenAI plugin discovery
    app.use('/.well-known', wellknown_1.default);
    const serveOpenApi = (_req, res) => {
        (0, wellknown_1.sendOpenApiSpec)(res);
    };
    // BUY-47885: external monitors still probe /openapi without the .json
    // suffix. Serve the same public spec instead of falling through to a
    // legacy/auth-gated handler on older runtimes.
    app.get('/openapi', serveOpenApi);
    app.get('/openapi.json', serveOpenApi);
    // ChatGPT Actions-compatible OpenAPI spec (OpenAPI 3.1, action-friendly)
    app.get('/chatgpt-openapi.json', (_req, res) => {
        res.json(require('./routes/chatgpt-openapi.json'));
    });
    // AI crawler headers for public endpoints (Perplexity, GPTBot, etc.)
    const aiCrawlerHeaders = (_req, res, next) => {
        res.set('X-Robots-Tag', 'ai-index');
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        next();
    };
    // Docs
    app.use('/docs', aiCrawlerHeaders, docs_1.default);
    // Public quickstart alias — launch fallback for BUY-3724
    // api.buywhere.ai/quickstart → /docs/guides/mcp
    app.get('/quickstart', aiCrawlerHeaders, (_req, res) => res.redirect(301, '/docs/guides/mcp'));
    app.get('/search', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, `/v1/search${qs}`);
    });
    app.get('/v2', (_req, res) => res.redirect(301, '/docs'));
    app.get('/v2/agents/search', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, `/v1/search${qs}`);
    });
    app.get('/v2/agents/best-price', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, `/v1/products/best-price${qs}`);
    });
    app.get('/v2/agents/price-comparison', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, `/v1/products/search${qs}`);
    });
    app.get('/v2/agents/bulk-compare', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(301, `/v1/products/bulk-lookup${qs}`);
    });
    app.get('/metrics', (_req, res) => res.redirect(301, '/health'));
    // MCP JSON-RPC endpoint (Model Context Protocol)
    app.use('/mcp', mcp_1.default);
    // /api/mcp — backwards-compatible alias (BUY-30153)
    app.use('/api/mcp', mcp_1.default);
    // v1 API
    app.use('/v1/auth', auth_1.default);
    app.use('/v1/developers', auth_1.default);
    app.use('/v1/products', products_1.default);
    // v2 alias — same router, extends v1 contract with country_code + multi-region currency inference
    app.use('/v2/products', products_1.default);
    app.use('/v1/categories', categories_1.default);
    app.use('/v1/merchants', merchants_1.default);
    app.use('/v1/ingest', ingest_1.default);
    // BUY-31929: backward-compat alias — /ingest/bulk, /ingest/products, etc.
    app.use('/ingest', ingest_1.default);
    // Backward-compat alias: /v1/search → /v1/products/search
    app.get("/v1/search", (req, res) => {
        const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        res.redirect(301, `/v1/products/search${qs}`);
    });
    app.use('/v1/analytics', analytics_1.default);
    app.use('/v1/revenue', revenue_1.default);
    app.use('/v1/catalog', catalog_1.default);
    app.use('/v1/keys', keys_1.default);
    app.use('/v1/usage', usage_1.default);
    app.use('/v1/compare', aiCrawlerHeaders, compareSlug_1.default);
    app.use('/api/v1/compare', aiCrawlerHeaders, compareSlug_1.default); // alias — FE integration uses /api prefix
    // BUY-33837: /api/server/status — process status endpoint. Registered
    // before the 404 catch-all so it doesn't fall through to Next.js-shaped
    // {"error":"Not found"}. Public, no auth — same surface as the old
    // standalone mcp-server-production.js.
    app.get('/api/server/status', (_req, res) => {
        const mu = process.memoryUsage();
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            port: process.env.PORT || 3000,
            environment: process.env.NODE_ENV || 'production',
            memory: {
                used: mu.heapUsed,
                total: mu.heapTotal,
                external: mu.external,
                rss: mu.rss,
            },
            node: process.version,
            platform: process.platform,
            ts: new Date().toISOString(),
        });
    });
    // Admin editorial CRUD (ADMIN_API_KEY auth, not rate-limited)
    app.use('/admin/comparison-pages', adminCompare_1.default);
    // Outbound click tracking (BUY-4869): /api/click redirect + /admin/clicks analytics
    app.use('/api', clicks_1.default);
    // /v1/click alias: the site rewrites buywhere.ai/api/* -> api.buywhere.ai/v1/*,
    // so root-domain click_urls land here (F32).
    app.use('/v1', clicks_1.default);
    // OAuth 2.1 M1 scaffold (docs/oauth-design.md)
    app.use('/v1/oauth', oauth_1.default);
    // RFC 8414 requires root-level discovery; reuse the router's handler path
    app.use('/', oauth_1.default);
    app.use('/admin', clicks_1.default);
    // Affiliate redirect (no /v1 prefix — short URLs)
    app.use('/r', redirect_1.default);
    app.use('/go', redirect_1.default);
    // Public HTML pages with Schema.org JSON-LD (no auth — crawlable by AI agents)
    app.use('/p', aiCrawlerHeaders, pages_1.default); // /p/:id — product page
    app.use('/c', aiCrawlerHeaders, publicCategories_1.default); // /c/:slug — category page
    app.use('/compare', aiCrawlerHeaders, publicCompare_1.default); // /compare?ids=id1,id2 — comparison page
    // Sitemaps
    app.use('/sitemap-compare.xml', sitemapCompare_1.default);
    // Sitemap index — references all sitemaps
    app.get('/sitemap.xml', (req, res) => {
        const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
        const host = req.headers['x-forwarded-host'] || req.get('host') || 'buywhere.ai';
        const base = `${proto}://${host}`;
        const now = new Date().toISOString().slice(0, 10);
        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            '  <sitemap>',
            `    <loc>${base}/sitemap-compare.xml</loc>`,
            `    <lastmod>${now}</lastmod>`,
            '  </sitemap>',
            '</sitemapindex>',
        ].join('\n');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        res.send(xml);
    });
    // Block all crawlers from api.buywhere.ai — this is an API server, not a content site
    app.get('/robots.txt', (_req, res) => {
        res.set('Content-Signal', 'ai-train=no, search=yes, ai-input=yes');
        res.type('text/plain').send([
            'User-agent: *',
            '# Discovery surface — crawlable by search engines and AI agents',
            'Allow: /llms.txt',
            'Allow: /agents.txt',
            'Allow: /openapi',
            'Allow: /openapi.json',
            'Allow: /sitemap.xml',
            'Allow: /mcp',
            'Allow: /.well-known/',
            '# Data + functional API endpoints are not for crawling',
            'Disallow: /',
            '',
            'Sitemap: https://api.buywhere.ai/sitemap.xml',
        ].join('\n'));
    });
    app.get('/llms.txt', (_req, res) => {
        res.set('X-Robots-Tag', 'ai-index');
        res.set('Cache-Control', 'public, max-age=86400');
        res.type('text/plain').send(`# BuyWhere\n\nBuyWhere is a structured product catalog and price comparison API for AI agents and LLM applications. We provide real-time pricing, availability, and product data from Singapore's major e-commerce platforms (Lazada, Shopee, Best Denki, and others).\n\n## What we offer\n- REST API: GET /v1/products, GET /v1/offers, GET /v1/categories\n- MCP endpoint: https://api.buywhere.ai/mcp\n- Schema.org-compatible product data (Product, Offer, ItemList)\n- Coverage: 2M+ Singapore products across 40+ merchants\n- Use cases: price comparison agents, shopping assistants, market research tools\n\n## Documentation\n- API docs: https://docs.buywhere.ai\n- MCP guide: https://api.buywhere.ai/docs/guides/mcp\n- GitHub: https://github.com/BuyWhere/buywhere\n\n## Licensing\nFree tier: 1,000 API calls/month. Commercial plans available.\n`);
    });
    app.get('/agents.txt', (_req, res) => {
        res.set('X-Robots-Tag', 'ai-index');
        res.set('Cache-Control', DISCOVERY_CACHE_CONTROL);
        res.type('text/plain').send(AGENTS_TXT_CONTENT);
    });
    // Landing pages — homepage (en_SG) and US edition (en_US)
    app.use(landing_1.default);
    // Webhook relay — UptimeRobot → Paperclip issue creation
    app.use('/webhooks', webhooks_1.default);
    // P95 monitoring endpoints (BUY-31208)
    app.use(routes_1.default);
    // BUY-22737 / BUY-35381: admin endpoints (uptime + metrics).
    // Auth is handled inside each router via Authorization: Bearer <admin key>.
    app.use(uptime_1.default);
    app.use(metrics_1.default);
    // 404 fallback
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // Sentry error capture — must be after all routes
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, next) => {
        sentry_1.Sentry.captureException(err);
        next(err);
    });
    return app;
}
