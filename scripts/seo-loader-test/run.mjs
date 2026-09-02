import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Inline copy of the loader for stand-alone testing without the @/ alias.
import { readdirSync, readFileSync } from "node:fs";

const REQUIRED_STRING_KEYS = [
  "slug", "title", "description", "heroEyebrow", "heroTitle", "heroBody",
  "canonicalPath", "country", "currency", "locale", "searchQuery",
  "productSectionTitle", "comparisonSectionTitle", "highlightSectionTitle",
  "adviceSectionTitle", "faqSectionTitle",
];
const REQUIRED_ARRAY_KEYS = ["comparisonColumns", "comparisonRows", "highlights", "advicePoints", "faqs", "fallbackProducts"];
const META_KEYS = new Set(["owner", "reviewer", "queueRow"]);
const ALLOWED_COUNTRIES = new Set(["US", "SG"]);

function isObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function stripMetaKeys(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (!META_KEYS.has(k)) out[k] = v;
  return out;
}
function validate(raw, filePath) {
  if (!isObject(raw)) throw new Error(`${filePath}: not object`);
  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) throw new Error(`${filePath}: missing ${key}`);
  }
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) throw new Error(`${filePath}: missing array ${key}`);
  }
  if (!ALLOWED_COUNTRIES.has(raw.country)) throw new Error(`${filePath}: country ${raw.country} not supported`);
  if (raw.canonicalPath !== `/${raw.slug}`) throw new Error(`${filePath}: canonicalPath mismatch`);
  return stripMetaKeys(raw);
}

function load(contentDir) {
  const out = {};
  let entries;
  try { entries = readdirSync(contentDir).filter(f => f.endsWith(".json")); }
  catch (err) { if (err.code === "ENOENT") return out; throw err; }
  for (const file of entries.sort()) {
    const p = path.join(contentDir, file);
    const cfg = validate(JSON.parse(readFileSync(p, "utf8")), file);
    if (out[cfg.slug]) throw new Error(`duplicate ${cfg.slug}`);
    out[cfg.slug] = cfg;
  }
  return out;
}

function base(slug) {
  return {
    slug, title: "T", description: "D", heroEyebrow: "E", heroTitle: "H", heroBody: "B",
    canonicalPath: `/${slug}`, country: "US", currency: "USD", locale: "en_US", searchQuery: "Q",
    productSectionTitle: "P", comparisonSectionTitle: "C", comparisonColumns: ["X"], comparisonRows: [],
    highlightSectionTitle: "Hi", highlights: [{ title: "t", body: "b" }],
    adviceSectionTitle: "A", advicePoints: ["p"], faqSectionTitle: "F",
    faqs: [{ question: "q", answer: "a" }], fallbackProducts: [],
  };
}

test("accepts US/SG", () => {
  validate({ ...base("foo-us"), country: "US", currency: "USD", locale: "en_US", canonicalPath: "/foo-us" }, "x.json");
  validate({ ...base("foo-sg"), country: "SG", currency: "SGD", locale: "en_SG", canonicalPath: "/foo-sg" }, "x.json");
});

test("rejects MY/AU/UK", () => {
  assert.throws(() => validate({ ...base("foo-my"), country: "MY", currency: "MYR", locale: "en_MY" }, "x.json"), /not supported/);
  assert.throws(() => validate({ ...base("foo-au"), country: "AU", currency: "AUD", locale: "en_AU" }, "x.json"), /not supported/);
  assert.throws(() => validate({ ...base("foo-uk"), country: "UK", currency: "GBP", locale: "en_GB" }, "x.json"), /not supported/);
});

test("strips meta keys", () => {
  const out = validate({ ...base("a-us"), owner: "Wave", reviewer: "Fetch", queueRow: 5 }, "x.json");
  assert.equal(out.owner, undefined);
  assert.equal(out.reviewer, undefined);
  assert.equal(out.queueRow, undefined);
});

test("loads fixtures from disk", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ip-"));
  writeFileSync(path.join(dir, "a.json"), JSON.stringify({ ...base("page-a-us"), country: "US", currency: "USD", locale: "en_US", canonicalPath: "/page-a-us" }));
  writeFileSync(path.join(dir, "b.json"), JSON.stringify({ ...base("page-b-sg"), country: "SG", currency: "SGD", locale: "en_SG", canonicalPath: "/page-b-sg" }));
  const out = load(dir);
  assert.deepEqual(Object.keys(out).sort(), ["page-a-us", "page-b-sg"]);
  rmSync(dir, { recursive: true, force: true });
});

test("returns empty when dir missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ip-"));
  const out = load(path.join(dir, "nope"));
  assert.deepEqual(out, {});
  rmSync(dir, { recursive: true, force: true });
});
