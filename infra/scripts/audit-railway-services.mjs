#!/usr/bin/env node
/**
 * audit-railway-services.mjs
 *
 * Sweeps the BuyWhere Railway project and reports any service NOT in
 * infra/buywhere-canonical-services.json. Future INFRA-INTEGRITY sweeps should
 * run this before paging anyone — silent drift is the bug class this script
 * exists to catch.
 *
 * Usage:
 *   RAILWAY_PROJECT_TOKEN=... node infra/scripts/audit-railway-services.mjs
 *
 * Requires:
 *   - A Railway project-scope access token (NOT an account token — those are
 *     not available to agents per BUY-66670 / BUY-60578).
 *   - The `projectId` field in buywhere-canonical-services.json (currently
 *     a9456c30-63f8-4701-baa1-ecc9274e95ed for BuyWhere).
 *
 * Output: prints a JSON object to stdout with:
 *   - `whitelist`: list of canonical service ids loaded from the whitelist
 *   - `live`: list of services currently in the Railway project
 *   - `unauthorized_new`: services present in Railway but NOT in the whitelist
 *   - `unauthorized_missing`: services in the whitelist but NOT in Railway (rename/delete?)
 *   - `env_var_leaks`: services whose latest deployment's startCommand references
 *                     /paperclip/, master.key, or any control-plane path
 *
 * Exit codes:
 *   0  audit ran, no unauthorized services found
 *   1  unauthorized services or env-var leaks found
 *   2  audit could not run (missing token / GraphQL error)
 *
 * Created by Rex for BUY-74715 on 2026-08-25.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WHITELIST_PATH = resolve(__dirname, '..', 'buywhere-canonical-services.json');

const TOKEN = process.env.RAILWAY_PROJECT_TOKEN;
if (!TOKEN) {
  console.error('RAILWAY_PROJECT_TOKEN env var is required');
  process.exit(2);
}

const GQL = 'https://backboard.railway.com/graphql/v2';

const whitelistDoc = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
const whitelistIds = new Set(whitelistDoc.services.map(s => s.id));

async function gql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Project-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

const FORBIDDEN_PATTERNS = [
  { pattern: /\/paperclip\//i, label: '/paperclip/' },
  { pattern: /master\.key/i, label: 'master.key' },
  { pattern: /PAPERCLIP_(SECRETS_)?MASTER_KEY/i, label: 'PAPERCLIP_MASTER_KEY' },
];

function scanForControlPlaneRefs(text) {
  if (!text) return [];
  return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(f => f.label);
}

const data = await gql(`query($projectId: String!) {
  project(id: $projectId) {
    services { edges { node { id name createdAt } } }
  }
}`, { projectId: whitelistDoc.projectId });

const liveServices = data.project.services.edges.map(e => e.node);
const liveIds = new Set(liveServices.map(s => s.id));

const unauthorizedNew = liveServices.filter(s => !whitelistIds.has(s.id));
const unauthorizedMissing = whitelistDoc.services.filter(s => !liveIds.has(s.id));

// Now scan latest deployment startCommand for control-plane references.
// Project tokens can't read service.startCommand directly; the deployment's
// serviceManifest.startCommand is what Railway actually runs.
const envVarLeaks = [];
for (const svc of liveServices) {
  const depData = await gql(`query($serviceId: String!) {
    deployments(input: { serviceId: $serviceId }) {
      edges { node { id status meta } }
    }
  }`, { serviceId: svc.id });
  const edges = depData.deployments.edges;
  if (!edges.length) continue;
  const meta = edges[0].node.meta || {};
  const startCommands = [
    meta.serviceManifest?.deploy?.startCommand,
    meta.fileServiceManifest?.deploy?.startCommand,
  ].filter(Boolean);
  for (const sc of startCommands) {
    const flags = scanForControlPlaneRefs(sc);
    if (flags.length) {
      envVarLeaks.push({
        serviceId: svc.id,
        serviceName: svc.name,
        deploymentId: edges[0].node.id,
        startCommand: sc,
        flaggedPatterns: flags,
      });
      break;
    }
  }
}

const report = {
  auditRunAt: new Date().toISOString(),
  whitelist: Array.from(whitelistIds).sort(),
  live: liveServices.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt })).sort((a, b) => a.name.localeCompare(b.name)),
  unauthorized_new: unauthorizedNew.map(s => ({ id: s.id, name: s.name, createdAt: s.createdAt })),
  unauthorized_missing: unauthorizedMissing.map(s => ({ id: s.id, name: s.name })),
  env_var_leaks: envVarLeaks,
};

console.log(JSON.stringify(report, null, 2));

const hasIssue = unauthorizedNew.length > 0 || unauthorizedMissing.length > 0 || envVarLeaks.length > 0;
process.exit(hasIssue ? 1 : 0);