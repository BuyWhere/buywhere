#!/usr/bin/env node
/**
 * Atlas probe BUY-79591: XOR between request deliver_to and diagnostic.deliver_to_present.
 *
 * present param ⇒ diagnostic.deliver_to_present === true
 * omitted param ⇒ diagnostic.deliver_to_present === false
 *
 * Usage:
 *   API_BASE=https://api.buywhere.ai API_KEY=... node scripts/atlas-buy-79591-deliver-to-present.mjs
 */
const API_BASE = (process.env.API_BASE || 'https://api.buywhere.ai').replace(/\/$/, '');
const API_KEY = process.env.API_KEY || process.env.BUYWHERE_API_KEY || '';
const Q = 'zzzznonexistentsku999xyz';

async function getSearch(qs) {
  const url = `${API_BASE}/v1/products/search?${qs}`;
  const res = await fetch(url, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
  });
  const body = await res.json();
  return { status: res.status, body };
}

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exitCode = 1;
}

async function main() {
  const present = await getSearch(`q=${encodeURIComponent(Q)}&deliver_to=SG`);
  const omitted = await getSearch(`q=${encodeURIComponent(Q)}`);
  const invalid = await getSearch(`q=${encodeURIComponent(Q)}&deliver_to=XX`);

  console.log(JSON.stringify({
    present: { status: present.status, meta: present.body?.meta },
    omitted: { status: omitted.status, meta: omitted.body?.meta },
    invalid: { status: invalid.status, meta: invalid.body?.meta },
  }, null, 2));

  if (present.status !== 200) fail(`present status ${present.status}`);
  if (present.body?.meta?.deliver_to !== 'SG') fail(`present meta.deliver_to=${present.body?.meta?.deliver_to}`);
  if (present.body?.meta?.diagnostic?.deliver_to_present !== true) {
    fail(`XOR: deliver_to=SG but diagnostic.deliver_to_present=${present.body?.meta?.diagnostic?.deliver_to_present}`);
  }
  if (present.body?.meta?.emptiness_reason === 'deliver_to_missing') {
    fail('present emptiness_reason must not be deliver_to_missing');
  }

  if (omitted.status !== 200) fail(`omitted status ${omitted.status}`);
  if (omitted.body?.meta?.diagnostic?.deliver_to_present !== false) {
    fail(`XOR: omitted deliver_to but diagnostic.deliver_to_present=${omitted.body?.meta?.diagnostic?.deliver_to_present}`);
  }

  if (invalid.status !== 200) fail(`invalid status ${invalid.status}`);
  if (invalid.body?.meta?.diagnostic?.deliver_to_present !== true) {
    fail(`XOR: deliver_to=XX present but diagnostic.deliver_to_present=${invalid.body?.meta?.diagnostic?.deliver_to_present}`);
  }
  if (invalid.body?.meta?.emptiness_reason !== 'region_unsupported') {
    fail(`invalid emptiness_reason=${invalid.body?.meta?.emptiness_reason}`);
  }

  if (!process.exitCode) console.log('PASS BUY-79591 XOR deliver_to_present');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
