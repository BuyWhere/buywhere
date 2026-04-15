import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import productsRouter from './routes/products';
import categoriesRouter from './routes/categories';
import redirectRouter from './routes/redirect';
import wellknownRouter from './routes/wellknown';
import docsRouter from './routes/docs';
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

  // Docs
  app.use('/docs', docsRouter);

  // v1 API
  app.use('/v1/auth', authRouter);
  app.use('/v1/products', productsRouter);
  app.use('/v1/categories', categoriesRouter);

  // Affiliate redirect (no /v1 prefix — short URLs)
  app.use('/r', redirectRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
