#!/usr/bin/env node
/**
 * BUY-79133: production intent pages must not splice fallbackProducts
 * (Robot Vacuums Product A–E) onto a 200 OK when live search is empty.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/seo-landing-pages.ts"), "utf8");
const page = readFileSync(join(root, "src/components/seo/SeoLandingPage.tsx"), "utf8");
const robotJson = JSON.parse(readFileSync(join(root, "content/intent-pages/best-robot-vacuums-us.json"), "utf8"));
const oledJson = JSON.parse(readFileSync(join(root, "content/intent-pages/best-oled-tvs-us.json"), "utf8"));

function fail(msg) {
  console.error("BUY-79133 FAIL:", msg);
  process.exit(1);
}

if (!src.includes("allowSeoFallbackProducts")) {
  fail("getSeoLandingProducts must gate fallbacks with allowSeoFallbackProducts()");
}
if (!src.includes('process.env.NODE_ENV !== "production"')) {
  fail("allowSeoFallbackProducts must refuse NODE_ENV=production");
}
if (!page.includes('process.env.NODE_ENV === "production"')) {
  fail("SeoLandingPage must empty-state in production instead of fallbackProducts");
}
if (!/robot\s+vacuum/i.test(robotJson.searchQuery)) {
  fail(`robot searchQuery not catalog-aligned: ${robotJson.searchQuery}`);
}
if (!/oled/i.test(oledJson.searchQuery)) {
  fail(`oled searchQuery not catalog-aligned: ${oledJson.searchQuery}`);
}
console.log("BUY-79133 guard OK");
