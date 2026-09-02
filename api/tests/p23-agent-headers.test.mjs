// BUY-75413 (P2.3): regression guard — X-Agent-* HTTP response headers.
//
// This is a SOURCE-SHAPE guard, not a runtime probe. It asserts the wire is
// shipped in HEAD so a future regression that strips the headers (or the CORS
// expose) fails CI before deploy. The runtime probe is in
// scripts/check-p23-headers.mjs.
//
// The previous BUY-73471 implementation used a comma-separated list of
// protocol endpoints as X-Agent-Protocol and pointed Card/LLMs at the apex
// site. The P2.3 spec replaces those with versioned string and api.buywhere.ai
// URLs. Guard both: assert the spec values AND assert the legacy comma-list is
// gone (so a copy-paste from the old code regresses the header shape).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiDir, '..');
const agentHeaders = path.resolve(apiDir, 'src', 'middleware', 'agentHeaders.ts');
const serverTs = path.resolve(apiDir, 'src', 'server.ts');
const siteMiddleware = path.resolve(repoRoot, 'src', 'middleware.ts');

const agentHeadersSrc = fs.readFileSync(agentHeaders, 'utf8');
const serverSrc = fs.readFileSync(serverTs, 'utf8');
const siteMwSrc = fs.readFileSync(siteMiddleware, 'utf8');

describe('BUY-75413: P2.3 X-Agent-* headers (api)', () => {
  it('agentHeaders.ts sets the spec X-Agent-Protocol value (buywhere/v1)', () => {
    assert.match(
      agentHeadersSrc,
      /const AGENT_PROTOCOL = ['"]buywhere\/v1['"]/,
      'AGENT_PROTOCOL constant must equal "buywhere/v1"',
    );
    assert.match(
      agentHeadersSrc,
      /res\.set\([^)]*X-Agent-Protocol[^)]*AGENT_PROTOCOL/,
      'middleware must invoke res.set with X-Agent-Protocol and the AGENT_PROTOCOL constant',
    );
    assert.doesNotMatch(
      agentHeadersSrc,
      /MCP\s+https:\/\/api\.buywhere\.ai\/mcp,\s*REST/,
      'legacy comma-separated protocol list must be removed (BUY-73471 values)',
    );
  });

  it('agentHeaders.ts points X-Agent-Card at api.buywhere.ai/.well-known/agent.json', () => {
    assert.match(
      agentHeadersSrc,
      /const AGENT_CARD_URL = ['"]https:\/\/api\.buywhere\.ai\/\.well-known\/agent\.json['"]/,
      'AGENT_CARD_URL constant must point at the api.buywhere.ai agent.json endpoint',
    );
    assert.match(
      agentHeadersSrc,
      /res\.set\([^)]*X-Agent-Card[^)]*AGENT_CARD_URL/,
      'middleware must invoke res.set with X-Agent-Card and the AGENT_CARD_URL constant',
    );
  });

  it('agentHeaders.ts points X-LLMs-Txt at api.buywhere.ai/llms.txt', () => {
    assert.match(
      agentHeadersSrc,
      /const AGENT_LLMS_TXT_URL = ['"]https:\/\/api\.buywhere\.ai\/llms\.txt['"]/,
      'AGENT_LLMS_TXT_URL constant must point at the api.buywhere.ai llms.txt endpoint',
    );
    assert.match(
      agentHeadersSrc,
      /res\.set\([^)]*X-LLMs-Txt[^)]*AGENT_LLMS_TXT_URL/,
      'middleware must invoke res.set with X-LLMs-Txt and the AGENT_LLMS_TXT_URL constant',
    );
  });

  it('agentHeaders.ts exports agentIndexMiddleware', () => {
    assert.match(
      agentHeadersSrc,
      /export function agentIndexMiddleware/,
      'agentIndexMiddleware must be exported for catalog routers',
    );
  });

  it('agentIndexMiddleware sets X-Agent-Index via a writeHead shim on status 200', () => {
    const idx = agentHeadersSrc.indexOf('export function agentIndexMiddleware');
    assert.ok(idx > -1, 'agentIndexMiddleware must exist');
    const slice = agentHeadersSrc.slice(idx, idx + 2500);
    // The hook must register with the response-writeHead shim and only act on 200.
    assert.match(slice, /statusCode\s*!==\s*200/, 'must guard on 200');
    assert.match(slice, /X-Agent-Index/, 'must set X-Agent-Index');
  });

  it('agentHeadersMiddleware emits X-Agent-Auth via a writeHead shim for 401/403', () => {
    const idx = agentHeadersSrc.indexOf('export function agentHeadersMiddleware');
    assert.ok(idx > -1, 'agentHeadersMiddleware must exist');
    const slice = agentHeadersSrc.slice(idx, idx + 2500);
    assert.match(
      slice,
      /statusCode\s*===\s*401\s*\|\|\s*statusCode\s*===\s*403/,
      'must guard on 401/403',
    );
    assert.match(slice, /X-Agent-Auth/, 'must set X-Agent-Auth');
  });

  it('writeHead shim allows multiple hooks (Auth + Index) to coexist', () => {
    // The shim collects hooks in a per-response list. agentHeadersMiddleware
    // (Auth hook) and agentIndexMiddleware (Index hook) both run on the same
    // request in catalog routers — verify both injection paths exist.
    assert.match(
      agentHeadersSrc,
      /HOOKS/,
      'writeHead shim must collect hooks per response',
    );
    assert.match(
      agentHeadersSrc,
      /for \(const h of hooks\)/,
      'writeHead shim must invoke every registered hook',
    );
  });

  it('api/src/server.ts CORS exposes all 5 X-Agent-* headers', () => {
    assert.match(
      serverSrc,
      /exposedHeaders:\s*\[[^\]]*['"]X-Agent-Protocol['"][^\]]*['"]X-Agent-Card['"][^\]]*['"]X-LLMs-Txt['"][^\]]*['"]X-Agent-Index['"][^\]]*['"]X-Agent-Auth['"][^\]]*\]/,
      'cors({ exposedHeaders }) must include all 5 X-Agent-* header names',
    );
  });
});

describe('BUY-75413: P2.3 X-Agent-* headers (site)', () => {
  it('src/middleware.ts applies X-Agent-Protocol/Card/LLMs-Txt on every response', () => {
    assert.match(
      siteMwSrc,
      /AGENT_DISCOVERY_HEADERS/,
      'site middleware must declare AGENT_DISCOVERY_HEADERS',
    );
    assert.match(
      siteMwSrc,
      /applyAgentDiscoveryHeaders/,
      'site middleware must define applyAgentDiscoveryHeaders',
    );
    assert.match(
      siteMwSrc,
      /applyAgentDiscoveryHeaders\(response\)/,
      'applyAgentDiscoveryHeaders must be invoked on the response in the standard path',
    );
  });

  it('site middleware X-Agent-Card URL is the api.buywhere.ai URL, not the apex site', () => {
    assert.match(
      siteMwSrc,
      /["']X-Agent-Card["']\s*,\s*["']https:\/\/api\.buywhere\.ai\/\.well-known\/agent\.json["']/,
      'site X-Agent-Card must point at api.buywhere.ai/.well-known/agent.json',
    );
  });
});