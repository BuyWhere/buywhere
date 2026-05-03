import { deepStrictEqual } from 'assert';

let preprocessSearchQuery;

try {
  const mod = await import('../dist/lib/queryPreprocessor.js');
  preprocessSearchQuery = mod.preprocessSearchQuery;
} catch {
  try {
    const { preprocessSearchQuery: fn } = await import('../src/lib/queryPreprocessor.ts');
    preprocessSearchQuery = fn;
  } catch {
    try {
      const mod = await import('../src/lib/queryPreprocessor.js');
      preprocessSearchQuery = mod.preprocessSearchQuery;
    } catch {
      console.error('Cannot load queryPreprocessor — skipping tests.');
      process.exit(0);
    }
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ── Price extraction ──

test('under price', () => {
  const r = preprocessSearchQuery('laptop under 1000');
  deepStrictEqual(r.extractedMaxPrice, 1000);
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('below price', () => {
  const r = preprocessSearchQuery('headphones below 50 dollars');
  deepStrictEqual(r.extractedMaxPrice, 50);
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

test('less than price', () => {
  const r = preprocessSearchQuery('phone less than 300 SGD');
  deepStrictEqual(r.extractedMaxPrice, 300);
  deepStrictEqual(r.cleanedQuery, 'phone');
});

test('cheaper than', () => {
  const r = preprocessSearchQuery('tv cheaper than 500');
  deepStrictEqual(r.extractedMaxPrice, 500);
  deepStrictEqual(r.cleanedQuery, 'tv');
});

test('at most', () => {
  const r = preprocessSearchQuery('laptop at most 1200');
  deepStrictEqual(r.extractedMaxPrice, 1200);
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('max price', () => {
  const r = preprocessSearchQuery('max 50 headphones');
  deepStrictEqual(r.extractedMaxPrice, 50);
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

// ── Min price ──

test('over price', () => {
  const r = preprocessSearchQuery('headphones over 50');
  deepStrictEqual(r.extractedMinPrice, 50);
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

test('above price', () => {
  const r = preprocessSearchQuery('camera above 200');
  deepStrictEqual(r.extractedMinPrice, 200);
  deepStrictEqual(r.cleanedQuery, 'camera');
});

test('more than price', () => {
  const r = preprocessSearchQuery('laptop more than 1000');
  deepStrictEqual(r.extractedMinPrice, 1000);
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('at least price', () => {
  const r = preprocessSearchQuery('tablet at least 300');
  deepStrictEqual(r.extractedMinPrice, 300);
  deepStrictEqual(r.cleanedQuery, 'tablet');
});

test('minimum price', () => {
  const r = preprocessSearchQuery('minimum 200 watch');
  deepStrictEqual(r.extractedMinPrice, 200);
  deepStrictEqual(r.cleanedQuery, 'watch');
});

test('min price', () => {
  const r = preprocessSearchQuery('min 100 shoes');
  deepStrictEqual(r.extractedMinPrice, 100);
  deepStrictEqual(r.cleanedQuery, 'shoes');
});

// ── Price range ──

test('between x and y', () => {
  const r = preprocessSearchQuery('laptop between 500 and 1000');
  deepStrictEqual(r.extractedMinPrice, 500);
  deepStrictEqual(r.extractedMaxPrice, 1000);
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('from x to y', () => {
  const r = preprocessSearchQuery('phone from 200 to 500');
  deepStrictEqual(r.extractedMinPrice, 200);
  deepStrictEqual(r.extractedMaxPrice, 500);
  deepStrictEqual(r.cleanedQuery, 'phone');
});

// ── Country extraction ──

test('in Singapore', () => {
  const r = preprocessSearchQuery('laptop in Singapore');
  deepStrictEqual(r.extractedCountryCode, 'SG');
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('Malaysia', () => {
  const r = preprocessSearchQuery('phones Malaysia');
  deepStrictEqual(r.extractedCountryCode, 'MY');
  deepStrictEqual(r.cleanedQuery, 'phones');
});

test('Vietnam', () => {
  const r = preprocessSearchQuery('headphones Vietnam');
  deepStrictEqual(r.extractedCountryCode, 'VN');
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

test('Thailand', () => {
  const r = preprocessSearchQuery('camera Thailand');
  deepStrictEqual(r.extractedCountryCode, 'TH');
  deepStrictEqual(r.cleanedQuery, 'camera');
});

test('in the US', () => {
  const r = preprocessSearchQuery('laptop in the US');
  deepStrictEqual(r.extractedCountryCode, 'US');
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

// ── Sort extraction ──

test('cheapest', () => {
  const r = preprocessSearchQuery('cheapest laptop');
  deepStrictEqual(r.sortIntent, 'price_asc');
  deepStrictEqual(r.cleanedQuery.includes('laptop'), true);
});

test('most expensive', () => {
  const r = preprocessSearchQuery('most expensive headphones');
  deepStrictEqual(r.sortIntent, 'price_desc');
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

test('best rated', () => {
  const r = preprocessSearchQuery('best laptop');
  deepStrictEqual(r.sortIntent, 'rating_desc');
  deepStrictEqual(r.cleanedQuery.includes('laptop'), true);
});

test('top rated', () => {
  const r = preprocessSearchQuery('top rated phone');
  deepStrictEqual(r.sortIntent, 'rating_desc');
  deepStrictEqual(r.cleanedQuery.includes('phone'), true);
});

// ── Combined extraction ──

test('best laptop under 1000 in Singapore', () => {
  const r = preprocessSearchQuery('best laptop under 1000 in Singapore');
  deepStrictEqual(r.cleanedQuery.includes('laptop'), true);
  deepStrictEqual(r.extractedMaxPrice, 1000);
  deepStrictEqual(r.extractedCountryCode, 'SG');
  deepStrictEqual(r.sortIntent, 'rating_desc');
});

test('cheap phones below 200 in Malaysia', () => {
  const r = preprocessSearchQuery('cheap phones below 200 in Malaysia');
  deepStrictEqual(r.extractedMaxPrice, 200);
  deepStrictEqual(r.extractedCountryCode, 'MY');
  deepStrictEqual(r.sortIntent, 'price_asc');
  deepStrictEqual(r.cleanedQuery, 'phones');
});

test('under 500 camera Thailand', () => {
  const r = preprocessSearchQuery('under 500 camera Thailand');
  deepStrictEqual(r.extractedMaxPrice, 500);
  deepStrictEqual(r.extractedCountryCode, 'TH');
  deepStrictEqual(r.cleanedQuery, 'camera');
});

test('buy headphones over 50', () => {
  const r = preprocessSearchQuery('buy headphones over 50');
  deepStrictEqual(r.extractedMinPrice, 50);
  deepStrictEqual(r.cleanedQuery, 'headphones');
});

// ── No extraction (backward compat) ──

test('raw keyword: iphone 15', () => {
  const r = preprocessSearchQuery('iphone 15');
  deepStrictEqual(r.cleanedQuery, 'iphone 15');
  deepStrictEqual(r.extractedMaxPrice, undefined);
  deepStrictEqual(r.extractedMinPrice, undefined);
  deepStrictEqual(r.extractedCountryCode, undefined);
});

test('raw keyword: samsung tv', () => {
  const r = preprocessSearchQuery('samsung tv');
  deepStrictEqual(r.cleanedQuery, 'samsung tv');
  deepStrictEqual(r.extractedMaxPrice, undefined);
});

test('raw keyword: macbook pro m3', () => {
  const r = preprocessSearchQuery('macbook pro m3');
  deepStrictEqual(r.cleanedQuery, 'macbook pro m3');
  deepStrictEqual(r.extractedCountryCode, undefined);
});

test('empty query', () => {
  const r = preprocessSearchQuery('');
  deepStrictEqual(r.cleanedQuery, '');
});

test('short query', () => {
  const r = preprocessSearchQuery('ab');
  deepStrictEqual(r.cleanedQuery, 'ab');
});

// ── Category extraction ──

test('laptop category', () => {
  const r = preprocessSearchQuery('laptops under 1000');
  deepStrictEqual(r.extractedCategory, 'laptops');
  deepStrictEqual(r.cleanedQuery.includes('laptops'), true);
  deepStrictEqual(r.extractedMaxPrice, 1000);
});

// ── Price with dollar sign ──

test('dollar sign price', () => {
  const r = preprocessSearchQuery('laptop under $800');
  deepStrictEqual(r.extractedMaxPrice, 800);
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

// ── Noise cleaning ──

test('buy keyword stripped', () => {
  const r = preprocessSearchQuery('buy nike shoes');
  deepStrictEqual(r.cleanedQuery, 'nike shoes');
});

test('find keyword stripped', () => {
  const r = preprocessSearchQuery('find me a good laptop');
  deepStrictEqual(r.cleanedQuery, 'laptop');
});

test('pricing words stripped', () => {
  const r = preprocessSearchQuery('cheap sale discounted samsung');
  deepStrictEqual(r.cleanedQuery, 'samsung');
});

// ── False extraction protection ──

test('number in product name not confused as price', () => {
  const r = preprocessSearchQuery('iphone 15 pro max');
  deepStrictEqual(r.cleanedQuery, 'iphone 15 pro max');
  deepStrictEqual(r.extractedMaxPrice, undefined);
  deepStrictEqual(r.extractedMinPrice, undefined);
});

test('years not confused as price', () => {
  const r = preprocessSearchQuery('2024 macbook pro');
  deepStrictEqual(r.cleanedQuery, '2024 macbook pro');
  deepStrictEqual(r.extractedMaxPrice, undefined);
});

test('model numbers preserved', () => {
  const r = preprocessSearchQuery('samsung galaxy s24 ultra');
  deepStrictEqual(r.cleanedQuery, 'samsung galaxy s24 ultra');
});

test('size specs preserved', () => {
  const r = preprocessSearchQuery('samsung 65 inch tv');
  deepStrictEqual(r.cleanedQuery, 'samsung 65 inch tv');
});

test('storage specs preserved', () => {
  const r = preprocessSearchQuery('iphone 256gb');
  deepStrictEqual(r.cleanedQuery.includes('iphone'), true);
  deepStrictEqual(r.cleanedQuery.includes('256gb'), true);
});

test('generic "in" as preposition not confused with country', () => {
  const r = preprocessSearchQuery('shoes in black');
  deepStrictEqual(r.extractedCountryCode, undefined);
  deepStrictEqual(r.cleanedQuery.includes('shoes'), true);
  deepStrictEqual(r.cleanedQuery.includes('black'), true);
});

test('"for" as preposition not confused with country', () => {
  const r = preprocessSearchQuery('charger for laptop');
  deepStrictEqual(r.extractedCountryCode, undefined);
  deepStrictEqual(r.cleanedQuery, 'charger laptop');
});

test('"under" as spec not confused with price', () => {
  const r = preprocessSearchQuery('under armour shoes');
  deepStrictEqual(r.cleanedQuery.includes('armour'), true);
  deepStrictEqual(r.cleanedQuery.includes('shoes'), true);
  deepStrictEqual(r.extractedMaxPrice, undefined);
});

console.log(`\n${process.exitCode ? 'SOME TESTS FAILED' : 'All tests passed'}`);
