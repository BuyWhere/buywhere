import express from 'express';
import cors from 'cors';
import { Sentry, sentryRequestHandler } from './sentry';
import authRouter from './routes/auth';
import productsRouter from './routes/products';
import categoriesRouter from './routes/categories';
import redirectRouter from './routes/redirect';
import wellknownRouter from './routes/wellknown';
import docsRouter from './routes/docs';
import pagesRouter from './routes/pages';
import publicCategoriesRouter from './routes/publicCategories';
import publicCompareRouter from './routes/publicCompare';
import compareSlugRouter from './routes/compareSlug';
import adminCompareRouter from './routes/adminCompare';
import mcpRouter from './routes/mcp';
import analyticsRouter from './routes/analytics';
import revenueRouter from './routes/revenue';
import sitemapCompareRouter from './routes/sitemapCompare';
import landingRouter from './routes/landing';
import clicksRouter from './routes/clicks';
import merchantsRouter from './routes/merchants';
import ingestRouter from './routes/ingest';
import catalogRouter from './routes/catalog';
import keysRouter from './routes/keys';
import webhooksRouter from './routes/webhooks';
import { db, redis } from './config';
import { abuseDetection } from './middleware/abuseDetection';
import { checkIpRateLimit } from './middleware/apiKey';

export function createApp() {
  const app = express();
  const releaseSha = (process.env.RELEASE_SHA || process.env.IMAGE_TAG || 'dev').trim();

  app.use(cors({
    origin: (process.env.CORS_ALLOWED_ORIGINS || 'https://us.buywhere.com,https://buywhere.ai').split(',').map((o) => o.trim()),
    credentials: true,
  }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((_req, res, next) => {
    res.set('X-BuyWhere-Release', releaseSha || 'dev');
    next();
  });

  // Abuse detection & IP rate limiting — applied to API routes only
  // Skips health checks, static pages, sitemaps, robots.txt, etc.
  const apiAbuse = abuseDetection();
  app.use('/v1', apiAbuse, checkIpRateLimit);
  app.use('/v2', apiAbuse, checkIpRateLimit);
  app.use('/mcp', apiAbuse, checkIpRateLimit);

  // Sentry request context — attaches user/country/method for error tracking
  app.use(sentryRequestHandler);

  // Health check - fast in-process check as required by BUY-3280
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      ts: new Date().toISOString(),
      release: releaseSha || 'dev',
    });
  });

  // DB health check — verifies PostgreSQL connectivity
  app.get('/health/db', async (_req, res) => {
    const start = Date.now();
    try {
      const result = await db.query('SELECT 1 AS ok');
      const latencyMs = Date.now() - start;
      res.json({
        db: 'ok',
        latency_ms: latencyMs,
        ts: new Date().toISOString(),
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      res.status(503).json({
        db: 'error',
        error: err.message || 'Database unreachable',
        latency_ms: latencyMs,
        ts: new Date().toISOString(),
      });
    }
  });

  // Redis health check — UptimeRobot monitor endpoint
  app.get('/health/redis', async (_req, res) => {
    try {
      const pong = await redis.ping();
      res.json({
        status: pong === 'PONG' ? 'ok' : 'degraded',
        redis: pong === 'PONG' ? 'connected' : 'unexpected_response',
        ts: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        status: 'error',
        redis: 'disconnected',
        error: (err as Error).message,
        ts: new Date().toISOString(),
      });
    }
  });

  // Uptime Robot webhook handler — receives DOWN/UP alerts
  app.post('/webhooks/uptime-robot', async (req, res) => {
    const { monitorID, monitorFriendlyName, monitorURL, alertType, alertTypeFriendlyName, alertDetails, monitorStatusCode } = req.body || {};
    if (!monitorID) {
      return res.status(400).json({ error: { code: 'MISSING_REQUIRED_FIELD', message: 'monitorID is required' } });
    }
    const name = monitorFriendlyName || monitorID;
    console.log(`[uptime-robot] ${name} [${monitorURL}] = ${alertTypeFriendlyName || alertType} — ${alertDetails || monitorStatusCode}`);
    if (alertType === '1' || (alertTypeFriendlyName || '').toLowerCase() === 'down') {
      console.error(`[uptime-robot] MONITOR DOWN: ${name} (${monitorURL}) — ${alertDetails || ''} (HTTP ${monitorStatusCode || '?'})`);
    }
    res.json({ status: 'ok' });
  });

  // Uptime Robot webhook diagnostic
  app.get('/webhooks/uptime-robot', (_req, res) => {
    res.json({ status: 'ok', mode: 'diagnostic' });
  });
        ts: new Date().toISOString(),
      });
    }
  });

<<<<<<< HEAD
  // Uptime Robot webhook handler — receives DOWN/UP alerts
  app.post('/webhooks/uptime-robot', async (req, res) => {
    const { monitorID, monitorFriendlyName, monitorURL, alertType, alertTypeFriendlyName, alertDetails, monitorStatusCode } = req.body || {};
    if (!monitorID) {
      return res.status(400).json({ error: { code: 'MISSING_REQUIRED_FIELD', message: 'monitorID is required' } });
    }
    const name = monitorFriendlyName || monitorID;
    console.log(`[uptime-robot] ${name} [${monitorURL}] = ${alertTypeFriendlyName || alertType} — ${alertDetails || monitorStatusCode}`);
    if (alertType === '1' || (alertTypeFriendlyName || '').toLowerCase() === 'down') {
      console.error(`[uptime-robot] MONITOR DOWN: ${name} (${monitorURL}) — ${alertDetails || ''} (HTTP ${monitorStatusCode || '?'})`);
    }
    res.json({ status: 'ok' });
  });

  // Uptime Robot webhook diagnostic
  app.get('/webhooks/uptime-robot', (_req, res) => {
    res.json({ status: 'ok', mode: 'diagnostic' });
  });

=======
>>>>>>> hotfix-restore
  // MCP / OpenAI plugin discovery
  app.use('/.well-known', wellknownRouter);
  app.get('/openapi.json', (req, res) => wellknownRouter(req, res, () => {}));

  // ChatGPT Actions-compatible OpenAPI spec (OpenAPI 3.1, action-friendly)
  app.get('/chatgpt-openapi.json', (_req, res) => {
    res.json(require('./routes/chatgpt-openapi.json'));
  });

  // AI crawler headers for public endpoints (Perplexity, GPTBot, etc.)
  const aiCrawlerHeaders = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.set('X-Robots-Tag', 'ai-index');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    next();
  };

  // Docs
  app.use('/docs', aiCrawlerHeaders, docsRouter);

  // Public quickstart alias — launch fallback for BUY-3724
  // api.buywhere.ai/quickstart → /docs/guides/mcp
  app.get('/quickstart', aiCrawlerHeaders, (_req, res) => res.redirect(301, '/docs/guides/mcp'));

  // MCP JSON-RPC endpoint (Model Context Protocol)
  app.use('/mcp', mcpRouter);

  // v1 API
  app.use('/v1/auth', authRouter);
  app.use('/v1/products', productsRouter);
  // v2 alias — same router, extends v1 contract with country_code + multi-region currency inference
  app.use('/v2/products', productsRouter);
  app.use('/v1/categories', categoriesRouter);
  app.use('/v1/merchants', merchantsRouter);
  app.use('/v1/ingest', ingestRouter);

  // Backward-compat alias: /v1/search → /v1/products/search
  app.get("/v1/search", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(301, `/v1/products/search${qs}`);
  });
  app.use('/v1/analytics', analyticsRouter);
  app.use('/v1/revenue', revenueRouter);
  app.use('/v1/catalog', catalogRouter);
  app.use('/v1/keys', keysRouter);
  app.use('/v1/compare', aiCrawlerHeaders, compareSlugRouter);
  app.use('/api/v1/compare', aiCrawlerHeaders, compareSlugRouter); // alias — FE integration uses /api prefix

  // Admin editorial CRUD (ADMIN_API_KEY auth, not rate-limited)
  app.use('/admin/comparison-pages', adminCompareRouter);

  // Outbound click tracking (BUY-4869): /api/click redirect + /admin/clicks analytics
  app.use('/api', clicksRouter);
  app.use('/admin', clicksRouter);

  // Affiliate redirect (no /v1 prefix — short URLs)
  app.use('/r', redirectRouter);

  // Public HTML pages with Schema.org JSON-LD (no auth — crawlable by AI agents)
  app.use('/p', aiCrawlerHeaders, pagesRouter);           // /p/:id — product page
  app.use('/c', aiCrawlerHeaders, publicCategoriesRouter); // /c/:slug — category page
  app.use('/compare', aiCrawlerHeaders, publicCompareRouter); // /compare?ids=id1,id2 — comparison page

  // Sitemaps
  app.use('/sitemap-compare.xml', sitemapCompareRouter);

  // Sitemap index — references all sitemaps
  app.get('/sitemap.xml', (req, res) => {
    const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol).split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'buywhere.ai';
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
    res.set('Content-Signal', 'ai-train=no, search=no, ai-input=no');
    res.type('text/plain').send(
      [
        'User-agent: *',
        'Disallow: /',
      ].join('\n')
    );
  });

  app.get('/llms.txt', (_req, res) => {
    res.set('X-Robots-Tag', 'ai-index');
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('text/plain').send(
      `# BuyWhere\n\nBuyWhere is an agent-native product catalog and price comparison API for AI agents and LLM applications. We provide real-time pricing, availability, and product data from major e-commerce platforms across Southeast Asia and the United States.\n\n## Catalog Coverage\n- 120,966+ active products\n- 7 major merchants (Shopee, Lazada, Amazon SG, Amazon US, Walmart, FairPrice, Carousell)\n- 2 countries: Singapore (SG) and United States (US)\n- Currencies: SGD, USD\n\n## REST API Endpoints\n\n### Products\n- GET /v1/products/search — Full-text product search with filters (keyword, merchant, price, category, country, currency, availability)\n- GET /v1/products/deals — Products on sale, sorted by discount percentage\n- GET /v1/products/compare?ids=id1,id2,... — Side-by-side product comparison (2-10 products)\n- GET /v1/products/:id — Get full product details by ID\n- GET /v1/products/:id/similar — Find similar products\n- GET /v1/products/:id/price-history — Historical price chart data\n- GET /v1/products/:id/prices — Price snapshots from merchant feeds\n\n### Categories\n- GET /v1/categories — List all top-level categories\n- GET /v1/categories/:slug — Get category details with subcategories and sample products\n\n### Catalog\n- GET /v1/catalog/stats — Aggregate statistics (total products, merchants, countries, recent additions) — unauthenticated\n\n## MCP Server\nMCP endpoint: https://api.buywhere.ai/mcp\nAuthentication: Bearer token (get free key at https://api.buywhere.ai/v1/auth/register)\n\n### MCP Tools\n1. **search_products** — Full-text search with merchant, price, category, and country filters. Use compact=true for agent-optimized responses.\n2. **get_product** — Get full product details by BuyWhere product ID.\n3. **compare_products** — Compare 2-10 products side-by-side across merchants.\n4. **get_deals** — Find discounted products sorted by discount percentage.\n5. **list_categories** — List top-level product categories with product counts.\n6. **find_best_price** — Find the cheapest current listing for a product across all merchants.\n\n## Use Cases\n- AI shopping agents and price comparison assistants\n- Product discovery and deal alerts\n- Cross-merchant price intelligence\n- Market research and retail analytics\n\n## Documentation\n- API docs: https://api.buywhere.ai/docs\n- MCP setup guide: https://api.buywhere.ai/docs/guides/mcp\n- Quickstart: https://buywhere.ai/quickstart\n- GitHub: https://github.com/BuyWhere/buywhere\n- npm package: https://www.npmjs.com/package/@buywhere/mcp-server\n\n## Authentication\nSign up at https://api.buywhere.ai/v1/auth/register for a free API key.\nFree tier: 1,000 API calls/month. No credit card required.\n\n## Pricing\nFree: 1,000 calls/month\nCommercial plans available at https://buywhere.ai/pricing\n`
    );
  });

  // Landing pages — homepage (en_SG) and US edition (en_US)
  app.use(landingRouter);

  // Webhook relay — UptimeRobot → Paperclip issue creation
  app.use('/webhooks', webhooksRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Sentry error capture — must be after all routes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    Sentry.captureException(err);
    next(err);
  });

  return app;
}
