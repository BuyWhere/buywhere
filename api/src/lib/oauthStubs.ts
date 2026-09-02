// OAuth 2.1 scaffold (M1, 2026-08-22) — see docs/oauth-design.md.
// Pure contract builders so the 501 payloads are testable without the server.

export const OAUTH_SCOPES = ['catalog.read', 'offers.read'] as const;

export interface OAuthStubPayload {
  error: 'not_implemented';
  message: string;
  design: string;
  contract: Record<string, unknown>;
}

export function buildRegisterStub(): OAuthStubPayload {
  return {
    error: 'not_implemented',
    message: 'Dynamic client registration ships in M2 — use a static API key from buywhere.ai for now.',
    design: 'https://github.com/BuyWhere/buywhere/blob/main/docs/oauth-design.md',
    contract: {
      method: 'POST',
      request: { client_name: 'string', client_type: 'public|confidential', redirect_uris: ['uri'], scopes: OAUTH_SCOPES },
      response_201: { client_id: 'string', client_secret: 'string?(confidential only)', scopes: ['string'] },
    },
  };
}

export function buildTokenStub(): OAuthStubPayload {
  return {
    error: 'not_implemented',
    message: 'Token endpoint ships in M2 (client_credentials first) — use a static API key from buywhere.ai for now.',
    design: 'https://github.com/BuyWhere/buywhere/blob/main/docs/oauth-design.md',
    contract: {
      method: 'POST',
      grant_types: ['client_credentials', 'authorization_code', 'refresh_token'],
      response_200: { access_token: 'bwoat_...', token_type: 'Bearer', expires_in: 3600, scope: 'catalog.read offers.read' },
    },
  };
}
