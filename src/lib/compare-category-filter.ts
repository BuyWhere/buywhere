/**
 * BUY-59985: Infer a product category from a compare-page query string.
 *
 * The /compare route calls the search API without a category filter,
 * so FTS returns products that merely *mention* the query term in their
 * description (e.g. headphones for a "laptop" query). This module maps
 * common product-type keywords to their database category values so the
 * compare page can (a) pass the category param to the search API and
 * (b) post-filter results whose category does not match the intent.
 *
 * Category values here mirror the `products.category` column stored by
 * BuyWhere ingestors (Amazon, Walmart, Target, BestBuy, etc.).
 */

const CATEGORY_KEYWORDS: [string, string[]][] = [
  // Laptops & computers
  ["Laptops", ["laptop", "notebook", "chromebook", "macbook", "thinkpad", "ideapad"]],
  ["Desktops", ["desktop", "workstation", "mac mini", "mac studio", "pc tower"]],
  ["Computer Accessories", ["mouse", "keyboard", "monitor", "webcam", "usb hub", "docking station", "laptop stand", "laptop sleeve", "laptop bag", "laptop charger"]],
  ["Computer Components", ["gpu", "graphics card", "cpu", "ram", "ssd", "hard drive", "motherboard", "power supply", "case", "cooler"]],
  // Audio
  ["Headphones", ["headphone", "headset", "earbuds", "earphone", "airpods", "earbud", "in-ear"]],
  ["Speakers", ["speaker", "soundbar", "subwoofer", "bluetooth speaker"]],
  ["Microphones", ["microphone", "mic", "podcast mic"]],
  // Phones & tablets
  ["Cell Phones", ["phone", "iphone", "galaxy", "pixel phone", "smartphone"]],
  ["Tablets", ["tablet", "ipad", "galaxy tab", "kindle fire"]],
  ["Phone Accessories", ["phone case", "screen protector", "phone charger", "cable", "wireless charger", "power bank"]],
  // TVs & video
  ["Televisions", ["tv", "television", "oled", "qled", "smart tv", "roku", "fire tv"]],
  ["Streaming Devices", ["roku", "apple tv", "fire stick", "chromecast"]],
  // Wearables
  ["Wearable Technology", ["smartwatch", "smart watch", "fitness tracker", "apple watch", "fitbit"]],
  // Gaming
  ["Video Games", ["game", "gaming", "controller", "console", "playstation", "xbox", "nintendo", "switch"]],
  ["PC Gaming", ["gaming pc", "gaming laptop", "gaming monitor", "gaming keyboard", "gaming mouse"]],
  // Home
  ["Kitchen", ["kitchen", "blender", "air fryer", "instant pot", "coffee maker", "toaster", "microwave"]],
  ["Home Appliances", ["vacuum", "robot vacuum", "roomba", "dyson", "dishwasher", "washer", "dryer"]],
  // Sports
  ["Sports & Outdoors", ["bicycle", "bike", "yoga", "dumbbell", "treadmill", "fishing", "tent"]],
  // Beauty
  ["Beauty", ["skincare", "moisturizer", "serum", "sunscreen", "makeup", "lipstick", "foundation"]],
  // Fashion
  ["Clothing", ["shirt", "dress", "jacket", "jeans", "shoe", "sneaker", "boot", "sandal"]],
  ["Bags", ["backpack", "handbag", "luggage", "suitcase", "duffel"]],
];

/**
 * Given a query string, return the most likely database category, or
 * `null` if no strong match is found (in which case we fall back to
 * unfiltered FTS).
 */
export function inferCategoryFromQuery(query: string): string | null {
  const lower = query.toLowerCase().trim();

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Post-filter an array of comparison offers so that only offers whose
 * `category` matches the inferred category are kept. If the category is
 * null (no match), all offers pass through.
 *
 * Returns the filtered array AND the total count before filtering so the
 * caller can decide whether to fall back to unfiltered results (e.g. when
 * filtering would return 0 results for an uncommon query).
 */
export function filterOffersByCategory<T extends { category: string | null }>(
  offers: T[],
  inferredCategory: string | null,
): { filtered: T[]; keptCount: number; totalCount: number } {
  if (!inferredCategory) {
    return { filtered: offers, keptCount: offers.length, totalCount: offers.length };
  }

  const lowerCat = inferredCategory.toLowerCase();
  const filtered = offers.filter((offer) => {
    const offerCat = (offer.category || "").toLowerCase();
    if (!offerCat) return true; // keep offers without category (unknown category)
    // Match if the offer category *contains* the inferred keyword or vice-versa
    return offerCat.includes(lowerCat) || lowerCat.includes(offerCat);
  });

  return { filtered, keptCount: filtered.length, totalCount: offers.length };
}
