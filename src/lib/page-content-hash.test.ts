import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  __resetPageHashStoreForTests,
  computeCanonicalHash,
  formatCheckedStamp,
  getOrUpdatePageLastmod,
  getStoredFetchOutcome,
  getStoredPageLastmod,
  recordFetchOutcome,
  serializeHashable,
} from "@/lib/page-content-hash";

async function withStore<T>(fn: (storePath: string, outcomePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "buywhere-page-hash-"));
  const storePath = path.join(dir, "page-content-hashes.json");
  const outcomePath = path.join(dir, "page-fetch-outcomes.json");
  const prev = process.env.PAGE_CONTENT_HASH_STORE_PATH;
  const prevOutcome = process.env.PAGE_FETCH_OUTCOME_STORE_PATH;
  process.env.PAGE_CONTENT_HASH_STORE_PATH = storePath;
  process.env.PAGE_FETCH_OUTCOME_STORE_PATH = outcomePath;
  __resetPageHashStoreForTests();
  try {
    return await fn(storePath, outcomePath);
  } finally {
    __resetPageHashStoreForTests();
    if (prev === undefined) {
      delete process.env.PAGE_CONTENT_HASH_STORE_PATH;
    } else {
      process.env.PAGE_CONTENT_HASH_STORE_PATH = prev;
    }
    if (prevOutcome === undefined) {
      delete process.env.PAGE_FETCH_OUTCOME_STORE_PATH;
    } else {
      process.env.PAGE_FETCH_OUTCOME_STORE_PATH = prevOutcome;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("computeCanonicalHash is stable for identical content", () => {
  const body = serializeHashable({ title: "A", products: [{ id: "1", price: 10 }] });
  assert.equal(computeCanonicalHash(body), computeCanonicalHash(body));
  assert.notEqual(computeCanonicalHash(body), computeCanonicalHash(`${body}!`));
});

test("getStoredPageLastmod is ENOENT-safe", async () => {
  await withStore(async () => {
    assert.equal(await getStoredPageLastmod("https://buywhere.ai/blog/x"), null);
  });
});

test("getOrUpdatePageLastmod persists and reuses lastmod while hash is unchanged", async () => {
  await withStore(async (storePath) => {
    const url = "https://buywhere.ai/blog/hash-stable";
    const first = await getOrUpdatePageLastmod(url, serializeHashable({ body: "same" }));
    const second = await getOrUpdatePageLastmod(url, serializeHashable({ body: "same" }));
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.lastmod, first.lastmod);

    const stored = JSON.parse(await readFile(storePath, "utf8")) as Record<string, { hash: string; lastmod: string }>;
    assert.equal(stored[url].lastmod, first.lastmod);
    assert.equal(stored[url].hash, first.hash);
  });
});

test("getOrUpdatePageLastmod moves lastmod when hash changes", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/compare/hash-change";
    const first = await getOrUpdatePageLastmod(url, serializeHashable({ body: "old" }));
    const second = await getOrUpdatePageLastmod(url, serializeHashable({ body: "new" }));
    assert.equal(first.changed, true);
    assert.equal(second.changed, true);
    assert.notEqual(second.hash, first.hash);
  });
});

test("formatCheckedStamp mirrors ISO and UTC visible text", () => {
  const formatted = formatCheckedStamp({
    hash: "abc",
    lastmod: "2026-08-25T16:37:27.926Z",
    changed: false,
  });
  assert.equal(formatted.iso, "2026-08-25T16:37:27.926Z");
  assert.equal(formatted.text, "August 25, 2026");
});

test("getOrUpdatePageLastmod falls back to caller-supplied date when persist fails", async () => {
  // Point the store at a path we cannot write to so persistStore throws.
  const readonlyPath = "/proc/version";
  const prev = process.env.PAGE_CONTENT_HASH_STORE_PATH;
  process.env.PAGE_CONTENT_HASH_STORE_PATH = readonlyPath;
  __resetPageHashStoreForTests();
  try {
    const fallback = "2026-06-19T00:00:00.000Z";
    const stamp = await getOrUpdatePageLastmod(
      "https://buywhere.ai/blog/fallback-test",
      serializeHashable({ body: "anything" }),
      fallback,
    );
    assert.equal(stamp.lastmod, fallback);
  } finally {
    __resetPageHashStoreForTests();
    if (prev === undefined) {
      delete process.env.PAGE_CONTENT_HASH_STORE_PATH;
    } else {
      process.env.PAGE_CONTENT_HASH_STORE_PATH = prev;
    }
  }
});

test("recordFetchOutcome only advances lastSuccessfulFetchedAt on live", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/best-gaming-laptops-us";
    const liveAt = "2026-09-01T08:00:00.000Z";
    const failAt = "2026-09-03T08:00:00.000Z";
    const live = await recordFetchOutcome(url, "live", liveAt);
    assert.equal(live.lastSuccessfulFetchedAt, liveAt);
    const empty = await recordFetchOutcome(url, "empty", failAt);
    assert.equal(empty.lastSuccessfulFetchedAt, liveAt);
    assert.equal(empty.lastAttemptedAt, failAt);
    assert.equal(empty.lastOutcome, "empty");
    const stored = await getStoredFetchOutcome(url);
    assert.equal(stored?.lastSuccessfulFetchedAt, liveAt);
  });
});

test("first-ever non-live does not seed lastSuccessfulFetchedAt", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/never-live";
    const rec = await recordFetchOutcome(url, "degraded", "2026-09-03T09:00:00.000Z");
    assert.equal(rec.lastSuccessfulFetchedAt, undefined);
  });
});

test("getOrUpdatePageLastmod pins stamp on empty after live (BUY-75496)", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/best-oled-tvs-us";
    const liveBody = serializeHashable({ products: [{ id: "1", price: 999 }] });
    const emptyBody = serializeHashable({ products: [] });
    const live = await getOrUpdatePageLastmod(url, liveBody, "2026-09-01T00:00:00.000Z", "live");
    await recordFetchOutcome(url, "live", live.lastmod);
    const failStamp = await getOrUpdatePageLastmod(
      url,
      emptyBody,
      "2026-09-03T12:00:00.000Z",
      "empty",
    );
    assert.equal(failStamp.lastmod, live.lastmod);
    assert.notEqual(failStamp.lastmod, "2026-09-03T12:00:00.000Z");
    const stored = await getStoredPageLastmod(url);
    assert.equal(stored?.lastmod, live.lastmod);
  });
});

test("first-ever failure uses fallbackLastmod, never now", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/first-fail";
    const authored = "2026-06-29T00:00:00.000Z";
    const stamp = await getOrUpdatePageLastmod(
      url,
      serializeHashable({ products: [] }),
      authored,
      "degraded",
    );
    assert.equal(stamp.lastmod, authored);
    assert.ok(!stamp.lastmod.startsWith("2026-09-03"));
  });
});

test("degraded after live does not advance sitemap lastmod", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/cheapest-iphone-17-us";
    const liveBody = serializeHashable({ products: [{ id: "a" }] });
    const live = await getOrUpdatePageLastmod(url, liveBody, undefined, "live");
    await recordFetchOutcome(url, "live", live.lastmod);
    const later = await getOrUpdatePageLastmod(
      url,
      serializeHashable({ products: [{ id: "fallback" }] }),
      new Date().toISOString(),
      "degraded",
    );
    assert.equal(later.lastmod, live.lastmod);
  });
});
