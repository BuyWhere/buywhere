import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-81155: US search must not leak foreign merchants', () => {
  it('hard-filters country_code and excludes PH/IN storefronts', () => {
    assert.match(
      productsSource,
      /if \(countryCode\) \{\s*\/\/ Explicit country_code is a HARD filter[\s\S]*?baseConditions\.push\(`country_code = \$\$\{baseIdx\}`\)/,
    );
    assert.doesNotMatch(productsSource, /country_code = \$\$\{baseIdx\} OR country_code IS NULL/);
    assert.match(productsSource, /datablitz\.com\.ph/);
    assert.match(productsSource, /boat-lifestyle\.com/);
    assert.match(productsSource, /NOT ILIKE '%\.com\.ph'/);
    assert.match(productsSource, /NOT ILIKE '%\.co\.in'/);
  });

  it('keeps exact foreign storefront denylist entries on both search paths', () => {
    const tierDenylist = /sp\.merchant_id NOT IN \('boat-lifestyle\.com','www\.boat-lifestyle\.com','datablitz\.com\.ph','www\.datablitz\.com\.ph'\)/;
    const archiveDenylist = /merchant_id NOT IN \('boat-lifestyle\.com','www\.boat-lifestyle\.com','datablitz\.com\.ph','www\.datablitz\.com\.ph'\)/;

    assert.match(productsSource, tierDenylist);
    assert.match(productsSource, archiveDenylist);
  });
});
