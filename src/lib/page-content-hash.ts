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

/** BUY-75496: catalog fetch classification used to pin lastmod on failure. */
export type FetchOutcomeKind = "live" | "degraded" | "fallback" | "empty";

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
  outcome?: FetchOutcomeKind,
): Promise<PageStamp> {
  if (outcome && outcome !== "live") {
    return getOrUpdatePageLastmodWithOutcome(
      canonicalPath,
      normalizedBody,
      fallbackLastmod,
      outcome,
    );
  }
  const map = await loadStore();
  const hash = computeCanonicalHash(normalizedBody);
  const existing = map.get(canonicalPath);
  if (existing && existing.hash === hash) {
    return { hash, lastmod: existing.lastmod, changed: false };
  }

  // Serialize the write so two concurrent calls don't both observe "changed"
  // and double-write. If another writer is in progress, wait for it, then
  // re-check the store; only write when the hash still differs.
  if (writeInflight) {
    await writeInflight;
    const afterWait = readStoreFromDisk();
    const current = afterWait.get(canonicalPath);
    cachedStore = { map: afterWait, fetchedAt: Date.now() };
    if (current && current.hash === hash) {
      return { hash, lastmod: current.lastmod, changed: false };
    }
  }

  let wrote = false;
  writeInflight = (async () => {
    const fresh = readStoreFromDisk();
    const current = fresh.get(canonicalPath);
    if (current && current.hash === hash) {
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
    const next = { hash, lastmod: fallbackLastmod ?? new Date().toISOString() };
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
      return current ?? { hash, lastmod: fallbackLastmod ?? next.lastmod };
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
export function formatCheckedStamp(stamp: PageStamp): { iso: string; text: string } {
  const date = new Date(stamp.lastmod);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date().toISOString();
    return { iso: fallback, text: fallback.slice(0, 10) };
  }
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
  cachedOutcomeStore = null;
  outcomeLoadInflight = null;
  outcomeWriteInflight = null;
}

/**
 * BUY-75496 — honest freshness under failure.
 *
 * Hash-driven lastmod (BUY-74905) still advances whenever the body hash
 * changes. That is the WRONG stamp on a failed revalidate: ISR keeps the
 * previous HTML (correct) but a hash of the empty/fallback snapshot would
 * move "Prices checked" and sitemap <lastmod> to "now".
 *
 * This store records the LAST SUCCESSFUL catalog fetch per canonical URL.
 * Only `outcome === "live"` advances `lastSuccessfulFetchedAt`. Non-live
 * renders pin the stamp to that ISO (or to the caller's fallbackLastmod
 * when there is no prior live fetch — never `new Date()`).
 */
export interface PageFetchOutcomeRecord {
  lastAttemptedAt: string;
  lastOutcome: FetchOutcomeKind;
  lastSuccessfulFetchedAt?: string;
  lastLiveFetchedAt?: string;
}

function outcomeStorePath(): string {
  return (
    process.env.PAGE_FETCH_OUTCOME_STORE_PATH ||
    path.join(process.cwd(), "content", "audits", "page-fetch-outcomes.json")
  );
}

let cachedOutcomeStore: { map: Map<string, PageFetchOutcomeRecord>; fetchedAt: number } | null = null;
let outcomeLoadInflight: Promise<void> | null = null;
let outcomeWriteInflight: Promise<PageFetchOutcomeRecord> | null = null;

function readOutcomeStoreFromDisk(): Map<string, PageFetchOutcomeRecord> {
  try {
    const filePath = outcomeStorePath();
    if (!existsSync(filePath)) return new Map();
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return new Map();
    const map = new Map<string, PageFetchOutcomeRecord>();
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const rec = value as {
        lastAttemptedAt?: unknown;
        lastOutcome?: unknown;
        lastSuccessfulFetchedAt?: unknown;
        lastLiveFetchedAt?: unknown;
      };
      if (typeof rec.lastAttemptedAt !== "string") continue;
      if (rec.lastOutcome !== "live" && rec.lastOutcome !== "degraded" && rec.lastOutcome !== "fallback" && rec.lastOutcome !== "empty") {
        continue;
      }
      const next: PageFetchOutcomeRecord = {
        lastAttemptedAt: rec.lastAttemptedAt,
        lastOutcome: rec.lastOutcome,
      };
      if (typeof rec.lastSuccessfulFetchedAt === "string") next.lastSuccessfulFetchedAt = rec.lastSuccessfulFetchedAt;
      if (typeof rec.lastLiveFetchedAt === "string") next.lastLiveFetchedAt = rec.lastLiveFetchedAt;
      map.set(key, next);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadOutcomeStore(): Promise<Map<string, PageFetchOutcomeRecord>> {
  const now = Date.now();
  if (cachedOutcomeStore && now - cachedOutcomeStore.fetchedAt < TTL_MS) {
    return cachedOutcomeStore.map;
  }
  if (outcomeLoadInflight) {
    await outcomeLoadInflight;
    return cachedOutcomeStore?.map ?? new Map();
  }
  outcomeLoadInflight = (async () => {
    const map = readOutcomeStoreFromDisk();
    cachedOutcomeStore = { map, fetchedAt: Date.now() };
  })().finally(() => {
    outcomeLoadInflight = null;
  });
  await outcomeLoadInflight;
  return cachedOutcomeStore?.map ?? new Map();
}

async function persistOutcomeStore(map: Map<string, PageFetchOutcomeRecord>): Promise<void> {
  const obj: Record<string, PageFetchOutcomeRecord> = {};
  map.forEach((v, k) => {
    obj[k] = v;
  });
  const serialized = JSON.stringify(obj, null, 2);
  const filePath = outcomeStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, serialized, "utf8");
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function getStoredFetchOutcome(
  canonicalPath: string,
): Promise<PageFetchOutcomeRecord | null> {
  const map = await loadOutcomeStore();
  return map.get(canonicalPath) ?? null;
}

/**
 * Persist a fetch attempt. Only `live` advances lastSuccessfulFetchedAt.
 * First-ever non-live leaves lastSuccessfulFetchedAt undefined so the
 * freshness chain falls through to fallbackLastmod, never `new Date()`.
 */
export async function recordFetchOutcome(
  canonicalPath: string,
  outcome: FetchOutcomeKind,
  attemptedAt: string,
): Promise<PageFetchOutcomeRecord> {
  if (outcomeWriteInflight) {
    await outcomeWriteInflight;
  }

  outcomeWriteInflight = (async () => {
    const fresh = readOutcomeStoreFromDisk();
    const prev = fresh.get(canonicalPath);
    const next: PageFetchOutcomeRecord = {
      lastAttemptedAt: attemptedAt,
      lastOutcome: outcome,
      lastSuccessfulFetchedAt: prev?.lastSuccessfulFetchedAt,
      lastLiveFetchedAt: prev?.lastLiveFetchedAt,
    };
    if (outcome === "live") {
      next.lastSuccessfulFetchedAt = attemptedAt;
      next.lastLiveFetchedAt = attemptedAt;
    }
    fresh.set(canonicalPath, next);
    try {
      await persistOutcomeStore(fresh);
      cachedOutcomeStore = { map: fresh, fetchedAt: Date.now() };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[page-fetch-outcome] failed to persist ${canonicalPath}: ${(err as Error)?.message ?? err}`,
      );
      cachedOutcomeStore = { map: fresh, fetchedAt: Date.now() };
    }
    return next;
  })().finally(() => {
    outcomeWriteInflight = null;
  });

  return outcomeWriteInflight;
}

/**
 * Hash-driven lastmod with a failure-bound pin. On `live` (or omitted
 * outcome, preserving BUY-74905 callers) the stamp advances with the
 * body hash. On non-live it returns lastSuccessfulFetchedAt, or
 * fallbackLastmod when no prior live fetch exists.
 */
export async function getOrUpdatePageLastmodWithOutcome(
  canonicalPath: string,
  normalizedBody: string,
  fallbackLastmod: string | undefined,
  outcome: FetchOutcomeKind | undefined,
): Promise<PageStamp> {
  if (!outcome || outcome === "live") {
    return getOrUpdatePageLastmod(canonicalPath, normalizedBody, fallbackLastmod);
  }

  const recorded = await getStoredFetchOutcome(canonicalPath);
  const pinned = recorded?.lastSuccessfulFetchedAt ?? fallbackLastmod;
  if (!pinned) {
    // First-ever failure with no authored stamp: still refuse `new Date()`.
    // Keep hash store untouched so a later live fetch can write honestly.
    return {
      hash: computeCanonicalHash(normalizedBody),
      lastmod: "1970-01-01T00:00:00.000Z",
      changed: false,
    };
  }

  // Pin the hash-store lastmod to the last successful fetch so sitemap
  // readers (`getStoredPageLastmod`) see the same ISO as the on-page date.
  // Do NOT let a fallback/empty body hash rewrite lastmod to "now".
  const map = await loadStore();
  const existing = map.get(canonicalPath);
  if (existing && existing.lastmod === pinned) {
    return { hash: existing.hash, lastmod: existing.lastmod, changed: false };
  }

  const hash = existing?.hash ?? computeCanonicalHash(normalizedBody);
  const next: PageHashRecord = { hash, lastmod: pinned };
  if (writeInflight) await writeInflight;
  writeInflight = (async () => {
    const fresh = readStoreFromDisk();
    fresh.set(canonicalPath, next);
    try {
      await persistStore(fresh);
      cachedStore = { map: fresh, fetchedAt: Date.now() };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[page-content-hash] failed to pin lastmod ${canonicalPath}: ${(err as Error)?.message ?? err}`,
      );
    }
    return next;
  })().finally(() => {
    writeInflight = null;
  });
  const written = await writeInflight;
  return { hash: written.hash, lastmod: written.lastmod, changed: false };
}