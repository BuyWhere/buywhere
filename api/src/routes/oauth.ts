// OAuth 2.1 — M2 live: dynamic client registration + client_credentials.
// authorize/refresh land in M3 (docs/oauth-design.md). M1 contract preserved
// in responses via the design link.
import { Router, Request, Response } from 'express';
import {
  createOAuthClient, authenticateClient, issueClientCredentialsToken,
  sanitizeScopes,
} from '../lib/oauthStore';

const router = Router();

// simple fixed-window limiters (same pattern as request-key route)
const regHits = new Map<string, { n: number; t: number }>();
const tokHits = new Map<string, { n: number; t: number }>();
function limited(map: Map<string, { n: number; t: number }>, id: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = map.get(id);
  if (!e || now - e.t > windowMs) { map.set(id, { n: 1, t: now }); return false; }
  if (e.n >= max) return true;
  e.n++;
  return false;
}

function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string) || req.ip || 'unknown';
}

// RFC 7591 open dynamic client registration — 5/hour/IP
router.post('/register', async (req: Request, res: Response) => {
  const ip = clientIp(req);
  if (limited(regHits, ip, 5, 3_600_000)) {
    res.status(429).json({ error: 'rate_limited', message: 'Max 5 registrations/hour per IP.' });
    return;
  }
  const b = (req.body || {}) as Record<string, unknown>;
  const name = typeof b.client_name === 'string' && b.client_name.trim()
    ? b.client_name.trim() : null;
  if (!name) {
    res.status(400).json({ error: 'invalid_client_metadata', message: 'client_name is required' });
    return;
  }
  const clientType = b.client_type === 'confidential' ? 'confidential' as const : 'public' as const;
  const redirectUris = Array.isArray(b.redirect_uris)
    ? b.redirect_uris.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 10)
    : [];
  try {
    const client = await createOAuthClient({
      clientName: name,
      clientType,
      redirectUris,
      scopes: sanitizeScopes(b.scopes),
      registrationIp: ip,
    });
    res.status(201).json({
      ...client,
      grant_types: ['client_credentials'],
      token_endpoint: 'https://api.buywhere.ai/v1/oauth/token',
      design: 'https://github.com/BuyWhere/buywhere/blob/main/docs/oauth-design.md',
    });
  } catch (err) {
    console.error('[oauth] register failed:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// token endpoint — client_credentials only (M2); 30/min/client
router.post('/token', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const grant = String(b.grant_type || '');
  if (grant !== 'client_credentials') {
    res.status(400).json({
      error: 'unsupported_grant_type',
      message: 'M2 supports client_credentials; authorization_code + refresh_token land in M3.',
    });
    return;
  }
  // client auth: body params or HTTP Basic
  let clientId = typeof b.client_id === 'string' ? b.client_id : '';
  let clientSecret = typeof b.client_secret === 'string' ? b.client_secret : undefined;
  const basic = req.headers['authorization'];
  if (!clientId && typeof basic === 'string' && basic.startsWith('Basic ')) {
    try {
      const [u, p] = Buffer.from(basic.slice(6), 'base64').toString().split(':');
      clientId = u || '';
      clientSecret = p || undefined;
    } catch { /* fall through to invalid_client */ }
  }
  if (!clientId) {
    res.status(400).json({ error: 'invalid_request', message: 'client_id required (body or Basic auth)' });
    return;
  }
  if (limited(tokHits, clientId, 30, 60_000)) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }
  try {
    const auth = await authenticateClient(clientId, clientSecret);
    if (!auth.ok) {
      res.status(401).json({ error: auth.reason || 'invalid_client' });
      return;
    }
    const token = await issueClientCredentialsToken(clientId, auth.scopes || []);
    res.status(200).json(token);
  } catch (err) {
    console.error('[oauth] token failed:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// RFC 8414 discovery — added in M2 (only live endpoints are advertised; the
// design doc forbids advertising 501s). M3 adds authorization_endpoint.
// RFC 9728 protected-resource metadata. MCP clients (spec 2025-06-18) discover the
// authorization server from the resource; without this document they cannot complete
// auth discovery and fall back to guessing. Added 2026-08-29.
router.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.json({
    resource: 'https://api.buywhere.ai/mcp',
    authorization_servers: ['https://api.buywhere.ai'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['catalog.read', 'offers.read'],
    resource_documentation: 'https://buywhere.ai/agent-dx',
  });
});

router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json({
    issuer: 'https://api.buywhere.ai',
    registration_endpoint: 'https://api.buywhere.ai/v1/oauth/register',
    token_endpoint: 'https://api.buywhere.ai/v1/oauth/token',
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    scopes_supported: ['catalog.read', 'offers.read'],
    response_types_supported: [],
    service_documentation: 'https://github.com/BuyWhere/buywhere/blob/main/docs/oauth-design.md',
  });
});

export default router;
