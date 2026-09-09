import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const constants = readFileSync(join(here, "api-endpoints.ts"), "utf8");
const playground = readFileSync(join(here, "../app/playground/page.tsx"), "utf8");
const docsPlayground = readFileSync(join(here, "../components/docs/ApiPlayground.tsx"), "utf8");

test("canonical search path is /v1/products/search", () => {
  assert.match(constants, /export const SEARCH_ENDPOINT = '\/v1\/products\/search'/);
});

test("standalone playground uses the shared search constant", () => {
  assert.match(playground, /SEARCH_ENDPOINT/);
  assert.doesNotMatch(playground, /path:\s*'\/v1\/search'/);
  assert.doesNotMatch(playground, /let path = '\/v1\/search'/);
});

test("docs playground uses the shared search constant", () => {
  assert.match(docsPlayground, /SEARCH_ENDPOINT/);
  assert.doesNotMatch(docsPlayground, /path:\s*'\/v1\/search'/);
});
