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

export function createApp() {
  const app = express();

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

  // Sentry request context — attaches user/country/method for error tracking
  app.use(sentryRequestHandler);

  // Health check - fast in-process check as required by BUY-3280
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      ts: new Date().toISOString(),
      fix: 'BUY-18176-v5',
    });
  });

  // Diagnostic endpoint - BUY-18176: exposes DB error for debugging
  app.get('/health/db', async (_req, res) => {
    try {
      const cols = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`,
        []
      );
      const colNames = cols.rows.map((r: { column_name: string }) => r.column_name);
      let queryError: string | null = null;
      try {
        await db.query(`SELECT id, avg_rating, review_count FROM products LIMIT 1`);
      } catch (e: unknown) {
        queryError = (e as Error).message || String(e);
      }
      res.json({ status: 'ok', columns: colNames, avg_rating_test: queryError || 'pass', ts: new Date().toISOString() });
    } catch (err: unknown) {
      res.status(500).json({ status: 'error', error: (err as Error).message || String(err), ts: new Date().toISOString() });
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
      const pong = await redis.ping();
      res.json({
        status: pong === 'PONG' ? 'ok' : 'degraded',
        redis: pong,
        ts: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'redis_unreachable';
      res.status(503).json({
        status: 'down',
        error: message,
        ts: new Date().toISOString(),
      });
    }
  });

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
  app.use('/go', redirectRouter);

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
      `# BuyWhere\n\nBuyWhere is a structured product catalog and price comparison API for AI agents and LLM applications. We provide real-time pricing, availability, and product data from Singapore's major e-commerce platforms (Lazada, Shopee, Best Denki, and others).\n\n## What we offer\n- REST API: GET /v1/products, GET /v1/offers, GET /v1/categories\n- MCP endpoint: https://api.buywhere.ai/mcp\n- Schema.org-compatible product data (Product, Offer, ItemList)\n- Coverage: 2M+ Singapore products across 40+ merchants\n- Use cases: price comparison agents, shopping assistants, market research tools\n\n## Documentation\n- API docs: https://docs.buywhere.ai\n- MCP guide: https://api.buywhere.ai/docs/guides/mcp\n- GitHub: https://github.com/BuyWhere/buywhere\n\n## Licensing\nFree tier: 1,000 API calls/month. Commercial plans available.\n`
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
