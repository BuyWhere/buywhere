"use strict";
// OAuth 2.1 scaffold (M1, 2026-08-22) — see docs/oauth-design.md.
// Pure contract builders so the 501 payloads are testable without the server.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAUTH_SCOPES = void 0;
exports.buildRegisterStub = buildRegisterStub;
exports.buildTokenStub = buildTokenStub;
exports.OAUTH_SCOPES = ['catalog.read', 'offers.read'];
function buildRegisterStub() {
    return {
        error: 'not_implemented',
        message: 'Dynamic client registration ships in M2 — use a static API key from buywhere.ai for now.',
        design: 'https://github.com/BuyWhere/buywhere/blob/main/docs/oauth-design.md',
        contract: {
            method: 'POST',
            request: { client_name: 'string', client_type: 'public|confidential', redirect_uris: ['uri'], scopes: exports.OAUTH_SCOPES },
            response_201: { client_id: 'string', client_secret: 'string?(confidential only)', scopes: ['string'] },
        },
    };
}
function buildTokenStub() {
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
