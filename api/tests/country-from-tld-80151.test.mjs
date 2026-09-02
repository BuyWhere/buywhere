import assert from 'node:assert/strict';
import { countryFromHostOrDomain, countryOrDefault } from '../src/lib/countryFromTld.ts';

assert.equal(countryFromHostOrDomain('smhome.ph'), 'PH');
assert.equal(countryFromHostOrDomain('beautybar.com.ph'), 'PH');
assert.equal(countryFromHostOrDomain('https://www.shopsuki.ph/products/x'), 'PH');
assert.equal(countryFromHostOrDomain('php.com.tw'), null);
assert.equal(countryFromHostOrDomain('phpunit.de'), null);
assert.equal(countryFromHostOrDomain('nphplumbingandheating.co.uk'), 'GB');
assert.equal(countryOrDefault(undefined, 'acehardware.ph'), 'PH');
assert.equal(countryOrDefault('SG', 'acehardware.ph'), 'SG');
assert.equal(countryOrDefault(undefined, 'example.com'), 'SG');
console.log('country-from-tld-80151 ok');
