#!/usr/bin/env node
/**
 * BUY-65098 JSON-LD normalization verification
 *
 * Proves that blog post JSON-LD frontmatter renders as valid JSON strings
 * regardless of whether the YAML frontmatter specifies an object or a string.
 *
 * Cases:
 * - object block (the 6 MCP posts) → serialized to JSON string
 * - valid JSON string → validated and passed through unchanged
 * - malformed string → stringified as a JSON string literal
 * - undefined → remains undefined
 */

import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';

const blogDir = path.join(process.cwd(), 'content/blog');

const MCP_SLUGS = [
  'building-production-mcp-servers',
  'buywhere-mcp-goes-live',
  'five-mcp-servers-that-earn-context-window',
  'mcp-for-ecommerce',
  'mcp-server-ecosystem-2026',
  'the-mcp-server-discovery-gap',
];

function normalizeJsonLd(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    try { JSON.parse(raw); return raw; }
    catch { return JSON.stringify(raw); }
  } else {
    return JSON.stringify(raw);
  }
}

let errors = 0;

function getBlogPostBySlug(slug) {
  const filePath = path.join(blogDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return undefined;
  const source = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(source);
  if (!data.slug || !data.title || !data.description || !data.publishedAt) return undefined;

  const toIsoDate = (value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

  return {
    slug: data.slug,
    title: data.title,
    description: data.description,
    author: data.author ?? 'BuyWhere Team',
    publishedAt: toIsoDate(data.publishedAt),
    lastUpdatedAt: data.lastUpdatedAt ? toIsoDate(data.lastUpdatedAt) : toIsoDate(data.publishedAt),
    canonicalUrl: data.canonicalUrl,
    coverImage: data.coverImage,
    tags: data.tags ?? [],
    jsonLd: normalizeJsonLd(data.jsonLd),
    body: content.trim(),
  };
}

console.log('=== Verifying MCP blog posts JSON-LD normalization ===\n');

// Load a known MCP post to inspect raw frontmatter
const testSlug = MCP_SLUGS[0];
const testSource = fs.readFileSync(path.join(blogDir, `${testSlug}.md`), 'utf-8');
const { data } = matter(testSource);

console.log(`Sample frontmatter (${testSlug}):`);
console.log('  jsonLd type:', typeof data.jsonLd);
console.log('  raw value:', JSON.stringify(data.jsonLd).substring(0, 100));

const normalized = normalizeJsonLd(data.jsonLd);
try {
  const parsed = JSON.parse(normalized);
  console.log('  normalized type:', typeof normalized);
  console.log('  normalized parses:', true);
  console.log('  parsed @type:', parsed['@type']);
} catch (e) {
  errors++;
  console.log('  ERROR: normalized does not parse as JSON:', e.message);
}

console.log('\n=== Verifying all 6 MCP posts parse cleanly ===\n');

for (const slug of MCP_SLUGS) {
  const post = getBlogPostBySlug(slug);
  if (!post) {
    console.log(`[ERROR] ${slug}: post not found`);
    errors++;
    continue;
  }
  if (!post.jsonLd) {
    console.log(`[ERROR] ${slug}: jsonLd undefined`);
    errors++;
    continue;
  }
  try {
    const parsed = JSON.parse(post.jsonLd);
    console.log(`[OK] ${slug}: @type=${parsed['@type']}`);
  } catch (e) {
    console.log(`[ERROR] ${slug}: ${e.message}`);
    errors++;
  }
}

console.log('\n=== Summary ===');
console.log(`Errors: ${errors}`);
process.exit(errors > 0 ? 1 : 0);