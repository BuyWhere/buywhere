import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blogDir = join(__dirname, '..', 'content', 'blog');

function listBlogPosts() {
  return readdirSync(blogDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      data: matter(readFileSync(join(blogDir, name), 'utf8')).data,
    }));
}

test('every blog post frontmatter satisfies publishedAt <= lastUpdatedAt', () => {
  for (const post of listBlogPosts()) {
    const { publishedAt, lastUpdatedAt } = post.data;
    if (!publishedAt || !lastUpdatedAt) continue;
    const pub = String(publishedAt).slice(0, 10);
    const upd = String(lastUpdatedAt).slice(0, 10);
    assert.ok(
      upd >= pub,
      `${post.name}: lastUpdatedAt (${upd}) must be >= publishedAt (${pub})`,
    );
  }
});

test('every blog post JSON-LD dateModified satisfies datePublished <= dateModified', () => {
  for (const post of listBlogPosts()) {
    const { jsonLd } = post.data;
    if (!jsonLd) continue;
    const raw = typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd);
    const dp = raw.match(/"datePublished"\s*:\s*"([^"]+)"/);
    const dm = raw.match(/"dateModified"\s*:\s*"([^"]+)"/);
    if (!dp || !dm) continue;
    assert.ok(
      dm[1] >= dp[1],
      `${post.name}: JSON-LD dateModified (${dm[1]}) must be >= datePublished (${dp[1]})`,
    );
  }
});