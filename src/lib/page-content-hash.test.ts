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
  getStoredPageLastmod,
  serializeHashable,
} from "@/lib/page-content-hash";

async function withStore<T>(fn: (storePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "buywhere-page-hash-"));
  const storePath = path.join(dir, "page-content-hashes.json");
  const prev = process.env.PAGE_CONTENT_HASH_STORE_PATH;
  process.env.PAGE_CONTENT_HASH_STORE_PATH = storePath;
  __resetPageHashStoreForTests();
  try {
    return await fn(storePath);
  } finally {
    __resetPageHashStoreForTests();
    if (prev === undefined) {
      delete process.env.PAGE_CONTENT_HASH_STORE_PATH;
    } else {
      process.env.PAGE_CONTENT_HASH_STORE_PATH = prev;
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

test("formatCheckedStamp clamps future lastmod to now (BUY-79844 R2)", () => {
  const formatted = formatCheckedStamp({
    hash: "abc",
    lastmod: "2099-12-31T00:00:00.000Z",
    changed: false,
  });
  assert.ok(Date.parse(formatted.iso) <= Date.now());
  assert.doesNotMatch(formatted.text, /December 31, 2099/);
});

test("getOrUpdatePageLastmod ignores 2026-06-29 placeholder seed (BUY-79844)", async () => {
  await withStore(async () => {
    const url = "https://buywhere.ai/air-purifier-singapore";
    const stamp = await getOrUpdatePageLastmod(
      url,
      serializeHashable({ body: "live" }),
      "2026-06-29T00:00:00.000Z",
    );
    assert.notEqual(stamp.lastmod.slice(0, 10), "2026-06-29");
    assert.ok(Date.parse(stamp.lastmod) <= Date.now());
  });
});

test("getOrUpdatePageLastmod rewrites frozen placeholder lastmod even when hash matches", async () => {
  await withStore(async (storePath) => {
    const url = "https://buywhere.ai/air-purifier-singapore";
    const body = serializeHashable({ body: "frozen" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      storePath,
      JSON.stringify({
        [url]: { hash: computeCanonicalHash(body), lastmod: "2026-06-29T00:00:00.000Z" },
      }),
    );
    __resetPageHashStoreForTests();
    const stamp = await getOrUpdatePageLastmod(url, body, "2026-06-29T00:00:00.000Z");
    assert.notEqual(stamp.lastmod.slice(0, 10), "2026-06-29");
  });
});
