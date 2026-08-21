// BUY-67522 / BUY-66859 / BUY-65095: device-query classifier for find_best_price.
// Distinguishes exact device-family queries (phone / console / laptop / tablet)
// and product-family queries (footwear / apparel) from accessories, parts,
// cases, protectors, controllers, games, software, etc. Used to add positive
// / negative SQL predicates and price floors without requiring a fully
// populated product_type column.

interface DevicePattern {
  type: 'phone' | 'console' | 'laptop' | 'tablet' | 'wearable' | 'footwear' | 'apparel' | null;
  negativeTerms: string[];
  minPriceUsd: number;
}

const ACCESSORY_NEGATIVE_TERMS = [
  'case', 'cover', 'protector', 'screen protector', 'tempered glass',
  'adapter', 'cable', 'charger', 'battery', 'strap', 'band', 'holder',
  'mount', 'stand', 'skin', 'sticker', 'bumper', 'wallet', 'pouch',
  'sleeve', 'bag', 'controller', 'game', 'juego', 'kryt', 'capa',
  'funda', 'coque', 'hülle', 'cover', '保護', 'ケース', 'カバー',
  'compatible', 'replacement', 'part', 'spare', 'repair', 'tool',
  'carcasa', 'étui', 'pouzdro', 'obal', 'etui',
  // BUY-65095: expand for laptop/telephony/tablet accessories that slip through
  'cleaner', 'cleaning', 'wipe', 'dust', 'privacy screen', 'privacy filter',
  'extender', 'replicator', 'hub', 'dock', 'docking station',
  'sleeve', 'skin', 'bumper', 'flip', 'tpu', 'gel', 'clear case',
  'keyboard cover', 'palm rest', 'trackpad', 'lcd guard',
  'screen filter', 'monitor stand', 'laptop riser', 'cooling pad',
  'mouse pad', 'mouse', 'webcam cover', 'camera cover',
  'usb cable', 'hdmi cable', 'display cable', 'power cord',
  'travel case', 'laptop sleeve', 'messenger bag', 'backpack',
  // Phone accessories
  'ring holder', 'pop socket', 'card holder', 'magnetic wallet',
  'glass protector', ' hydrogel', 'tempered', 'privacy glass',
];

// BUY-65095: footwear accessories that win best_price when the query is a
// footwear term (sneakers, shoes, trainers, runners, boots).
const FOOTWEAR_NEGATIVE_TERMS = [
  // Garments that share the catalog with footwear
  'sock', 'socks', 'socklet',
  // Care products
  'cleaner', 'cleaning', 'spray', 'deodorizer', 'deodorant',
  'shoe polish', 'shoe cream', 'shoe wax', 'leather conditioner',
  // Laces / insoles / inserts / accessories
  'shoelace', 'shoe lace', 'lace', 'insole', 'insert', 'inserts',
  // Trees / shapers / stuffers / bags
  'shoe tree', 'boot tree', 'boot shaper', 'boot bag', 'shoe bag',
  'stuffers', 'shaper', 'shapers', 'stretchers', 'stretcher',
  // Kids clothing adjacent
  'baby socks', 'baby booties',
];

// BUY-65095: apparel accessories that win best_price when the query is a
// clothing term (shirt, tee, dress, hoodie, jacket).
const APPAREL_NEGATIVE_TERMS = [
  // Laundry / care
  'detergent', 'softener', 'stain remover', 'laundry', 'dry cleaning',
  // Closet accessories
  'hanger', 'clothes hanger', 'garment bag', 'storage bag',
  // Sewing / tailoring
  'thread', 'needle', 'button', 'sewing', 'iron', 'ironing board',
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
  // BUY-65095: footwear family (sneakers, shoes, trainers, runners, boots)
  // "nike" by itself is ambiguous (jersey? sneakers?) so we don't match it here.
  if (/\b(sneaker|sneakers|shoe\b|shoes|trainer|trainers|runner|runners|boot\b|boots|loafer|loafers|heel\b|heels|sandal|sandals|flip[\s-]?flop|slipper|slippers|cleats?|football boots|soccer boots|cross[\s-]?trainer)\b/.test(p)) {
    return { type: 'footwear', negativeTerms: FOOTWEAR_NEGATIVE_TERMS, minPriceUsd: 25 };
  }
  // BUY-65095: apparel family
  if (/\b(shirt|shirts|tee\b|teeshirt|t-shirt|polo\b|dress\b|dresses|hoodie|hoodies|jacket|jackets|coat\b|coats|sweater|sweaters|jumper|jumpers|shorts\b|pants\b|trousers|jeans|skirt|skirts|blouse|blouses|sweatshirt|sweatshirts|cardigan|tank top|tank tops|leggings|pajamas|pajama|pyjamas|pyjama|underwear|bra\b|bras)\b/.test(p)) {
    return { type: 'apparel', negativeTerms: APPAREL_NEGATIVE_TERMS, minPriceUsd: 10 };
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
