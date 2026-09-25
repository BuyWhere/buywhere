// Regression test for BUY-73666 / BUY-75955: search_products must honor deliver_to
// as the buyer-market filter. Without this, MCP clients (incl. Atlas cycle)
// passing deliver_to="US" receive SG rows because the country_code/country path
// was used instead. Mirrors the same test in api/tests/, but asserts against
// the mcp-railway copy of the file (mcp.buywhere.ai is the canonical MCP).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('src/routes/mcp.ts', 'utf8');

// Locate the search_products handler body (the `const rawCountry` line is unique
// — no other tool handler in this file uses "rawCountry").
const rawCountryLine = src.match(/^  const rawCountry = .*$/m);
assert.ok(rawCountryLine, 'search_products rawCountry extraction line not found');
const handlerBody = rawCountryLine[0];

test('search_products rawCountry extraction includes deliver_to', () => {
  assert.match(
    handlerBody,
    /args\.deliver_to/,
    'expected search_products country extraction to read args.deliver_to',
  );
});

test('search_products country precedence is deliver_to > country_code > country', () => {
  const dtIdx = handlerBody.indexOf('args.deliver_to');
  const ccIdx = handlerBody.indexOf('args.country_code');
  const countryMatches = [
    ...handlerBody.matchAll(/(?<!_code\.)args\.country\b/g),
  ];
  assert.equal(countryMatches.length, 1, 'expected exactly one args.country (alias) reference');
  const cIdx = countryMatches[0].index;
  assert.ok(dtIdx < ccIdx, `deliver_to must precede country_code (dt=${dtIdx}, cc=${ccIdx})`);
  assert.ok(ccIdx < cIdx, `country_code must precede country (cc=${ccIdx}, c=${cIdx})`);
});

test('search_products hasExplicitCountry includes deliver_to', () => {
  const hasExplicitCountryLine = src.match(/^  const hasExplicitCountry = .*$/m);
  assert.ok(hasExplicitCountryLine, 'hasExplicitCountry line not found');
  assert.match(
    hasExplicitCountryLine[0],
    /args\.deliver_to/,
    'expected hasExplicitCountry to consider deliver_to',
  );
});