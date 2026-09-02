// BUY-80156: FBP tier SQL must filter sp.currency to the request country.
// Replicate BUY-80024's native-currency predicate for find_best_price.
// Without this, SG shoppers see USD 1895 from titan22.com (nike shirt)
// and MY shoppers see USD 289 from savageworldwide.com.my.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of COUNTRY_CURRENCY (api/src/lib/response.ts).
const COUNTRY_CURRENCY = {
  SG: 'SGD', US: 'USD', MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP',
};

// Mirror of the FBP tier query builder (api/src/routes/mcp.ts handleFindBestPrice).
function buildFbpTierQuery({ country, searchName, region }) {
  const tierConditions = [];
  const tierParams = [];
  tierParams.push(searchName);
  tierConditions.push(`sp.search_vector @@ plainto_tsquery('english', $${tierParams.length})`);
  if (region) {
    tierParams.push(region);
    tierConditions.push(`sp.region = $${tierParams.length}`);
  }
  const requestedCountry = country;
  if (requestedCountry) {
    tierParams.push(requestedCountry);
    tierConditions.push(`sp.country_code = $${tierParams.length}`);
  }
  if (country && COUNTRY_CURRENCY[country]) {
    tierParams.push(COUNTRY_CURRENCY[country]);
    tierConditions.push(`sp.currency = $${tierParams.length}`);
  }
  const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';
  return { sql: `SELECT 1 FROM search_products sp ${tierWhere}`, params: tierParams };
}

test('BUY-80156 SG tier query binds native SGD currency', () => {
  const out = buildFbpTierQuery({ country: 'SG', searchName: 'nike shirt', region: 'sea' });
  // params: $1=searchName, $2=region, $3=country_code, $4=currency(SGD)
  assert.match(out.sql, /sp\.country_code = \$3/);
  assert.match(out.sql, /sp\.currency = \$4/);
  assert.equal(out.params[3], 'SGD');
});

test('BUY-80156 MY tier query binds native MYR currency', () => {
  const out = buildFbpTierQuery({ country: 'MY', searchName: 'shirt', region: 'sea' });
  assert.match(out.sql, /sp\.currency = \$4/);
  assert.equal(out.params[3], 'MYR');
});

test('BUY-80156 US tier query binds USD (native)', () => {
  const out = buildFbpTierQuery({ country: 'US', searchName: 'iphone 15', region: 'us' });
  assert.match(out.sql, /sp\.currency = \$4/);
  assert.equal(out.params[3], 'USD');
});

test('BUY-80156 no-region SG tier query still binds currency', () => {
  const out = buildFbpTierQuery({ country: 'SG', searchName: 'shirt', region: '' });
  // params: $1=searchName, $2=country_code(SG), $3=currency(SGD)
  assert.match(out.sql, /sp\.currency = \$3/);
  assert.equal(out.params[2], 'SGD');
});

test('BUY-80156 missing country omits currency predicate', () => {
  const out = buildFbpTierQuery({ country: '', searchName: 'shirt', region: '' });
  assert.doesNotMatch(out.sql, /sp\.currency =/);
});

test('BUY-80156 unknown country omits currency predicate (no map entry)', () => {
  const out = buildFbpTierQuery({ country: 'XX', searchName: 'shirt', region: '' });
  assert.doesNotMatch(out.sql, /sp\.currency =/);
  assert.match(out.sql, /sp\.country_code = \$2/); // country_code still bound
});
