/**
 * Page content-hash store — directive §5 (Richmond, 2026-08-25).
 *
 * Single source of truth: `content/audits/page-content-hashes.json` mapping
 * canonical URL → `{ hash, lastmod }`. The hash is a SHA-256 of the page's
 * normalized body content (products + prices + editorial). lastmod only moves
 * when the hash differs from the stored one — i.e. the rendered content
 * actually changed. This is the honest freshness model the indexation
 * directive §5 calls out, and the model Google rewards on price-comparison
 * sites (BUY-74905).
 *
 * Why a file (and not a DB table today): the seo_pages table (BUY-74862 Day 3,
 * Core-owned) does not ship in this PR. The file KV mirrors the same data
 * shape — `{ hash: text, lastmod: timestamptz }` — so the Day-3 writer is a
 * one-line `INSERT … ON CONFLICT DO UPDATE` and the call-site API stays
 * identical. Same pattern as the existing `sitemap-lastmod-override-*.json`
 * reader in src/lib/sitemaps.ts.
 *
 * Server-only: the file lives at `content/audits/…` and is read via
 * `node:fs`. Callers are Next.js server components and sitemap route handlers
 * (force-dynamic). No browser-bundle implications.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PageHashRecord {
  hash: string;
  lastmod: string; // ISO 8601 timestamp captured at the moment the hash changed
}

export interface PageStamp {
  hash: string;
  lastmod: string;
  /** True iff this call observed a hash mismatch and wrote a new entry. */
  changed: boolean;
}

function storePath(): string {
  return (
    process.env.PAGE_CONTENT_HASH_STORE_PATH ||
    path.join(process.cwd(), "content", "audits", "page-content-hashes.json")
  );
}

const TTL_MS = 60 * 60 * 1000; // 1 hour — same cadence as readLatestLastmodOverride.

let cachedStore: { map: Map<string, PageHashRecord>; fetchedAt: number } | null = null;

// Two small mutexes:
// - loadInflight dedupes cache refreshes;
// - writeInflight serializes writes so two cold requests don't trample the KV.
// Same pattern as `merchantInflight` in src/lib/sitemaps.ts, but split so a
// write cannot be mistaken for a load and vice versa.
let loadInflight: Promise<void> | null = null;
let writeInflight: Promise<PageHashRecord> | null = null;

function readStoreFromDisk(): Map<string, PageHashRecord> {
  try {
    const filePath = storePath();
    if (!existsSync(filePath)) return new Map();
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return new Map();
    const map = new Map<string, PageHashRecord>();
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const rec = value as { hash?: unknown; lastmod?: unknown };
      if (typeof rec.hash !== "string" || typeof rec.lastmod !== "string") continue;
      // Normalize key — the canonicalPath we pass in is always absolute URL
      // (e.g. https://buywhere.ai/compare/foo), but older entries may have
      // been written under a path-only key. Keep them both: getStoredPageLastmod
      // accepts both shapes via lookupCanonicalPath.
      map.set(key, { hash: rec.hash, lastmod: rec.lastmod });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadStore(): Promise<Map<string, PageHashRecord>> {
  const now = Date.now();
  if (cachedStore && now - cachedStore.fetchedAt < TTL_MS) {
    return cachedStore.map;
  }
  if (loadInflight) {
    await loadInflight;
    return cachedStore?.map ?? new Map();
  }
  loadInflight = (async () => {
    const map = readStoreFromDisk();
    cachedStore = { map, fetchedAt: Date.now() };
  })().finally(() => {
    loadInflight = null;
  });
  await loadInflight;
  return cachedStore?.map ?? new Map();
}

/** Hash a normalized body to a stable hex digest. */
export function computeCanonicalHash(normalizedBody: string): string {
  return createHash("sha256").update(normalizedBody, "utf8").digest("hex");
}

/**
 * Compose a deterministic JSON-serialized body from the caller's hashable
 * inputs. Object key order matters: the helper sorts the top-level keys so
 * two callers passing the same fields in different orders hash the same.
 */
export function serializeHashable(parts: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(parts).sort()) {
    sorted[key] = parts[key];
  }
  return JSON.stringify(sorted);
}

/** Read-only — never writes. */
export async function getStoredPageLastmod(
  canonicalPath: string,
): Promise<PageHashRecord | null> {
  const map = await loadStore();
  return map.get(canonicalPath) ?? null;
}

/**
 * Compute hash, look up the store, and atomically persist a new entry when
 * the hash differs. Returns the stamp that should appear on the page and
 * in the sitemap `<lastmod>`.
 *
 * Concurrency-safe: a module-scoped mutex serializes writes to the store file
 * (one Railway process per service, but a cold deploy can fire many requests
 * in parallel). Atomic file replace via temp-file + rename keeps the dump
 * crash-safe (BUY-72409 SEV-1 lesson — no half-written files).
 */
export async function getOrUpdatePageLastmod(
  canonicalPath: string,
  normalizedBody: string,
  fallbackLastmod?: string,
): Promise<PageStamp> {
  const map = await loadStore();
  const hash = computeCanonicalHash(normalizedBody);
  const existing = map.get(canonicalPath);
  // BUY-79844: a first write that seeded from 2026-06-29 froze the stamp.
  // Treat placeholder / future lastmods as missing so we re-bind to now.
  if (existing && existing.hash === hash) {
    const lastmod = clampLastmodToNow(existing.lastmod);
    if (!isPlaceholderLastmod(existing.lastmod) && lastmod === existing.lastmod) {
      return { hash, lastmod, changed: false };
    }
  }

  // Serialize the write so two concurrent calls don't both observe "changed"
  // and double-write. If another writer is in progress, wait for it, then
  // re-check the store; only write when the hash still differs.
  if (writeInflight) {
    await writeInflight;
    const afterWait = readStoreFromDisk();
    const current = afterWait.get(canonicalPath);
    cachedStore = { map: afterWait, fetchedAt: Date.now() };
    if (current && current.hash === hash && !isPlaceholderLastmod(current.lastmod)
        && clampLastmodToNow(current.lastmod) === current.lastmod) {
      return { hash, lastmod: current.lastmod, changed: false };
    }
  }

  let wrote = false;
  writeInflight = (async () => {
    const fresh = readStoreFromDisk();
    const current = fresh.get(canonicalPath);
    if (current && current.hash === hash && !isPlaceholderLastmod(current.lastmod)
        && clampLastmodToNow(current.lastmod) === current.lastmod) {
      cachedStore = { map: fresh, fetchedAt: Date.now() };
      return current;
    }
    // When the persistence layer is unavailable (Railway app container runs
    // on a read-only FS, and we don't yet own a DB table for this), the
    // honest move is to bind the stamp to a real source date the caller
    // already knows (post.publishedAt, config.dateModified, etc.). That
    // way the visible stamp and the sitemap <lastmod> agree: both show
    // "this is when the content actually last changed". Date moves only
    // when content changes — the directive's exact contract.
    const seed =
      fallbackLastmod && !isPlaceholderLastmod(fallbackLastmod)
        ? clampLastmodToNow(fallbackLastmod)
        : new Date().toISOString();
    const next = { hash, lastmod: seed };
    fresh.set(canonicalPath, next);
    try {
      await persistStore(fresh);
      cachedStore = { map: fresh, fetchedAt: Date.now() };
      wrote = true;
      return next;
    } catch (err) {
      // Never let the freshness store make a page 500. If the container's FS
      // is read-only, keep rendering and fall back to a real source date when
      // the caller provided one; otherwise use the attempted write timestamp.
      // eslint-disable-next-line no-console
      console.warn(
        `[page-content-hash] failed to persist ${canonicalPath}: ${(err as Error)?.message ?? err}`,
      );
      const fallback =
        fallbackLastmod && !isPlaceholderLastmod(fallbackLastmod)
          ? clampLastmodToNow(fallbackLastmod)
          : next.lastmod;
      return current && !isPlaceholderLastmod(current.lastmod)
        ? { hash: current.hash, lastmod: clampLastmodToNow(current.lastmod) }
        : { hash, lastmod: fallback };
    }
  })().finally(() => {
    writeInflight = null;
  });

  const written = await writeInflight;
  return { hash, lastmod: written.lastmod, changed: wrote };
}

async function persistStore(map: Map<string, PageHashRecord>): Promise<void> {
  const obj: Record<string, PageHashRecord> = {};
  map.forEach((v, k) => {
    obj[k] = v;
  });
  const serialized = JSON.stringify(obj, null, 2);
  const filePath = storePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, serialized, "utf8");
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup if rename fails (e.g. cross-device on some FS).
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Format a stamp for visible display. Returns the canonical human form
 * ("August 25, 2026") of the ISO timestamp; call sites compose this into
 * `Updated <date>` / `Prices checked <date>` text. The ISO itself is also
 * returned so callers can stamp it on `data-ssr-prices-checked` /
 * JSON-LD `dateModified` — directive §5 requires the visible text and the
 * machine date to be the same value.
 */
/** Editorial seed dates that froze first-write lastmod (BUY-79844). */
const PLACEHOLDER_LASTMOD_PREFIXES = ["2026-06-29", "2026-07-25", "2026-06-18"];

export function isPlaceholderLastmod(iso: string | undefined | null): boolean {
  if (!iso) return true;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return true;
  const day = date.toISOString().slice(0, 10);
  return PLACEHOLDER_LASTMOD_PREFIXES.includes(day);
}

/** R2: lastmod must never render in the future (UTC). */
export function clampLastmodToNow(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return now.toISOString();
  return date.getTime() > now.getTime() ? now.toISOString() : date.toISOString();
}

export function formatCheckedStamp(stamp: PageStamp): { iso: string; text: string } {
  const clampedIso = clampLastmodToNow(stamp.lastmod);
  const date = new Date(clampedIso);
  const iso = date.toISOString();
  const text = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return { iso, text };
}

/**
 * Test-only escape hatch: clears the in-memory cache so unit tests can
 * observe on-disk mutations without waiting for the 1h TTL.
 */
export function __resetPageHashStoreForTests(): void {
  cachedStore = null;
  loadInflight = null;
  writeInflight = null;
}