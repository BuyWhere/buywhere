/**
 * Intent-page JSON loader (BUY-74862, Day 1).
 *
 * Reads `content/intent-pages/*.json` at module-init time (i.e. build time —
 * Next.js executes server-side module top-level code during `next build`) and
 * returns a `slug -> SeoLandingPageConfig` map that callers can merge with the
 * in-repo TS `seoLandingPages` registry.
 *
 * Why a separate module: keeps the loader focused on I/O + validation, so the
 * main `seo-landing-pages.ts` stays free of build-time filesystem access (which
 * would otherwise pull `node:fs` into the client bundle boundary).
 *
 * Meta keys (writer/editorial bookkeeping):
 *   - `owner`:    who writes/owns the page in /home/paperclip/ops-canon/PRIORITY-PAGES.csv
 *   - `reviewer`: QA reviewer (Hue/Fetch)
 *   - `queueRow`: PRIORITY-PAGES.csv row number
 * These are stripped before the config is returned.
 *
 * Country gate (program scope):
 *   Only US and SG pages may be added today. The /home/paperclip/ops-canon/PRIORITY-PAGES.csv
 *   marks every MY/AU/UK row `blocked:country-support` until Day 2 ships locale +
 *   merchant-allowlist coverage. We hard-fail (throw) on a non-US/SG config so
 *   a writer who accidentally commits one is rejected at build time instead of
 *   shipping silently to production. (BUY-74862)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SeoLandingPageConfig } from "@/lib/seo-landing-pages";

// Fields SeoLandingPageConfig marks as required strings. We mirror those here
// so a missing field fails at build time with a precise file path, not a
// generic type error.
const REQUIRED_STRING_KEYS: ReadonlyArray<string> = [
  "slug",
  "title",
  "description",
  "heroEyebrow",
  "heroTitle",
  "heroBody",
  "canonicalPath",
  "country",
  "currency",
  "locale",
  "searchQuery",
  "productSectionTitle",
  "comparisonSectionTitle",
  "highlightSectionTitle",
  "adviceSectionTitle",
  "faqSectionTitle",
];

// Fields SeoLandingPageConfig marks as required arrays.
const REQUIRED_ARRAY_KEYS: ReadonlyArray<string> = [
  "comparisonColumns",
  "comparisonRows",
  "highlights",
  "advicePoints",
  "faqs",
  "fallbackProducts",
];

const META_KEYS = new Set(["owner", "reviewer", "queueRow"]);

const ALLOWED_COUNTRIES = new Set(["US", "SG"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripMetaKeys(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (META_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Validate a single parsed JSON file matches SeoLandingPageConfig enough to
 * be merged into the in-memory registry. Throws on the first violation with
 * the slug + path so writers can locate and fix the offending file.
 */
export function validateIntentPageConfig(
  raw: unknown,
  filePath: string
): SeoLandingPageConfig {
  if (!isObject(raw)) {
    throw new Error(
      `[intent-pages] ${filePath}: top-level value is not an object`
    );
  }

  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
      throw new Error(
        `[intent-pages] ${filePath}: missing required string field "${key}"`
      );
    }
  }

  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) {
      throw new Error(
        `[intent-pages] ${filePath}: missing required array field "${key}"`
      );
    }
  }

  const country = raw.country as string;
  if (!ALLOWED_COUNTRIES.has(country)) {
    throw new Error(
      `[intent-pages] ${filePath}: country "${country}" is not supported today (BUY-74862 Day 1 only ships US + SG)`
    );
  }

  // slug must equal the basename of the canonicalPath (e.g. canonicalPath
  // "/foo-bar" implies slug "foo-bar"). This catches typos early.
  const slug = raw.slug as string;
  const canonicalPath = raw.canonicalPath as string;
  if (canonicalPath !== `/${slug}`) {
    throw new Error(
      `[intent-pages] ${filePath}: canonicalPath "${canonicalPath}" must equal "/${slug}"`
    );
  }

  const stripped = stripMetaKeys(raw);
  // BUY-78914: cheapest-* pages promise the lowest live listing. A writer-set
  // minPrice (e.g. SGD 2500 on cheapest-macbook-pro-singapore) drops refurbished
  // / last-gen machines and leaves the page on fallbackProducts with no /r/ cards.
  if (slug.startsWith("cheapest-")) {
    delete stripped.minPrice;
  }
  return stripped as unknown as SeoLandingPageConfig;
}

/**
 * Load every content/intent-pages/*.json file at module-init time and return
 * a `slug -> SeoLandingPageConfig` map. Throws on the first invalid file so
 * the build fails fast and loudly.
 *
 * Resolves the content directory relative to `process.cwd()` so this works in
 * both `next build` (server bundler) and standalone test runners.
 */
export function loadIntentPageConfigs(
  contentDir = path.join(process.cwd(), "content", "intent-pages")
): Record<string, SeoLandingPageConfig> {
  const out: Record<string, SeoLandingPageConfig> = {};

  let entries: string[];
  try {
    entries = readdirSync(contentDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    // content/intent-pages may not exist yet (Day 1 ships before writers
    // start producing JSON files). Treat "directory missing" as "zero pages".
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return out;
    throw err;
  }

  for (const file of entries.sort()) {
    const fullPath = path.join(contentDir, file);
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
    const config = validateIntentPageConfig(parsed, `content/intent-pages/${file}`);
    if (out[config.slug]) {
      throw new Error(
        `[intent-pages] duplicate slug "${config.slug}" detected across JSON files (last seen in ${file})`
      );
    }
    out[config.slug] = config;
  }

  return out;
}
