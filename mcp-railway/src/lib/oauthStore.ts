// OAuth M2 store (2026-08-22) — pure data layer per docs/oauth-design.md.
// No route wiring in this commit; endpoints switch from 501 to live in M2 step 2.
// Every access token maps to an api_keys row so existing enforcement applies.
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { catalogDb } from '../config';

export const OAUTH_SCOPES_ALLOWED = ['catalog.read', 'offers.read'] as const;
export const ACCESS_TOKEN_TTL_S = 3600;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface RegisteredClient {
  client_id: string;
  client_secret?: string; // returned ONCE, confidential clients only
  client_name: string;
  client_type: 'public' | 'confidential';
  scopes: string[];
}

export function sanitizeScopes(requested: unknown): string[] {
  if (!Array.isArray(requested) || requested.length === 0) {
    return [...OAUTH_SCOPES_ALLOWED];
  }
  const ok = requested.filter(
    (s): s is string => typeof s === 'string' && (OAUTH_SCOPES_ALLOWED as readonly string[]).includes(s)
  );
  return ok.length ? ok : [...OAUTH_SCOPES_ALLOWED];
}

export async function createOAuthClient(opts: {
  clientName: string;
  clientType: 'public' | 'confidential';
  redirectUris: string[];
  scopes: string[];
  registrationIp: string | null;
}): Promise<RegisteredClient> {
  const clientId = `bwc_${randomBytes(16).toString('hex')}`;
  const secret = opts.clientType === 'confidential' ? `bwcs_${randomBytes(24).toString('hex')}` : undefined;
  await catalogDb.query(
    `INSERT INTO oauth_clients
       (id, client_id, client_secret_hash, client_name, client_type, redirect_uris, scopes, registration_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv4(), clientId, secret ? sha256(secret) : null, opts.clientName.slice(0, 200),
     opts.clientType, opts.redirectUris.slice(0, 10), opts.scopes, opts.registrationIp]
  );
  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret } : {}),
    client_name: opts.clientName.slice(0, 200),
    client_type: opts.clientType,
    scopes: opts.scopes,
  };
}

export async function authenticateClient(clientId: string, clientSecret?: string): Promise<{
  ok: boolean; reason?: string; scopes?: string[]; clientType?: string; apiKeyId?: string | null;
}> {
  const r = await catalogDb.query(
    `SELECT client_secret_hash, client_type, scopes, api_key_id, disabled_at
     FROM oauth_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!r.rows.length) return { ok: false, reason: 'invalid_client' };
  const row = r.rows[0];
  if (row.disabled_at) return { ok: false, reason: 'client_disabled' };
  if (row.client_type === 'confidential') {
    if (!clientSecret) return { ok: false, reason: 'invalid_client' };
    const given = new Uint8Array(Buffer.from(sha256(clientSecret)));
    const stored = new Uint8Array(Buffer.from(String(row.client_secret_hash || '')));
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      return { ok: false, reason: 'invalid_client' };
    }
  }
  return { ok: true, scopes: row.scopes, clientType: row.client_type, apiKeyId: row.api_key_id };
}

/** client_credentials grant: mint an opaque access token; lazily create + link the
 *  api_keys row on first grant so all existing key enforcement applies. */
export async function issueClientCredentialsToken(clientId: string, scopes: string[]): Promise<{
  access_token: string; token_type: 'Bearer'; expires_in: number; scope: string;
}> {
  // ensure linked api_key
  const c = await catalogDb.query(
    `SELECT api_key_id, client_name FROM oauth_clients WHERE client_id = $1`, [clientId]
  );
  let apiKeyId: string | null = c.rows[0]?.api_key_id ?? null;
  if (!apiKeyId) {
    apiKeyId = uuidv4();
    const rawKey = `bw_${uuidv4().replace(/-/g, '')}`;
    await catalogDb.query(
      `INSERT INTO api_keys (id, key_hash, name, tier, is_active, signup_channel, developer_id, scopes)
       VALUES ($1, $2, $3, 'unverified', true, 'oauth', 'oauth-client', $4)`,
      [apiKeyId, sha256(rawKey), `oauth:${(c.rows[0]?.client_name || clientId).slice(0, 180)}`, scopes]
    );
    await catalogDb.query(
      `UPDATE oauth_clients SET api_key_id = $1 WHERE client_id = $2`, [apiKeyId, clientId]
    );
  }
  const token = `bwoat_${randomBytes(32).toString('base64url')}`;
  await catalogDb.query(
    `INSERT INTO oauth_tokens (token_hash, client_id, api_key_id, kind, scopes, expires_at)
     VALUES ($1, $2, $3, 'access', $4, now() + interval '${ACCESS_TOKEN_TTL_S} seconds')`,
    [sha256(token), clientId, apiKeyId, scopes]
  );
  return { access_token: token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, scope: scopes.join(' ') };
}

/** Resolve a bwoat_ bearer to its api_key id (for the auth middleware in step 2). */
export async function verifyAccessToken(token: string): Promise<{ apiKeyId: string; scopes: string[] } | null> {
  if (!token.startsWith('bwoat_')) return null;
  const r = await catalogDb.query(
    `SELECT api_key_id, scopes FROM oauth_tokens
     WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)]
  );
  if (!r.rows.length || !r.rows[0].api_key_id) return null;
  return { apiKeyId: r.rows[0].api_key_id, scopes: r.rows[0].scopes || [] };
}
