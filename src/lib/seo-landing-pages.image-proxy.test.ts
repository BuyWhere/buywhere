// BUY-70187: regression test — hotlink-blocked host images must render
// through /api/image-proxy instead of falling to the branded SVG placeholder,
// and the proxy route must allowlist ONLY the blocked hosts.
import assert from "node:assert/strict";
import test from "node:test";
import { HOTLINK_BLOCKED_HOSTS, isHotlinkBlockedHost, viaImageProxy } from "@/lib/hotlink-hosts";
import { verifyReachableImage } from "@/lib/seo-landing-pages";

test("viaImageProxy rewrites blocked-host URLs and passes everything else through", () => {
  const asus =
    "https://dlcdnwebimgs.asus.com/files/media/x/v1/img/product/zenbook14-oled.png";
  assert.equal(
    viaImageProxy(asus),
    `/api/image-proxy?url=${encodeURIComponent(asus)}`,
  );
  const courts = "https://www.courts.com.sg/media/catalog/product/6513408.jpg";
  assert.match(viaImageProxy(courts)!, /^\/api\/image-proxy\?url=/);

  // Unsplash hosts joined the blocklist upstream (BUY-72904-era) — they now
  // also route through the proxy.
  const unsplash = "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400";
  assert.match(viaImageProxy(unsplash)!, /^\/api\/image-proxy\?url=/);

  // Non-blocked hosts pass through unchanged.
  const ok = "https://m.media-amazon.com/images/I/71abc.jpg";
  assert.equal(viaImageProxy(ok), ok);

  // data: SVG placeholders pass through unchanged.
  const svg = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";
  assert.equal(viaImageProxy(svg), svg);

  // null/undefined stay null.
  assert.equal(viaImageProxy(null), null);
  assert.equal(viaImageProxy(undefined), null);
});

test("isHotlinkBlockedHost classifies hostnames", () => {
  assert.equal(isHotlinkBlockedHost("https://dlcdnwebimgs.asus.com/a.png"), true);
  assert.equal(isHotlinkBlockedHost("https://www.courts.com.sg/a.jpg"), true);
  assert.equal(isHotlinkBlockedHost("https://images.unsplash.com/a"), true);
  assert.equal(isHotlinkBlockedHost("https://m.media-amazon.com/a.jpg"), false);
  assert.equal(isHotlinkBlockedHost(null), false);
  assert.equal(isHotlinkBlockedHost("not-a-url"), false);
});

test("verifyReachableImage trusts proxy and blocked-host URLs (BUY-70187)", async () => {
  assert.equal(await verifyReachableImage("/api/image-proxy?url=https%3A%2F%2Fdlcdnwebimgs.asus.com%2Fa.png"), true);
  assert.equal(await verifyReachableImage("https://www.courts.com.sg/media/catalog/product/x.jpg"), true);
  // Sanity: a non-blocked dead URL is still probed (and fails offline-safe).
  // (Network-independent: a malformed host throws/fails the fetch → false.)
  assert.equal(await verifyReachableImage("https://definitely-not-a-real-host.invalid/a.jpg"), false);
});

test("HOTLINK_BLOCKED_HOSTS contains the QA-flagged hosts", () => {
  for (const host of ["dlcdnwebimgs.asus.com", "www.courts.com.sg", "courts.com.sg", "www.asus.com"]) {
    assert.ok(HOTLINK_BLOCKED_HOSTS.has(host), `missing ${host}`);
  }
});
