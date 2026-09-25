#!/usr/bin/env node
// Generates the "### MCP Tools" section of the public llms.txt files from the MCP tool
// registry (TOOLS + V2_TOOLS in api/src/routes/mcp.ts), so the published list cannot
// drift from what tools/list actually serves. `--check` exits 1 on drift (used by CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = resolve(root, 'api/src/routes/mcp.ts');
const TARGETS = ['public/llms.txt', 'public/.well-known/llms.txt'];
const WRITE_TOOL = /^ingest_/;

function registryToolNames() {
  const src = readFileSync(REGISTRY, 'utf8');
  const start = src.indexOf('const TOOLS = [');
  const end = src.indexOf('const TOOLS_ALL');
  if (start < 0 || end < 0 || end < start) throw new Error('TOOLS / TOOLS_ALL not found in mcp.ts');
  // Tool objects are array elements indented two spaces, so their `name:` sits at four.
  // Nested schema properties are indented deeper and never match.
  const names = [...src.slice(start, end).matchAll(/^ {4}name: '([a-z0-9_]+)',$/gm)].map((m) => m[1]);
  if (names.length === 0) throw new Error('no tool names parsed from mcp.ts');
  if (new Set(names).size !== names.length) throw new Error('duplicate tool names in registry');
  return names;
}

function render(names) {
  const lines = names.map((n) => `- ${n}${WRITE_TOOL.test(n) ? ' (write; authenticated merchants only)' : ''}`);
  return [`### MCP Tools (${names.length} total, generated from the MCP tools/list registry)`, ...lines].join('\n');
}

const block = render(registryToolNames());
const check = process.argv.includes('--check');
let drift = 0;
for (const rel of TARGETS) {
  const path = resolve(root, rel);
  const text = readFileSync(path, 'utf8');
  // The section is the "### MCP Tools" header, an optional "The N MCP tools ..." intro
  // line (the .well-known copy has one), and the contiguous "- " lines under it.
  const re = /^### MCP Tools[^\n]*\n(?:The \d+ MCP tools[^\n]*\n)?(?:- [^\n]*\n)+/m;
  if (!re.test(text)) throw new Error(`${rel}: "### MCP Tools" section not found`);
  const next = text.replace(re, `${block}\n`);
  if (next !== text) {
    drift += 1;
    if (check) console.error(`${rel}: MCP tool list is out of date with api/src/routes/mcp.ts`);
    else { writeFileSync(path, next); console.log(`${rel}: regenerated`); }
  } else {
    console.log(`${rel}: up to date`);
  }
}
if (check && drift > 0) {
  console.error('Run: node scripts/generate-llms-tools.mjs');
  process.exit(1);
}
