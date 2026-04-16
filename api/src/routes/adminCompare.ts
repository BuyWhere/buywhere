import { Router, Request, Response, NextFunction } from 'express';
import { db, redis } from '../config';

const router = Router();

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// Admin auth middleware — checks Authorization: Bearer <ADMIN_API_KEY>
function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
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
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 70;
}

function bustCache(slug: string): void {
  redis.del(`compare:slug:${slug}`).catch(() => {});
}

// GET /admin/comparison-pages — list all pages (all statuses)
router.get('/', requireAdminKey, async (_req: Request, res: Response) => {
  const result = await db.query(
    `SELECT
       cp.id, cp.slug, cp.category, cp.status, cp.expert_summary,
       cp.hero_image_url, cp.published_at, cp.metadata, cp.product_id,
       cp.created_at, cp.updated_at,
       p.name AS product_title
     FROM comparison_pages cp
     JOIN products p ON p.id = cp.product_id
     ORDER BY cp.updated_at DESC`
  ).catch((err: Error) => { throw err; });

  res.json({ data: result.rows, total: result.rows.length });
});

// POST /admin/comparison-pages — create a new comparison page
router.post('/', requireAdminKey, async (req: Request, res: Response) => {
  const { slug, product_id, category, status, expert_summary, hero_image_url, metadata } = req.body;

  if (!slug || !product_id || !category) {
    res.status(400).json({ error: 'slug, product_id, and category are required' });
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

  const result = await db.query(
    `INSERT INTO comparison_pages
       (slug, product_id, category, status, expert_summary, hero_image_url, published_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      slug,
      product_id,
      category,
      pageStatus,
      expert_summary || null,
      hero_image_url || null,
      publishedAt,
      metadata ? JSON.stringify(metadata) : null,
    ]
  ).catch((err: Error & { code?: string }) => {
    if (err.code === '23505') throw Object.assign(new Error('slug already exists'), { statusCode: 409 });
    if (err.code === '23503') throw Object.assign(new Error('product_id not found'), { statusCode: 422 });
    throw err;
  });

  if (pageStatus === 'published') bustCache(slug);

  res.status(201).json(result.rows[0]);
});

// PATCH /admin/comparison-pages/:id — update an existing page
router.patch('/:id', requireAdminKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { slug, product_id, category, status, expert_summary, hero_image_url, metadata } = req.body;

  // Fetch current row to get old slug for cache busting
  const current = await db.query(
    `SELECT slug, status FROM comparison_pages WHERE id = $1`, [id]
  ).catch(() => null);

  if (!current || current.rows.length === 0) {
    res.status(404).json({ error: 'Comparison page not found' });
    return;
  }

  const oldSlug = current.rows[0].slug as string;
  const oldStatus = current.rows[0].status as string;

  if (slug !== undefined && !isValidSlug(slug)) {
    res.status(400).json({ error: 'slug must be kebab-case ASCII, max 70 chars' });
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
  let publishedAt: Date | undefined;
  if (status === 'published' && oldStatus !== 'published') {
    publishedAt = new Date();
  }

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  const addField = (val: unknown, col: string, transform?: (v: unknown) => unknown) => {
    if (val !== undefined) {
      setClauses.push(`${col} = $${idx++}`);
      params.push(transform ? transform(val) : val);
    }
  };

  addField(slug, 'slug');
  addField(product_id, 'product_id');
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
  const result = await db.query(
    `UPDATE comparison_pages SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  ).catch((err: Error & { code?: string }) => {
    if (err.code === '23505') throw Object.assign(new Error('slug already exists'), { statusCode: 409 });
    if (err.code === '23503') throw Object.assign(new Error('product_id not found'), { statusCode: 422 });
    throw err;
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Comparison page not found' });
    return;
  }

  // Bust cache for old slug and new slug (if changed)
  bustCache(oldSlug);
  const newSlug = (slug || oldSlug) as string;
  if (newSlug !== oldSlug) bustCache(newSlug);

  res.json(result.rows[0]);
});

// Error handler for this router
router.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

export default router;
