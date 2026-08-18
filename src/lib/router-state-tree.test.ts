import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalRouterStateTree } from "@/lib/router-state-tree";

// BUY-67074 — `/search` and `/compare` returned HTTP 500 for RSC requests
// carrying a `Next-Router-State-Tree` header Next.js 14.2.35 could not walk.
// Every tree below was captured from a live probe against https://buywhere.ai
// (see BUY-67074 evidence): the `true` cases returned 200 in production and
// must keep their partial-render fast path; the `false` cases returned 500 and
// must be stripped by middleware so the request falls back to a full render.
//
// Note that only dynamically rendered routes were ever affected. Statically
// cached routes (/about, /blog, the SEO slug rewrites) answered 200 for the
// bad trees purely because they were served from the full-route cache without
// re-rendering — that is a masking effect, not a fix.

const enc = (tree: unknown) => encodeURIComponent(JSON.stringify(tree));

test("canonical trees real Chrome sends are preserved", () => {
  // Exactly what Chrome 127 sent during a live client-side navigation.
  assert.equal(
    isCanonicalRouterStateTree(
      enc(["", { children: ["__PAGE__", {}, null, null] }, null, null, true]),
    ),
    true,
  );

  // Five-element node form.
  assert.equal(
    isCanonicalRouterStateTree(
      enc(["", { children: ["__PAGE__", {}, null, null, false] }, null, null, true]),
    ),
    true,
  );

  // Nested route-group segment.
  assert.equal(
    isCanonicalRouterStateTree(
      enc([
        "",
        {
          children: [
            "(layout)",
            { children: ["__PAGE__", {}, null, null, false] },
            null,
            null,
            false,
          ],
        },
        null,
        null,
        true,
      ]),
    ),
    true,
  );

  // Canonical search params live INSIDE the segment string, not beside it.
  assert.equal(
    isCanonicalRouterStateTree(
      enc([
        "",
        {
          children: [
            "search",
            {
              children: [
                '__PAGE__?{"q":"gaming laptop","country":"us"}',
                {},
                null,
                null,
                false,
              ],
            },
            null,
            null,
            false,
          ],
        },
        null,
        null,
        true,
      ]),
    ),
    true,
  );

  // Dynamic-route segments arrive as a [param, value, type] triple.
  assert.equal(
    isCanonicalRouterStateTree(
      enc([
        "",
        {
          children: [
            ["slug", "laptop-singapore", "d"],
            { children: ["__PAGE__", {}, null, null] },
            null,
            null,
          ],
        },
        null,
        null,
        true,
      ]),
    ),
    true,
  );
});

test("populated __PAGE__ searchParams object is rejected", () => {
  // The reported repro: /search?q=gaming laptop&country=us returned 500.
  assert.equal(
    isCanonicalRouterStateTree(
      enc([
        "",
        { children: ["__PAGE__", { q: "gaming laptop" }, null, null] },
        null,
        null,
        true,
      ]),
    ),
    false,
  );

  // Same defect nested under a route group — also 500 on live.
  assert.equal(
    isCanonicalRouterStateTree(
      enc([
        "",
        {
          children: [
            "(layout)",
            {
              children: [
                "__PAGE__",
                { q: "gaming laptop", country: "us" },
                null,
                null,
                false,
              ],
            },
            null,
            null,
            false,
          ],
        },
        null,
        null,
        true,
      ]),
    ),
    false,
  );
});

test("malformed trees are rejected", () => {
  assert.equal(isCanonicalRouterStateTree("notjson"), false);
  assert.equal(isCanonicalRouterStateTree("%5B%22%22%2Cnonsense"), false);
  assert.equal(isCanonicalRouterStateTree(enc([])), false);
  assert.equal(isCanonicalRouterStateTree(enc(null)), false);
  assert.equal(isCanonicalRouterStateTree(enc("hello")), false);
  assert.equal(isCanonicalRouterStateTree(enc({ children: [] })), false);
  // parallelRoutes must be a plain object, not an array.
  assert.equal(isCanonicalRouterStateTree(enc(["", [], null, null, true])), false);
  // A non-string segment that is not a valid dynamic triple.
  assert.equal(
    isCanonicalRouterStateTree(enc([{ bad: true }, {}, null, null, true])),
    false,
  );
});

test("raw (non-percent-encoded) JSON is still accepted", () => {
  assert.equal(
    isCanonicalRouterStateTree(
      JSON.stringify(["", { children: ["__PAGE__", {}, null, null] }, null, null, true]),
    ),
    true,
  );
});
