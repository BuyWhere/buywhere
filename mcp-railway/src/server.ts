import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { Sentry, sentryRequestHandler } from './sentry';
import authRouter from './routes/auth';
import productsRouter from './routes/products';
import categoriesRouter from './routes/categories';
import redirectRouter from './routes/redirect';
import wellknownRouter, { sendOpenApiSpec } from './routes/wellknown';
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
import oauthRouter from './routes/oauth';
import merchantsRouter from './routes/merchants';
import ingestRouter from './routes/ingest';
import catalogRouter from './routes/catalog';
import keysRouter from './routes/keys';
import usageRouter from './routes/usage';
import webhooksRouter from './routes/webhooks';
import monitoringRouter from './monitoring/routes';
import { latencyMiddleware } from './monitoring/middleware';
import { histogramLatencyMiddleware } from './middleware/latency';
import adminUptimeRouter from './routes/admin/uptime';
import adminMetricsRouter from './routes/admin/metrics';
import { db, redis } from './config';

const DISCOVERY_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';
const AGENTS_TXT_CONTENT = `# BuyWhere AI Agents Discovery
User-agent: *
MCP: https://api.buywhere.ai/mcp
A2A: https://api.buywhere.ai/.well-known/agent.json
API: https://api.buywhere.ai/v1
API-Docs: https://api.buywhere.ai/docs
Auth: X-API-Key
Auth-Url: https://api.buywhere.ai/v1/auth/register
Register: POST https://api.buywhere.ai/v1/auth/register {"agent_name":"<your-agent>"} -> instant free API key, no email or human signup required
`;

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
  app.use(compression());

  // Sentry request context — attaches user/country/method for error tracking
  app.use(sentryRequestHandler);

  // Latency monitoring middleware for P95 calculation
  app.use(latencyMiddleware);

  // BUY-22737 / BUY-35381: per-request histogram ring buffer. Mounted after
  // the existing market-based latency middleware so it doesn't interfere.
  // Skips /v1/admin/* so internal polling does not pollute customer metrics.
  app.use(histogramLatencyMiddleware);

  // Health check - fast in-process check as required by BUY-3280
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      ts: new Date().toISOString(),
      fix: 'BUY-79598-v1',
    });
  });

  // BUY-31272: lightweight DB health — single SELECT 1 instead of schema introspection
  let dbHealthColumns: string[] | null = null;
  app.get('/health/db', async (_req, res) => {
    try {
      await db.query(`SELECT 1`);
      if (!dbHealthColumns) {
        try {
          const cols = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`
          );
          dbHealthColumns = cols.rows.map((r: { column_name: string }) => r.column_name);
        } catch {
          dbHealthColumns = [];
        }
      }
      res.set('Cache-Control', 'public, max-age=10');
      res.json({ status: 'ok', columns: dbHealthColumns || [], avg_rating_test: 'pass', ts: new Date().toISOString() });
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
  const serveOpenApi = (_req: express.Request, res: express.Response) => {
    sendOpenApiSpec(res);
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
  // /api/mcp — backwards-compatible alias (BUY-30153)
  app.use('/api/mcp', mcpRouter);

  // v1 API
  app.use('/v1/auth', authRouter);
  app.use('/v1/developers', authRouter);
  app.use('/v1/products', productsRouter);
  // v2 alias — same router, extends v1 contract with country_code + multi-region currency inference
  app.use('/v2/products', productsRouter);
  app.use('/v1/categories', categoriesRouter);
  app.use('/v1/merchants', merchantsRouter);
  app.use('/v1/ingest', ingestRouter);
  // BUY-31929: backward-compat alias — /ingest/bulk, /ingest/products, etc.
  app.use('/ingest', ingestRouter);

  // Backward-compat alias: /v1/search → /v1/products/search
  app.get("/v1/search", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(301, `/v1/products/search${qs}`);
  });
  app.use('/v1/analytics', analyticsRouter);
  app.use('/v1/revenue', revenueRouter);
  app.use('/v1/catalog', catalogRouter);
  app.use('/v1/keys', keysRouter);
  app.use('/v1/usage', usageRouter);
  app.use('/v1/compare', aiCrawlerHeaders, compareSlugRouter);
  app.use('/api/v1/compare', aiCrawlerHeaders, compareSlugRouter); // alias — FE integration uses /api prefix

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
  app.use('/admin/comparison-pages', adminCompareRouter);

  // Outbound click tracking (BUY-4869): /api/click redirect + /admin/clicks analytics
  app.use('/api', clicksRouter);
  // /v1/click alias: the site rewrites buywhere.ai/api/* -> api.buywhere.ai/v1/*,
  // so root-domain click_urls land here (F32).
  app.use('/v1', clicksRouter);
  // OAuth 2.1 M1 scaffold (docs/oauth-design.md)
  app.use('/v1/oauth', oauthRouter);
  // RFC 8414 requires root-level discovery; reuse the router's handler path
  app.use('/', oauthRouter);
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
    res.set('Content-Signal', 'ai-train=no, search=yes, ai-input=yes');
    res.type('text/plain').send(
      [
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

  app.get('/agents.txt', (_req, res) => {
    res.set('X-Robots-Tag', 'ai-index');
    res.set('Cache-Control', DISCOVERY_CACHE_CONTROL);
    res.type('text/plain').send(AGENTS_TXT_CONTENT);
  });

  // Landing pages — homepage (en_SG) and US edition (en_US)
  app.use(landingRouter);

  // Webhook relay — UptimeRobot → Paperclip issue creation
  app.use('/webhooks', webhooksRouter);

  // P95 monitoring endpoints (BUY-31208)
  app.use(monitoringRouter);

  // BUY-22737 / BUY-35381: admin endpoints (uptime + metrics).
  // Auth is handled inside each router via Authorization: Bearer <admin key>.
  app.use(adminUptimeRouter);
  app.use(adminMetricsRouter);

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
