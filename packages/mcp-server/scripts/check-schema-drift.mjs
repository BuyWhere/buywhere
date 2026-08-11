#!/usr/bin/env node
/**
 * check-schema-drift.mjs — compare this package's advertised tool schemas
 * against the live BuyWhere /mcp `tools/list` contract.
 *
 * The stdio server proxies every call to the live endpoint, but it advertises
 * its OWN hardcoded copy of the tool schemas. When the live server gains a
 * tool, a parameter, or an enum value, this package keeps advertising the old
 * shape and MCP clients silently lose access to the new capability — the
 * failure is invisible because proxied calls still succeed.
 *
 * This script makes that drift loud.
 *
 * Usage:
 *   BUYWHERE_API_KEY=bw_live_xxx npm run check-drift
 *
 * Options:
 *   --json            machine-readable report on stdout
 *   --allow-missing-tools  don't fail on tools present live but absent here
 *                          (some are intentionally excluded, e.g. admin-only)
 *
 * Exit codes: 0 = in sync (or only intentional exclusions), 1 = drift, 2 = could not check.
 */

// Tools deliberately NOT exposed by the public npm package.
const INTENTIONALLY_EXCLUDED = new Set(['ingest_products']);

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const allowMissingTools = args.includes('--allow-missing-tools');

const API_BASE_URL = (process.env.BUYWHERE_API_URL ?? 'https://api.buywhere.ai').replace(/\/$/, '');
const MCP_URL = /\/mcp$/.test(API_BASE_URL) ? API_BASE_URL : `${API_BASE_URL}/mcp`;
const API_KEY = process.env.BUYWHERE_API_KEY ?? '';

if (!API_KEY) {
  console.error('check-drift: BUYWHERE_API_KEY is required to read the live tool contract.');
  process.exit(2);
}

async function liveTools() {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`live tools/list HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`live tools/list JSON-RPC ${json.error.code}: ${json.error.message}`);
  const tools = json.result?.tools;
  if (!Array.isArray(tools)) throw new Error('live tools/list returned no tools array');
  return tools;
}

async function packageTools() {
  // Import the built server module and read the schemas it advertises.
  // Importing dist/index.js would start a stdio server, so instead we read the
  // TOOLS array the same way a client would: spawn it and call tools/list.
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');

  const child = spawn(process.execPath, [new URL('../dist/index.js', import.meta.url).pathname], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BUYWHERE_API_KEY: API_KEY },
  });

  let buf = '';
  let stderr = '';
  let timer;
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  const tools = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) resolve(msg.result.tools);
        } catch {
          /* not a complete JSON-RPC line yet */
        }
      }
    });
    child.on('error', reject);
    // If the local server dies before answering (most commonly because
    // dist/index.js has not been built yet), fail immediately with its stderr
    // instead of stalling until the timeout with an opaque message.
    child.on('close', code => {
      const lines = stderr.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const detail =
        lines.find(l => /cannot find module|error:|err_/i.test(l)) ?? lines[0] ?? '';
      reject(
        new Error(
          `local server exited (code ${code}) before answering tools/list` +
            (detail ? ` — ${detail}` : ''),
        ),
      );
    });
    timer = setTimeout(
      () => reject(new Error('timed out reading tools/list from local server')),
      20_000,
    );
  });
  // Mark as handled now: the awaits below yield to the event loop, and an early
  // child exit during that window would otherwise be an unhandled rejection
  // that crashes the process before our caller's try/catch can report it.
  tools.catch(() => {});

  // The child may already be gone (e.g. dist/index.js missing); writing to its
  // stdin would then raise EPIPE and mask the real 'close' diagnostic above.
  child.stdin.on('error', () => {});
  const send = payload => {
    if (child.exitCode === null && child.signalCode === null && child.stdin.writable) {
      child.stdin.write(JSON.stringify(payload) + '\n');
    }
  };

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'drift-check', version: '1.0.0' },
    },
  });
  await new Promise(r => setTimeout(r, 300));
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  try {
    return await tools;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'close').catch(() => {});
    }
  }
}

function diffTool(name, mine, live) {
  const issues = [];
  const mp = mine.inputSchema?.properties ?? {};
  const lp = live.inputSchema?.properties ?? {};
  const mr = new Set(mine.inputSchema?.required ?? []);
  const lr = new Set(live.inputSchema?.required ?? []);

  const missing = Object.keys(lp).filter(p => !(p in mp)).sort();
  const extra = Object.keys(mp).filter(p => !(p in lp)).sort();
  if (missing.length) issues.push({ kind: 'missing_params', detail: missing });
  if (extra.length) issues.push({ kind: 'extra_params', detail: extra });

  const reqMismatch =
    [...lr].some(r => !mr.has(r)) || [...mr].some(r => !lr.has(r));
  if (reqMismatch) {
    issues.push({ kind: 'required_mismatch', detail: { package: [...mr].sort(), live: [...lr].sort() } });
  }

  for (const p of Object.keys(mp).filter(p => p in lp).sort()) {
    const me = mp[p].enum ? [...mp[p].enum].sort() : null;
    const le = lp[p].enum ? [...lp[p].enum].sort() : null;
    if (JSON.stringify(me) !== JSON.stringify(le)) {
      issues.push({ kind: `enum_mismatch:${p}`, detail: { package: me, live: le } });
    }
    if (mp[p].type && lp[p].type && mp[p].type !== lp[p].type) {
      issues.push({ kind: `type_mismatch:${p}`, detail: { package: mp[p].type, live: lp[p].type } });
    }
  }
  return issues;
}

let live, mine;
try {
  [live, mine] = await Promise.all([liveTools(), packageTools()]);
} catch (err) {
  console.error(`check-drift: could not compare — ${err.message}`);
  console.error('check-drift: run `npm run build` first if dist/index.js is missing.');
  process.exit(2);
}

const liveByName = new Map(live.map(t => [t.name, t]));
const mineByName = new Map(mine.map(t => [t.name, t]));

const missingTools = [...liveByName.keys()]
  .filter(n => !mineByName.has(n) && !INTENTIONALLY_EXCLUDED.has(n))
  .sort();
const excludedPresent = [...liveByName.keys()].filter(
  n => !mineByName.has(n) && INTENTIONALLY_EXCLUDED.has(n),
);
const staleTools = [...mineByName.keys()].filter(n => !liveByName.has(n)).sort();

const perTool = {};
for (const name of [...mineByName.keys()].filter(n => liveByName.has(n)).sort()) {
  const issues = diffTool(name, mineByName.get(name), liveByName.get(name));
  if (issues.length) perTool[name] = issues;
}

const drifted =
  staleTools.length > 0 ||
  Object.keys(perTool).length > 0 ||
  (missingTools.length > 0 && !allowMissingTools);

if (asJson) {
  console.log(
    JSON.stringify(
      { mcpUrl: MCP_URL, liveToolCount: live.length, packageToolCount: mine.length, missingTools, staleTools, excludedPresent, perTool, drifted },
      null,
      2,
    ),
  );
  process.exit(drifted ? 1 : 0);
}

console.log(`check-drift: live=${MCP_URL}`);
console.log(`check-drift: live tools=${live.length}, package tools=${mine.length}`);
if (excludedPresent.length) {
  console.log(`check-drift: intentionally excluded: ${excludedPresent.join(', ')}`);
}

if (!drifted) {
  console.log('check-drift: OK — package schemas match the live contract.');
  process.exit(0);
}

console.error('\ncheck-drift: DRIFT DETECTED\n');
if (missingTools.length) {
  console.error(`  Tools on live but NOT advertised by this package: ${missingTools.join(', ')}`);
  console.error('    → clients cannot reach these capabilities. Add them to TOOLS in src/index.ts.\n');
}
if (staleTools.length) {
  console.error(`  Tools advertised here but NOT on live: ${staleTools.join(', ')}`);
  console.error('    → calls will fail at runtime. Remove them from TOOLS in src/index.ts.\n');
}
for (const [name, issues] of Object.entries(perTool)) {
  console.error(`  ${name}:`);
  for (const i of issues) console.error(`    - ${i.kind}: ${JSON.stringify(i.detail)}`);
}
console.error('\ncheck-drift: update src/index.ts TOOLS to match, then re-run.');
process.exit(1);
