#!/usr/bin/env node
/**
 * Tests for /api/request-key policy: duplicate-email dedup and IP rate limiting.
 * Run with: node tests/request-key-policy.test.js
 *
 * These tests validate the business logic extracted from route.ts
 * without requiring a running Next.js server.
 */

const { randomBytes } = require("crypto");
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require("fs");
const os = require("os");
const path = require("path");

// ── Inline the business logic from route.ts ────────────────────────────────

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;

function makeIpRateLimiter() {
  const map = new Map();
  return function checkIp(ip, nowMs = Date.now()) {
    const entry = map.get(ip);
    if (!entry || nowMs - entry.windowStart > IP_WINDOW_MS) {
      map.set(ip, { count: 1, windowStart: nowMs });
      return true;
    }
    if (entry.count >= IP_LIMIT) return false;
    entry.count++;
    return true;
  };
}

function isApiIssuedKey(key) {
  return /^bw_[a-f0-9]{32}$/i.test(key);
}

function issueApiKeyStub() {
  return "bw_" + randomBytes(16).toString("hex");
}

function makeKeyStore(file) {
  function loadKeys() {
    if (!existsSync(file)) return [];
    try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return []; }
  }
  function findByEmail(email) {
    return loadKeys().slice().reverse().find(
      (r) => r.email.toLowerCase() === email.toLowerCase() && isApiIssuedKey(r.key)
    );
  }
  function saveKey(entry) {
    const keys = loadKeys();
    keys.push(entry);
    writeFileSync(file, JSON.stringify(keys, null, 2));
  }
  return { findByEmail, saveKey, loadKeys };
}

// ── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log("\n=== /api/request-key policy tests ===\n");

// 1. IP rate limiting
console.log("1. IP rate limiting (5/hour per IP)");
{
  const check = makeIpRateLimiter();
  const ip = "1.2.3.4";
  const t0 = Date.now();

  for (let i = 1; i <= 5; i++) {
    assert(check(ip, t0 + i * 100) === true, `request ${i} allowed`);
  }
  assert(check(ip, t0 + 600) === false, "6th request blocked within window");
  // Window started at t0+100 (first hit), so needs t0+100+IP_WINDOW_MS+1 to expire
  assert(check(ip, t0 + 200 + IP_WINDOW_MS) === true, "first request allowed after window resets");
}

// 2. Different IPs are independent
console.log("\n2. Different IPs are independent");
{
  const check = makeIpRateLimiter();
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) check("10.0.0.1", t0 + i);
  assert(check("10.0.0.2", t0 + 100) === true, "different IP is not rate-limited");
}

// 3. Duplicate email returns existing key (Option A — idempotent)
console.log("\n3. Duplicate email returns existing key");
{
  const tmpFile = path.join(os.tmpdir(), `bw-test-${randomBytes(4).toString("hex")}.json`);
  try {
    const store = makeKeyStore(tmpFile);
    const firstKey = issueApiKeyStub();
    store.saveKey({ name: "Alice", email: "alice@example.com", useCase: "test", key: firstKey, created_at: new Date().toISOString(), usage_count: 0 });

    const existing = store.findByEmail("alice@example.com");
    assert(existing !== undefined, "findByEmail returns a record");
    assert(existing.key === firstKey, "same key is returned for the same email");

    // Case-insensitive
    const existingUpper = store.findByEmail("ALICE@EXAMPLE.COM");
    assert(existingUpper !== undefined, "email lookup is case-insensitive");
    assert(existingUpper.key === firstKey, "case-insensitive lookup returns same key");

    // Second save shouldn't happen in real route, but verify only 1 key stored
    const all = store.loadKeys();
    assert(all.length === 1, "only 1 row in store after single registration");
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// 4. New email gets a new key
console.log("\n4. New email gets a new key");
{
  const tmpFile = path.join(os.tmpdir(), `bw-test-${randomBytes(4).toString("hex")}.json`);
  try {
    const store = makeKeyStore(tmpFile);
    const existing = store.findByEmail("new@example.com");
    assert(existing === undefined, "no existing key for new email");

    const newKey = issueApiKeyStub();
    store.saveKey({ name: "Bob", email: "new@example.com", useCase: "", key: newKey, created_at: new Date().toISOString(), usage_count: 0 });
    const found = store.findByEmail("new@example.com");
    assert(found !== undefined && found.key === newKey, "newly saved key is retrievable");
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// 5. Key format
console.log("\n5. Key format");
{
  const key = issueApiKeyStub();
  assert(isApiIssuedKey(key), "key has API-issued bw_<32 hex> format");
  assert(!isApiIssuedKey("bw_beta_" + randomBytes(20).toString("hex")), "legacy bw_beta keys are rejected");
}

// 6. Legacy cache entries are ignored
console.log("\n6. Legacy cache entries are ignored");
{
  const tmpFile = path.join(os.tmpdir(), `bw-test-${randomBytes(4).toString("hex")}.json`);
  try {
    const store = makeKeyStore(tmpFile);
    const legacyKey = "bw_beta_" + randomBytes(20).toString("hex");
    const apiIssuedKey = issueApiKeyStub();
    store.saveKey({ name: "Carol", email: "carol@example.com", useCase: "legacy", key: legacyKey, created_at: new Date().toISOString(), usage_count: 0 });

    assert(store.findByEmail("carol@example.com") === undefined, "legacy bw_beta cache row is not reused");

    store.saveKey({ name: "Carol", email: "carol@example.com", useCase: "api", key: apiIssuedKey, created_at: new Date().toISOString(), usage_count: 0 });
    assert(store.findByEmail("carol@example.com").key === apiIssuedKey, "API-issued key is reused after legacy row");
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
