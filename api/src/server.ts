import express from 'express';
import cors from 'cors';
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
import sitemapCompareRouter from './routes/sitemapCompare';
import { db } from './config';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Health check
  app.get('/health', async (_req, res) => {
    try {
      const result = await db.query('SELECT COUNT(*) FROM products');
      res.json({
        status: 'ok',
        ts: new Date().toISOString(),
        catalog: { total_products: parseInt(result.rows[0].count, 10) },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', error: String(err) });
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

  // MCP JSON-RPC endpoint (Model Context Protocol)
  app.use('/mcp', mcpRouter);

  // v1 API
  app.use('/v1/auth', authRouter);
  app.use('/v1/products', productsRouter);
  app.use('/v1/categories', categoriesRouter);
  app.use('/v1/analytics', analyticsRouter);
  app.use('/v1/compare', aiCrawlerHeaders, compareSlugRouter);

  // Admin editorial CRUD (ADMIN_API_KEY auth, not rate-limited)
  app.use('/admin/comparison-pages', adminCompareRouter);

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

  // GEO / AI-crawler discoverability
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(
      [
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

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
