import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { preprocessSearchQuery } = require('../dist/lib/queryPreprocessor');

describe('preprocessSearchQuery', () => {
  describe('empty / edge input', () => {
    it('returns empty cleanedQuery for empty string', () => {
      const r = preprocessSearchQuery('');
      assert.equal(r.cleanedQuery, '');
      assert.equal(r.extractedMinPrice, undefined);
      assert.equal(r.extractedMaxPrice, undefined);
      assert.equal(r.sortIntent, undefined);
    });

    it('returns empty cleanedQuery for whitespace-only', () => {
      const r = preprocessSearchQuery('   ');
      assert.equal(r.cleanedQuery, '   ');
    });
  });

  describe('price extraction from NL', () => {
    it('extracts maxPrice from "under"', () => {
      const r = preprocessSearchQuery('headphones under 50');
      assert.equal(r.cleanedQuery, 'headphones');
      assert.equal(r.extractedMaxPrice, 50);
    });

    it('extracts maxPrice from "below"', () => {
      const r = preprocessSearchQuery('shoes below 100');
      assert.equal(r.cleanedQuery, 'shoes');
      assert.equal(r.extractedMaxPrice, 100);
    });

    it('extracts maxPrice with dollar sign', () => {
      const r = preprocessSearchQuery('laptop under $1500');
      assert.equal(r.cleanedQuery, 'laptop');
      assert.equal(r.extractedMaxPrice, 1500);
    });

    it('extracts maxPrice from "less than"', () => {
      const r = preprocessSearchQuery('phone less than 300');
      assert.equal(r.cleanedQuery, 'phone');
      assert.equal(r.extractedMaxPrice, 300);
    });

    it('extracts maxPrice from "cheaper than"', () => {
      const r = preprocessSearchQuery('tablet cheaper than 400');
      assert.equal(r.cleanedQuery, 'tablet');
      assert.equal(r.extractedMaxPrice, 400);
    });

    it('extracts maxPrice from "at most"', () => {
      const r = preprocessSearchQuery('watch at most 200');
      assert.equal(r.cleanedQuery, 'watch');
      assert.equal(r.extractedMaxPrice, 200);
    });

    it('extracts maxPrice from "budget"', () => {
      const r = preprocessSearchQuery('budget 500 monitor');
      assert.equal(r.cleanedQuery, 'monitor');
      assert.equal(r.extractedMaxPrice, 500);
    });

    it('extracts maxPrice from "max"', () => {
      const r = preprocessSearchQuery('max 50 keyboard');
      assert.equal(r.cleanedQuery, 'keyboard');
      assert.equal(r.extractedMaxPrice, 50);
    });

    it('extracts minPrice from "above"', () => {
      const r = preprocessSearchQuery('camera above 200');
      assert.equal(r.cleanedQuery, 'camera');
      assert.equal(r.extractedMinPrice, 200);
    });

    it('extracts minPrice from "over"', () => {
      const r = preprocessSearchQuery('speakers over 100');
      assert.equal(r.cleanedQuery, 'speakers');
      assert.equal(r.extractedMinPrice, 100);
    });

    it('extracts minPrice from "more than"', () => {
      const r = preprocessSearchQuery('more than 50 headphones');
      assert.equal(r.cleanedQuery, 'headphones');
      assert.equal(r.extractedMinPrice, 50);
    });

    it('extracts minPrice from "at least"', () => {
      const r = preprocessSearchQuery('tv at least 1000');
      assert.equal(r.cleanedQuery, 'tv');
      assert.equal(r.extractedMinPrice, 1000);
    });

    it('extracts minPrice from "minimum"', () => {
      const r = preprocessSearchQuery('minimum 300 gpu');
      assert.equal(r.cleanedQuery, 'gpu');
      assert.equal(r.extractedMinPrice, 300);
    });

    it('extracts range from "between X and Y"', () => {
      const r = preprocessSearchQuery('shoes between 50 and 100 dollars');
      assert.equal(r.cleanedQuery, 'shoes');
      assert.equal(r.extractedMinPrice, 50);
      assert.equal(r.extractedMaxPrice, 100);
    });

    it('extracts range with dollar signs', () => {
      const r = preprocessSearchQuery('laptop between $800 and $1200');
      assert.equal(r.cleanedQuery, 'laptop');
      assert.equal(r.extractedMinPrice, 800);
      assert.equal(r.extractedMaxPrice, 1200);
    });

    it('extracts range from "from X to Y"', () => {
      const r = preprocessSearchQuery('from 10 to 20 dollars books');
      assert.equal(r.cleanedQuery, 'books');
      assert.equal(r.extractedMinPrice, 10);
      assert.equal(r.extractedMaxPrice, 20);
    });

    it('handles commas in numbers', () => {
      const r = preprocessSearchQuery('car under 1,500');
      assert.equal(r.cleanedQuery, 'car');
      assert.equal(r.extractedMaxPrice, 1500);
    });
  });

  describe('explicit params override extracted', () => {
    it('cleans text but does not extract maxPrice when explicit param provided', () => {
      const r = preprocessSearchQuery('headphones under 50', undefined, 30);
      assert.equal(r.cleanedQuery, 'headphones');
      assert.equal(r.extractedMaxPrice, undefined);
    });

    it('cleans text but does not extract minPrice when explicit param provided', () => {
      const r = preprocessSearchQuery('camera above 200', 500);
      assert.equal(r.cleanedQuery, 'camera');
      assert.equal(r.extractedMinPrice, undefined);
    });

    it('does not extract range when explicit prices provided', () => {
      const r = preprocessSearchQuery('shoes between 50 and 100', 10, 200);
      assert.equal(r.cleanedQuery, 'shoes');
      assert.equal(r.extractedMinPrice, undefined);
      assert.equal(r.extractedMaxPrice, undefined);
    });
  });

  describe('sort intent detection', () => {
    it('detects price_asc from "cheapest"', () => {
      const r = preprocessSearchQuery('cheapest headphones');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('detects price_asc from "cheap"', () => {
      const r = preprocessSearchQuery('cheap monitor');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('detects price_asc from "cheaper"', () => {
      const r = preprocessSearchQuery('cheaper tv');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('detects price_asc from "lowest price"', () => {
      const r = preprocessSearchQuery('lowest price tv');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('detects price_asc from "least expensive"', () => {
      const r = preprocessSearchQuery('least expensive laptop');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('detects price_desc from "most expensive"', () => {
      const r = preprocessSearchQuery('most expensive watch');
      assert.equal(r.sortIntent, 'price_desc');
    });

    it('detects price_desc from "highest price"', () => {
      const r = preprocessSearchQuery('highest price camera');
      assert.equal(r.sortIntent, 'price_desc');
    });

    it('detects rating_desc from "best"', () => {
      const r = preprocessSearchQuery('best laptop');
      assert.equal(r.sortIntent, 'rating_desc');
    });

    it('detects rating_desc from "top rated"', () => {
      const r = preprocessSearchQuery('top rated headphones');
      assert.equal(r.sortIntent, 'rating_desc');
    });

    it('detects rating_desc from "highest rated"', () => {
      const r = preprocessSearchQuery('highest rated monitor');
      assert.equal(r.sortIntent, 'rating_desc');
    });

    it('detects rating_desc from "popular"', () => {
      const r = preprocessSearchQuery('popular gaming chair');
      assert.equal(r.sortIntent, 'rating_desc');
    });
  });

  describe('query cleaning', () => {
    it('removes "buy" from query', () => {
      const r = preprocessSearchQuery('buy iphone 15');
      assert.equal(r.cleanedQuery, 'iphone 15');
    });

    it('removes multiple noise words', () => {
      const r = preprocessSearchQuery('find cheap laptop on sale');
      assert.equal(r.cleanedQuery, 'laptop');
    });

    it('removes price literals like "$50"', () => {
      const r = preprocessSearchQuery('$50 headphones');
      assert.equal(r.cleanedQuery, 'headphones');
    });

    it('removes "50 dollars" pattern', () => {
      const r = preprocessSearchQuery('headphones 50 dollars');
      assert.equal(r.cleanedQuery, 'headphones');
    });

    it('removes stop words like "for"', () => {
      const r = preprocessSearchQuery('laptop for programming');
      assert.equal(r.cleanedQuery, 'laptop programming');
    });

    it('removes cheap and detects sort intent', () => {
      const r = preprocessSearchQuery('cheap headphones');
      assert.equal(r.cleanedQuery, 'headphones');
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('does not mangle product model numbers', () => {
      const r = preprocessSearchQuery('iphone 15 pro max');
      assert.equal(r.cleanedQuery, 'iphone 15 pro max');
    });

    it('strips standalone punctuation', () => {
      const r = preprocessSearchQuery('gaming mouse !!!');
      assert.equal(r.cleanedQuery, 'gaming mouse');
    });
  });

  describe('combined scenarios', () => {
    it('extracts prices and sort intent simultaneously', () => {
      const r = preprocessSearchQuery('cheapest headphones under 50 dollars');
      assert.equal(r.cleanedQuery, 'headphones');
      assert.equal(r.extractedMaxPrice, 50);
      assert.equal(r.sortIntent, 'price_asc');
    });

    it('extracts range and removes noise', () => {
      const r = preprocessSearchQuery('buy laptop between 500 and 1000');
      assert.equal(r.cleanedQuery, 'laptop');
      assert.equal(r.extractedMinPrice, 500);
      assert.equal(r.extractedMaxPrice, 1000);
    });

    it('handles best + price', () => {
      const r = preprocessSearchQuery('best monitor under 300');
      assert.equal(r.cleanedQuery, 'monitor');
      assert.equal(r.extractedMaxPrice, 300);
      assert.equal(r.sortIntent, 'rating_desc');
    });

    it('most expensive with price range', () => {
      const r = preprocessSearchQuery('most expensive shoes over 200');
      assert.equal(r.cleanedQuery, 'shoes');
      assert.equal(r.extractedMinPrice, 200);
      assert.equal(r.sortIntent, 'price_desc');
    });
  });

  describe('country extraction from NL', () => {
    it('extracts country from "in Singapore"', () => {
      const r = preprocessSearchQuery('laptop in Singapore');
      assert.equal(r.extractedCountryCode, 'SG');
      assert.equal(r.cleanedQuery, 'laptop');
    });

    it('extracts country from "in US"', () => {
      const r = preprocessSearchQuery('headphones in US');
      assert.equal(r.extractedCountryCode, 'US');
      assert.equal(r.cleanedQuery, 'headphones');
    });

    it('extracts country from "in malaysia"', () => {
      const r = preprocessSearchQuery('shoes in malaysia');
      assert.equal(r.extractedCountryCode, 'MY');
      assert.equal(r.cleanedQuery, 'shoes');
    });

    it('extracts country from "for us"', () => {
      const r = preprocessSearchQuery('monitor for us');
      assert.equal(r.extractedCountryCode, 'US');
      assert.equal(r.cleanedQuery, 'monitor');
    });

    it('extracts country from "for Thailand"', () => {
      const r = preprocessSearchQuery('fans for Thailand');
      assert.equal(r.extractedCountryCode, 'TH');
      assert.equal(r.cleanedQuery, 'fans');
    });

    it('does not extract when NL mentions country but explicit country provided', () => {
      const r = preprocessSearchQuery('laptop in Singapore', undefined, undefined, 'MY');
      assert.equal(r.extractedCountryCode, undefined);
    });

    it('does not extract country for non-country words after "in"', () => {
      const r = preprocessSearchQuery('wireless in ear headphones');
      assert.equal(r.extractedCountryCode, undefined);
    });

    it('combines price + country extraction', () => {
      const r = preprocessSearchQuery('best laptop under 1000 in Singapore');
      assert.equal(r.cleanedQuery, 'laptop');
      assert.equal(r.extractedMaxPrice, 1000);
      assert.equal(r.extractedCountryCode, 'SG');
      assert.equal(r.sortIntent, 'rating_desc');
    });
  });
});
