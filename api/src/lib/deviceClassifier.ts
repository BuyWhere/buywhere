// BUY-67522 / BUY-66859: device-query classifier for find_best_price.
// Distinguishes exact device-family queries (phone / console / laptop / tablet)
// from accessories, parts, cases, protectors, controllers, games, software, etc.
// Used to add positive / negative SQL predicates and price floors without
// requiring a fully populated product_type column.

interface DevicePattern {
  type: 'phone' | 'console' | 'laptop' | 'tablet' | 'wearable' | null;
  negativeTerms: string[];
  minPriceUsd: number;
}

const ACCESSORY_NEGATIVE_TERMS = [
  'case', 'cover', 'protector', 'screen protector', 'tempered glass',
  'adapter', 'cable', 'charger', 'battery', 'strap', 'band', 'holder',
  'mount', 'stand', 'skin', 'sticker', 'bumper', 'wallet', 'pouch',
  'sleeve', 'bag', 'backpack', 'handbag', 'purse', 'clutch', 'tote', 'belt',
  'controller', 'game', 'juego', 'kryt', 'capa',
  'funda', 'coque', 'hülle', 'cover', '保護', 'ケース', 'カバー',
  'compatible', 'replacement', 'part', 'spare', 'repair', 'tool',
  'carcasa', 'étui', 'pouzdro', 'obal', 'etui',
];

function inferDevice(productName: string): DevicePattern {
  const p = productName.toLowerCase();
  // Phones
  if (/\b(iphone\b|samsung galaxy s|google pixel\b|xiaomi\b|redmi\b|oppo\b|vivo\b|nothing phone|oneplus\b)/.test(p)) {
    return { type: 'phone', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 80 };
  }
  // Consoles / controllers
  if (/\b(ps5\b|playstation\s*5|xbox\s*series\s*(s|x)\b|nintendo\s*switch\b)/.test(p)) {
    return { type: 'console', negativeTerms: [...ACCESSORY_NEGATIVE_TERMS, 'juego', 'game', 'controller'], minPriceUsd: 150 };
  }
  // Laptops
  if (/\b(macbook\b|thinkpad\b|dell\s*xps|hp\s*pavilion|asus\s*zenbook|lenovo\s*thinkpad|laptop\b|notebook\b)/.test(p)) {
    return { type: 'laptop', negativeTerms: [...ACCESSORY_NEGATIVE_TERMS, 'sticker', 'sleeve', 'bag'], minPriceUsd: 200 };
  }
  // Tablets
  if (/\b(ipad\b|galaxy\s*tab\b|surface\s*pro\b|tablet\b)/.test(p)) {
    return { type: 'tablet', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 100 };
  }
  // Wearables
  if (/\b(apple\s*watch\b|galaxy\s*watch\b|fitbit\b|garmin\s*(fenix|forerunner))\b/.test(p)) {
    return { type: 'wearable', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 50 };
  }
  return { type: null, negativeTerms: [], minPriceUsd: 0 };
}

export function buildDeviceFilter(productName: string, country: string) {
  const device = inferDevice(productName);
  const toUsd = {
    SGD: 0.74, MYR: 0.22, THB: 0.028, VND: 0.000041, USD: 1, PHP: 0.017, IDR: 0.000061,
  }[country] || 1;
  const minLocal = device.minPriceUsd > 0 ? device.minPriceUsd / toUsd : 0;
  return { ...device, minLocal };
}
