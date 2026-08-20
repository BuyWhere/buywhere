#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const DEFAULT_LIMIT = 200;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const INDEXING_API_SCOPE_ERROR = `Google Indexing API push disabled for BUY-66696.

Google's Indexing API only records URL notifications for pages with JobPosting
or BroadcastEvent-in-VideoObject structured data. BuyWhere's comparison,
developer, blog, and product pages do not carry either eligible schema, so the
former daily routine returned HTTP 200 while urlNotifications/metadata stayed
404 and no notifyTime was recorded.

Use sitemap freshness, accurate lastmod, internal links, and 410s for general
BuyWhere pages. If BuyWhere later ships genuinely eligible JobPosting or
BroadcastEvent pages, set GSC_INDEXING_API_ALLOW_ELIGIBLE=1 and submit only
those eligible URLs.`;

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(privateKey) {
  return privateKey.replace(/\\n/g, "\n");
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];

  for (const rawUrl of urls) {
    if (typeof rawUrl !== "string") continue;
    const url = rawUrl.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }

  return result;
}

function extractUrls(queue) {
  if (Array.isArray(queue)) return uniqueUrls(queue);

  const candidates = [queue.urls, queue.queue, queue.items, queue.entries].find(Array.isArray);
  if (!candidates) return [];

  return uniqueUrls(
    candidates.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return item.url ?? item.loc ?? item.href;
      return undefined;
    }),
  );
}

async function readJson(filePath) {
  const body = await fs.readFile(filePath, "utf8");
  return JSON.parse(body);
}

async function readQueue(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readServiceAccount() {
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return readJson(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  throw new Error(
    "Missing service account credentials. Set GSC_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS.",
  );
}

function createJwt(serviceAccount) {
  const clientEmail = serviceAccount.client_email;
  const privateKey = serviceAccount.private_key && normalizePrivateKey(serviceAccount.private_key);

  if (!clientEmail || !privateKey) {
    throw new Error("Service account JSON must include client_email and private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: INDEXING_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsignedJwt).sign(privateKey);

  return `${unsignedJwt}.${base64url(signature)}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = typeof body === "string" ? body : JSON.stringify(body);
    const error = new Error(`HTTP ${response.status}: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function getAccessToken(serviceAccount) {
  const assertion = createJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const token = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!token?.access_token) {
    throw new Error("Google token response did not include access_token.");
  }

  return token.access_token;
}

async function publishUrl(url, accessToken) {
  return fetchJson(PUBLISH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, type: "URL_UPDATED" }),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const date = args.find((arg) => !arg.startsWith("--")) ?? utcDateString();
  const limit = Number.parseInt(process.env.GSC_INDEXING_DAILY_LIMIT ?? `${DEFAULT_LIMIT}`, 10);
  const dryRun = process.env.GSC_DRY_RUN === "1" || args.includes("--dry-run");
  const queuePath = path.join(REPO_ROOT, "content", "audits", `midnight-indexing-queue-${date}.json`);
  const queue = await readQueue(queuePath);
  const urls = queue ? extractUrls(queue).slice(0, limit) : [];

  console.log(`GSC midnight push date: ${date}`);
  console.log(`Queue file: ${queuePath}`);
  if (!queue) {
    console.log("Queue file not found; treating this date as no-op.");
  }
  console.log(`URLs selected: ${urls.length}`);

  if (urls.length === 0) {
    console.log("No URLs to submit.");
    return;
  }

  if (process.env.GSC_INDEXING_API_ALLOW_ELIGIBLE !== "1") {
    console.error(INDEXING_API_SCOPE_ERROR);
    process.exitCode = 2;
    return;
  }

  if (dryRun) {
    for (const url of urls) console.log(`DRY RUN ${url}`);
    return;
  }

  const serviceAccount = await readServiceAccount();
  const accessToken = await getAccessToken(serviceAccount);
  let submitted = 0;

  for (const url of urls) {
    try {
      await publishUrl(url, accessToken);
      submitted += 1;
      console.log(`OK ${url}`);
    } catch (error) {
      if (error.status === 429) {
        console.error(`QUOTA_EXHAUSTED after ${submitted} submissions. Retry at next quota reset.`);
      }
      throw error;
    }
  }

  console.log(`Submitted ${submitted}/${urls.length} URLs to GSC Indexing API.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
