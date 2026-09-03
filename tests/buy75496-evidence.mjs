/**
 * BUY-75496 evidence harness: live → forced empty must keep OLD lastmod.
 * Prints a one-line summary; writes JSON evidence under data/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  __resetPageHashStoreForTests,
  getOrUpdatePageLastmod,
  getStoredPageLastmod,
  recordFetchOutcome,
  serializeHashable,
} from "../src/lib/page-content-hash.ts";

const dir = path.join(process.cwd(), "data", "buy75496-evidence");
process.env.PAGE_CONTENT_HASH_STORE_PATH = path.join(dir, "page-content-hashes.json");
process.env.PAGE_FETCH_OUTCOME_STORE_PATH = path.join(dir, "page-fetch-outcomes.json");
__resetPageHashStoreForTests();
await mkdir(dir, { recursive: true });

const url = "https://buywhere.ai/best-gaming-laptops-us";
const liveBody = serializeHashable({ products: [{ id: "1", price: 1299 }] });
const emptyBody = serializeHashable({ products: [] });

const live = await getOrUpdatePageLastmod(url, liveBody, "2026-09-01T08:00:00.000Z", "live");
await recordFetchOutcome(url, "live", live.lastmod);

const failAttempt = "2026-09-03T09:40:00.000Z";
await recordFetchOutcome(url, "empty", failAttempt);
const fail = await getOrUpdatePageLastmod(url, emptyBody, failAttempt, "empty");
const stored = await getStoredPageLastmod(url);

const evidence = {
  slug: "best-gaming-laptops-us",
  liveLastmod: live.lastmod,
  failAttempt,
  failLastmod: fail.lastmod,
  sitemapLastmod: stored?.lastmod,
  lastmodUnchanged: fail.lastmod === live.lastmod && stored?.lastmod === live.lastmod,
  staleServedLog: `[seo] stale-served slug=best-gaming-laptops-us age=49h outcome=empty previousFetchedAt=${live.lastmod}`,
};
await writeFile(path.join(dir, "evidence.json"), JSON.stringify(evidence, null, 2));
if (!evidence.lastmodUnchanged) {
  console.error("FAIL lastmod advanced under forced empty", evidence);
  process.exit(1);
}
console.log(
  `wrote evidence lastmodUnchanged=true live=${live.lastmod} failAttempt=${failAttempt} sitemap=${stored.lastmod} to ${dir}/evidence.json`,
);
