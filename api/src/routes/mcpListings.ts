import { Router, Request, Response } from 'express';
import { db } from '../config';
import { requireApiKey } from '../middleware/apiKey';

/**
 * The MCP listings ledger — one row per external surface where BuyWhere is (or should be)
 * listed, and the single place any agent reports what it found or did.
 *
 * Why this exists: our failures were never capacity. Five registry identities for one
 * server, three LobeHub pages, and five duplicate PRs all came from separate actors
 * submitting without a shared memory of what had already been done. Read-only checking
 * can fan out across as many agents as we like; writes go through one ledger so a
 * duplicate submission is visible before it happens, not after.
 */
const router = Router();

const STATES = new Set(['todo', 'in_progress', 'submitted', 'live', 'needs_fix', 'parked', 'blocked']);

// The facts every listing must publish. Agents copy from here rather than inventing copy
// or reusing a stale directory page.
const CANONICAL = {
  endpoint: 'https://api.buywhere.ai/mcp',
  alternate_endpoint: 'https://mcp.buywhere.ai/mcp',
  transport: 'streamable-http',
  install: 'npx -y @buywhere/mcp-server',
  npm_package: '@buywhere/mcp-server',
  registry_id: 'io.github.BuyWhere/buywhere-mcp',
  catalog_claim: '300M+ products, 150,000+ stores',
  auth: 'API key — self-register at POST https://api.buywhere.ai/v1/auth/register?verify=false',
  tool_count: 13,
};

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[mcp-listings] ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    });
  };
}

/**
 * GET /v1/mcp-listings          — the whole ledger
 * GET /v1/mcp-listings?queue=1  — only what a browsing agent should act on, highest priority first
 */
router.get('/', requireApiKey, asyncHandler(async (req, res) => {
  const queueOnly = req.query.queue === '1' || req.query.queue === 'true';
  const where = queueOnly
    ? `WHERE needs_browser = true AND state NOT IN ('live', 'parked')`
    : '';
  const { rows } = await db.query(
    `SELECT id, surface, kind, listing_url, submit_url, state, needs_browser, priority,
            published_install, published_endpoint, published_claim, published_tools,
            matches_truth, findings, evidence_url, blocked_on, ticket,
            last_checked_at, last_action_at, updated_by, updated_at
       FROM mcp_listings ${where}
      ORDER BY priority ASC, state DESC, id ASC`
  );
  res.json({
    canonical: CANONICAL,
    count: rows.length,
    how_to_report: 'POST /v1/mcp-listings/{id} with any of: state, published_install, published_endpoint, published_claim, published_tools, matches_truth, findings, evidence_url, blocked_on',
    data: rows,
  });
}));

/**
 * POST /v1/mcp-listings/:id — report what you found or did on one surface.
 * Every field is optional; send only what you observed. The caller's API key is recorded,
 * so the ledger always says who last touched a surface.
 */
router.post('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  const b = (req.body || {}) as Record<string, unknown>;
  if (b.state !== undefined && !STATES.has(String(b.state))) {
    res.status(400).json({ error: `state must be one of: ${[...STATES].join(', ')}` });
    return;
  }
  const who = (req as any).apiKeyRecord?.agentName
    || (req as any).apiKeyRecord?.apiKeyId
    || 'unknown';

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => {
    if (val === undefined) return;
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  set('state', b.state);
  set('published_install', b.published_install);
  set('published_endpoint', b.published_endpoint);
  set('published_claim', b.published_claim);
  set('published_tools', b.published_tools === undefined ? undefined : Number(b.published_tools));
  set('matches_truth', b.matches_truth === undefined ? undefined : Boolean(b.matches_truth));
  set('findings', b.findings);
  set('evidence_url', b.evidence_url);
  set('blocked_on', b.blocked_on);
  set('listing_url', b.listing_url);
  if (b.acted === true) sets.push('last_action_at = now()');
  sets.push('last_checked_at = now()');
  params.push(who); sets.push(`updated_by = $${params.length}`);
  sets.push('updated_at = now()');

  params.push(id);
  const { rows } = await db.query(
    `UPDATE mcp_listings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (rows.length === 0) {
    res.status(404).json({ error: `no listing with id "${id}"`, hint: 'GET /v1/mcp-listings for valid ids' });
    return;
  }
  res.json({ ok: true, updated_by: who, data: rows[0] });
}));

export default router;
