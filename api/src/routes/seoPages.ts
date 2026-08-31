import { Router, Request, Response, NextFunction } from 'express';
import { db, catalogDb } from '../config';
import { adminAuth } from './admin/auth';

type SeoPageStatus = 'draft' | 'review' | 'published';

const router = Router();
const VALID_STATUSES = new Set<SeoPageStatus>(['draft', 'review', 'published']);

function httpError(message: string, statusCode = 400): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function normalizeSlug(value: unknown): string {
  const slug = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!slug) throw httpError('slug is required');
  return slug;
}

function pageCountry(page: Record<string, unknown>): string {
  const country = String(page.country || '').toUpperCase();
  if (country !== 'US' && country !== 'SG') throw httpError('page.country must be US or SG');
  return country;
}

function pageSearchQuery(page: Record<string, unknown>): string {
  const searchQuery = String(page.searchQuery || '').trim();
  if (!searchQuery) throw httpError('page.searchQuery is required');
  return searchQuery;
}

function parseStatus(value: unknown, fallback?: SeoPageStatus): SeoPageStatus {
  const status = (value || fallback || 'draft') as SeoPageStatus;
  if (!VALID_STATUSES.has(status)) throw httpError('status must be draft, review, or published');
  return status;
}

function parseDateModified(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw httpError('dateModified must be a valid date');
  return parsed;
}

function assertMerchantLinksAreR(value: unknown, path = 'page'): void {
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered.includes('http://') || lowered.includes('https://')) {
      throw httpError(`external URL is not allowed at ${path}; merchant links must use /r`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMerchantLinksAreR(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    if (typeof item === 'string' && (keyLower.includes('href') || keyLower.includes('url') || keyLower.includes('link'))) {
      if (item.startsWith('http://') || item.startsWith('https://')) {
        throw httpError(`merchant href at ${path}.${key} must be a /r link`);
      }
      if (keyLower.includes('merchant') && item && !item.startsWith('/r')) {
        throw httpError(`merchant href at ${path}.${key} must be a /r link`);
      }
    }
    assertMerchantLinksAreR(item, `${path}.${key}`);
  }
}

async function pricedSearchCount(page: Record<string, unknown>): Promise<number> {
  const country = pageCountry(page);
  const searchQuery = pageSearchQuery(page);
  const minPrice = Number(page.minPrice || 0);
  const terms = searchQuery.split(/\s+/).map((term) => term.trim()).filter((term) => term.length > 1).slice(0, 6);
  const params: unknown[] = [country, Number.isFinite(minPrice) ? minPrice : 0];
  let termSql = '';
  if (terms.length > 0) {
    termSql = `AND (${terms.map((term) => {
      params.push(`%${term}%`);
      return `title ILIKE $${params.length}`;
    }).join(' OR ')})`;
  }
  const result = await catalogDb.query(
    `SELECT COUNT(*)::int AS count
       FROM products
      WHERE is_active = true
        AND price IS NOT NULL
        AND price > $2
        AND upper(country_code) = $1
        ${termSql}`,
    params
  );
  return Number(result.rows[0]?.count || 0);
}

async function validatePublishGate(page: Record<string, unknown>): Promise<void> {
  assertMerchantLinksAreR(page);
  const count = await pricedSearchCount(page);
  if (count < 6) throw httpError(`publish gate failed: searchQuery returned ${count} priced products; need >=6`);
}

function toResponse(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    slug: row.slug,
    status: row.status,
    country: row.country,
    searchQuery: row.search_query,
    reviewer: row.reviewer,
    dateModified: row.date_modified,
    publishedAt: row.published_at,
    page: row.page,
  };
}

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    const result = await db.query(
      `SELECT id, slug, status, country, search_query, reviewer, page, published_at, date_modified
         FROM seo_pages
        WHERE slug = $1 AND status = 'published'
        LIMIT 1`,
      [slug]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'SEO page not found' });
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.set('X-Robots-Tag', 'ai-index');
    return res.json(toResponse(result.rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.post('/', adminAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const slug = normalizeSlug(body.slug);
    const page = { ...(body.page || {}), slug };
    const status = parseStatus(body.status);
    const country = pageCountry(page);
    const searchQuery = pageSearchQuery(page);
    const dateModified = parseDateModified(body.dateModified) || new Date();
    if (status === 'published') await validatePublishGate(page);

    const result = await db.query(
      `INSERT INTO seo_pages (slug, status, country, search_query, reviewer, page, date_modified, published_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, CASE WHEN $2 = 'published' THEN NOW() ELSE NULL END)
       RETURNING id, slug, status, country, search_query, reviewer, page, published_at, date_modified`,
      [slug, status, country, searchQuery, body.reviewer || null, JSON.stringify(page), dateModified]
    );
    return res.status(201).json(toResponse(result.rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.put('/:slug', adminAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    const current = await db.query('SELECT * FROM seo_pages WHERE slug = $1 LIMIT 1', [slug]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'SEO page not found' });

    const body = req.body || {};
    const row = current.rows[0];
    const page = body.page ? { ...body.page, slug } : { ...(row.page || {}), slug };
    const status = parseStatus(body.status, row.status);
    const country = pageCountry(page);
    const searchQuery = pageSearchQuery(page);
    const dateModified = parseDateModified(body.dateModified) || row.date_modified || new Date();
    if (status === 'published') await validatePublishGate(page);

    const result = await db.query(
      `UPDATE seo_pages
          SET status = $2,
              country = $3,
              search_query = $4,
              reviewer = COALESCE($5, reviewer),
              page = $6::jsonb,
              date_modified = $7,
              published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
              updated_at = NOW()
        WHERE slug = $1
        RETURNING id, slug, status, country, search_query, reviewer, page, published_at, date_modified`,
      [slug, status, country, searchQuery, body.reviewer ?? null, JSON.stringify(page), dateModified]
    );
    return res.json(toResponse(result.rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

export default router;
