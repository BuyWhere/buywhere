// BUY-68736: drop fabricated Amazon rows emitted by the catalog ingest lane.
//
// QA searched "gaming laptop" (country=us) and got six near-identical cards:
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD"          (+ Premium /
//   Plus / Elite / Max / Pro suffixes)
// These are not a rendering duplicate — they are seeded catalog rows that
// never corresponded to a real offer.
//
// The reliable structural tell is the ASIN. A real Amazon ASIN is exactly 10
// characters; every fabricated row carries an 11-character one:
//
//   B1016280791 (11) "Gaming Laptop RTX 4060 …"  → PDP responds  1,089 bytes
//   B0B9678Z4L  (10) "Honeyuan H13 Air Purifier" → PDP responds 506,619 bytes
//
// i.e. the 11-char links resolve to an Amazon "page not found" stub, so every
// one of these cards is a dead end for the user.
//
// We deliberately key ONLY on the ASIN shape. The tempting alternative —
// clustering titles by stripping trailing tier words (Premium/Plus/Pro/Max/
// Ultra…) — collapses real product families: "iPhone 15", "iPhone 15 Plus",
// "iPhone 15 Pro" and "iPhone 15 Pro Max" all reduce to the same key, as do
// "MacBook Pro 14" / "MacBook 14". That trades a 6-duplicate bug for a
// catalog-wide result-suppression bug.
//
// This module deliberately has no `next/*` imports so the regression test can
// exercise it without the Next runtime.

const AMAZON_PRODUCT_URL_PATTERN = /(?:^|\.)amazon\.[a-z.]{2,}\/(?:dp|gp\/product)\/([A-Za-z0-9]+)/i;
const VALID_ASIN_LENGTH = 10;

export function isFabricatedAmazonItem(item: Record<string, unknown>): boolean {
  const candidateUrls = [item.url, item.click_url, item.affiliate_url, item.buy_url];

  for (const candidate of candidateUrls) {
    if (typeof candidate !== 'string') continue;
    const match = AMAZON_PRODUCT_URL_PATTERN.exec(candidate);
    if (!match) continue;
    // Only judge the row once we've positively identified an Amazon /dp/ link.
    return match[1].length !== VALID_ASIN_LENGTH;
  }

  return false;
}

export function dropFabricatedItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const genuineItems = items.filter((item) => !isFabricatedAmazonItem(item));
  // Fail open: if a query somehow returns nothing but seeded rows, showing
  // them beats rendering an empty results page.
  return genuineItems.length > 0 ? genuineItems : items;
}
