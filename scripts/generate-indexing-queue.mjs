#!/usr/bin/env node
/**
 * generate-indexing-queue.mjs — Generate a queue of URLs that need GSC Indexing API submission.
 *
 * Reads DATABASE_URL from environment (defaults to data/.catalog_db_url if available).
 * Queries products and comparison_pages for recently-updated entries (default: 168h lookback).
 * Writes JSON queue to content/audits/midnight-indexing-queue-{date}.json (default 500 URLs).
 *
 * Usage:
 *   node scripts/generate-indexing-queue.mjs [date]        # Generate queue for date (YYYY-MM-DD, default today UTC)
 *   node scripts/generate-indexing-queue.mjs --dry-run      # Print URLs without writing file
 *
 * Environment:
 *   DATABASE_URL           — PostgreSQL connection string
 *   MAX_QUEUE_URLS        — Max URLs to queue (default: 500)
 *   LOOKBACK_HOURS        — Hours to look back for updated records (default: 168)
 */

import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDatabaseUrl() {
  // 1. Environment variable
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 2. Try to read from workspace file
  const dbUrlPath = path.join(REPO_ROOT, "data", ".catalog_db_url");
  try {
    return (await fs.readFile(dbUrlPath, "utf8")).trim();
  } catch {
    throw new Error("DATABASE_URL not set and data/.catalog_db_url not found");
  }
}

async function fetchUrlsToIndex(client, lookbackHours, limit) {
  // Query recently-updated comparison pages
  const comparisonQuery = `
    SELECT slug, updated_at, 'comparison' as url_type
    FROM comparison_pages
    WHERE updated_at > NOW() - INTERVAL '${lookbackHours} hours'
    ORDER BY updated_at DESC
    LIMIT $1
  `;

  // Query recently-updated products (with valid URLs)
  const productQuery = `
    SELECT id, url, updated_at, 'product' as url_type
    FROM products
    WHERE is_active = true
      AND is_available = true
      AND url IS NOT NULL
      AND updated_at > NOW() - INTERVAL '${lookbackHours} hours'
    ORDER BY updated_at DESC
    LIMIT $1
  `;

  // Fetch from both tables concurrently
  const [comparisonRows, productRows] = await Promise.all([
    client.query(comparisonQuery, [limit]),
    client.query(productQuery, [limit]),
  ]);

  const urls = [];

  // Add comparison pages as /compare/{slug}
  for (const row of comparisonRows.rows) {
    urls.push({
      url: `https://buywhere.ai/compare/${row.slug}`,
      type: "comparison",
      updated_at: row.updated_at,
    });
  }

  // Add products as BuyWhere PDPs /p/{id} (the products.url column stores the
  // merchant source URL — that's where the data came from, not where the page lives).
  for (const row of productRows.rows) {
    urls.push({
      url: `https://buywhere.ai/p/${row.id}`,
      type: "product",
      updated_at: row.updated_at,
    });
  }

  // Sort by updated_at descending and cap
  urls.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return urls.slice(0, limit);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateArg = args.find((arg) => !arg.startsWith("--") && !arg.startsWith("-")) ?? utcDateString();

  const maxUrls = parseInt(process.env.MAX_QUEUE_URLS ?? "500", 10);
  const lookbackHours = parseInt(process.env.LOOKBACK_HOURS ?? "168", 10);

  console.log(`Generating GSC indexing queue for ${dateArg}`);
  console.log(`Max URLs: ${maxUrls}, Lookback: ${lookbackHours}h`);

  const dbUrl = await getDatabaseUrl();
  const { Client } = pg;
  const client = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 30000,
  });

  try {
    await client.connect();
    console.log("Connected to database");

    const urls = await fetchUrlsToIndex(client, lookbackHours, maxUrls);
    console.log(`Found ${urls.length} URLs to index`);

    if (dryRun) {
      console.log("\n--- DRY RUN: URLs that would be queued ---");
      for (const u of urls.slice(0, 20)) {
        console.log(`${u.type}: ${u.url}`);
      }
      if (urls.length > 20) console.log(`... and ${urls.length - 20} more`);
      return;
    }

    // Write queue file
    const queuePath = path.join(REPO_ROOT, "content", "audits", `midnight-indexing-queue-${dateArg}.json`);
    const queueDir = path.dirname(queuePath);
    await fs.mkdir(queueDir, { recursive: true });

    const queueData = {
      generated_at: new Date().toISOString(),
      lookback_hours: lookbackHours,
      max_urls: maxUrls,
      urls: urls.map((u) => u.url),
    };

    await fs.writeFile(queuePath, JSON.stringify(queueData, null, 2));
    console.log(`Queue written to: ${queuePath}`);
    console.log(`Total URLs: ${urls.length}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
