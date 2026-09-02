import assert from 'node:assert/strict';
import test from 'node:test';

const DEVICE_QUERY_TOKENS = [
  'laptop', 'desktop', 'phone', 'tablet', 'monitor', 'smartwatch', 'earbud', 'headphone', 'console', 'ipad',
];
const STORAGE_QUERY_TOKENS = new Set(['ssd', 'hdd', 'nvme', 'storage', 'hard', 'drive']);
const STORAGE_CATEGORY_TOKENS = [
  'storage', 'internal ssd', 'solid state drive', 'solid state', 'hard drive',
  'nvme ssd', 'external ssd', 'internal drive', 'usb drive', 'memory card',
];
const PHONE_PRODUCT_TOKENS = [
  'iphone', 'samsung galaxy', 'galaxy s', 'galaxy z', 'google pixel', 'pixel',
  'android', 'smartphone', 'cell phone', 'mobile phone', 'unlocked phone',
  'dual sim', '5g', '4g', 'nokia', 'motorola', 'moto ', 'oneplus', 'xiaomi',
  'redmi', 'realme', 'infinix', 'oppo', 'vivo', 'sony xperia', 'feature phone',
  'keypad phone',
];
const PHONE_ACCESSORY_TOKENS = [
  'accessory', 'accessories', 'case', 'cover', 'protector', 'charger', 'charging',
  'cable', 'holder', 'mount', 'stand', 'pouch', 'wallet', 'crossbody', 'lanyard',
  'strap', 'armband', 'tripod', 'selfie stick', 'power bank', 'battery pack',
];
const ACCESSORY_KEYWORDS = [
  'adapter', 'battery', 'cable', 'case', 'charger', 'charging', 'cover',
  'holder', 'mount', 'pad', 'part', 'protector', 'replacement', 'sleeve',
  'stand', 'strap', 'usb',
];
const QUERY_STOP_WORDS = new Set(['a', 'an', 'and', 'best', 'for', 'in', 'of', 'the', 'to', 'with']);

function normalizeText(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '';
}

function classifyDeviceQuery(query) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  let isDevice = false, isStorage = false;
  for (const w of words) {
    for (const fam of DEVICE_QUERY_TOKENS) {
      if (w.length >= fam.length && w.startsWith(fam)) { isDevice = true; break; }
    }
    if (STORAGE_QUERY_TOKENS.has(w)) isStorage = true;
  }
  if (words.length > 4) isDevice = false;
  return { isDevice, isStorage };
}

function itemCategoryLower(item) {
  const meta = item.metadata;
  return typeof meta?.category === 'string' ? meta.category.toLowerCase() :
    (typeof item.category === 'string' ? item.category.toLowerCase() : '');
}

function isStorageCategoryItem(item) {
  const cat = itemCategoryLower(item);
  if (!cat) return false;
  return STORAGE_CATEGORY_TOKENS.some((tok) => cat.includes(tok));
}

function coreQueryWords(query) {
  return normalizeText(query).split(/\s+/).filter((word) => word.length > 1 && !QUERY_STOP_WORDS.has(word));
}

function itemSearchText(item) {
  const meta = item.metadata;
  return [item.name, item.title, item.brand, item.category, meta?.category].map(normalizeText).filter(Boolean).join(' ');
}

function isPhoneProductItem(item) {
  const searchText = itemSearchText(item);
  return PHONE_PRODUCT_TOKENS.some((token) => searchText.includes(token));
}

function isPhoneAccessoryItem(item) {
  const category = itemCategoryLower(item);
  const searchText = itemSearchText(item);
  if (category.includes('phone accessory') || category.includes('cell phone accessory')) return true;
  if (isPhoneProductItem(item)) return false;
  return PHONE_ACCESSORY_TOKENS.some((token) => searchText.includes(token));
}

function isAccessoryItem(item, queryWords) {
  const searchText = itemSearchText(item);
  if (!searchText) return false;
  const hasAccessoryKeyword = ACCESSORY_KEYWORDS.some((keyword) => searchText.includes(keyword));
  if (!hasAccessoryKeyword) return false;
  if (queryWords.length === 0) return true;
  const matchedQueryWords = queryWords.filter((word) => searchText.includes(word)).length;
  return matchedQueryWords / queryWords.length < 0.5;
}

function dedupeKey(item) {
  const name = normalizeText(item.name || item.title);
  const brand = normalizeText(item.brand);
  if (!name) return '';
  return `${brand}:${name}`.replace(/\b(new|sale|deal|official|authentic|original)\b/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}

function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = dedupeKey(item);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankAndClassifyItems(items, query) {
  const queryWords = coreQueryWords(query);
  const { isDevice, isStorage } = classifyDeviceQuery(query);
  let dedupedItems = deduplicateItems(items);

  if (isDevice && !isStorage) {
    const primary = [], demoted = [];
    for (const item of dedupedItems) {
      if (isStorageCategoryItem(item)) demoted.push(item);
      else primary.push(item);
    }
    dedupedItems = [...primary, ...demoted];
  }

  if (isDevice && !isStorage && query.toLowerCase().includes('phone')) {
    const phones = [], rest = [];
    for (const item of dedupedItems) {
      if (isPhoneProductItem(item)) phones.push(item);
      else rest.push(item);
    }
    dedupedItems = [...phones, ...rest];
  }

  const primaryItems = [];
  const accessoryItems = [];
  dedupedItems.forEach((item) => {
    const isAccessoryByKeyword = isAccessoryItem(item, queryWords);
    const isPhoneAccessory = isDevice && !isStorage && query.toLowerCase().includes('phone') ? isPhoneAccessoryItem(item) : false;
    const isAccessory = isAccessoryByKeyword || isPhoneAccessory;
    const classifiedItem = { ...item, isAccessory, product_type: isAccessory ? 'accessory' : item.product_type };
    if (isAccessory) accessoryItems.push(classifiedItem);
    else primaryItems.push(classifiedItem);
  });
  return [...primaryItems, ...accessoryItems];
}

const phone = (title) => ({ title, metadata: { category: 'Phones' } });
const accessory = (title, category = 'Phone Accessories') => ({ title, metadata: { category } });

test('phone query promotes actual handsets ahead of accessory-heavy live rows', () => {
  const liveLikeRows = [
    accessory('Flip Laptop Phone Mount', 'For Laptops'),
    accessory('Clicker Phone and Phone Pocket Set', 'baby_kids'),
    accessory('O-Mag Magnetic Phone Holder (Mag Fit)', 'Phone Accessories'),
    accessory('Sea Turtle Cell Phone Holder', ''),
    accessory('Phone Charm', ''),
    phone('Google Pixel 9 5G'),
    phone('Samsung Galaxy Z Fold 6'),
    phone('iPhone 17e 256GB Black'),
    phone('Nokia 225 4G Dual SIM Feature Phone'),
    phone('Motorola Moto G Power 5G Unlocked Phone'),
    phone('OnePlus 13R Android Smartphone'),
    phone('Xiaomi Redmi 13C Mobile Phone'),
    phone('Sony Xperia 1 VI 5G Mobile Phone'),
  ];

  const ranked = rankAndClassifyItems(liveLikeRows, 'phone');
  const top10 = ranked.slice(0, 10);

  assert.ok(
    top10.filter((item) => /pixel|galaxy|iphone|nokia|motorola|oneplus|xiaomi|xperia/i.test(String(item.title))).length >= 8,
    `expected at least 8 handset rows in top 10, got: ${top10.map((item) => item.title).join(' | ')}`,
  );
  assert.ok(
    !top10.some((item) => String(item.metadata?.category || '').toLowerCase().includes('phone accessories')),
    `phone accessories must be demoted out of top 10: ${top10.map((item) => `${item.title} (${item.metadata?.category || ''})`).join(' | ')}`,
  );
});

test('laptop ssd remains a storage positive control', () => {
  const ranked = rankAndClassifyItems([
    { title: 'Seagate Firecuda 520 1TB Internal SSD', metadata: { category: 'Storage' } },
    { title: 'Dell XPS 15 Laptop 1TB SSD', metadata: { category: 'Laptops' } },
  ], 'laptop ssd');

  assert.equal(ranked[0].metadata.category, 'Storage');
});
