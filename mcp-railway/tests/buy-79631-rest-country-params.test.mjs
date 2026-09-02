// BUY-79631: country-mode REST fallback must NOT send deliver_to
// (country+deliver_to empties shirt SG; bare country= returns SGD).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function restSearchQueryParams(opts) {
  const params = new URLSearchParams();
  params.set('q', opts.q);
  if (opts.country) {
    if (opts.mode === 'market') {
      params.set('market', opts.country);
      params.set('deliver_to', opts.country);
    } else {
      params.set('country', opts.country);
    }
  }
  params.set('limit', String(Math.min(Math.max(opts.limit * 4, 1), 40)));
  if (opts.offset) params.set('offset', String(opts.offset));
  return params;
}

describe('BUY-79631 REST country retry params', () => {
  it('country mode sets country= and omits deliver_to', () => {
    const p = restSearchQueryParams({ q: 'shirt', country: 'SG', limit: 5, offset: 0, mode: 'country' });
    assert.equal(p.get('q'), 'shirt');
    assert.equal(p.get('country'), 'SG');
    assert.equal(p.get('deliver_to'), null);
    assert.equal(p.get('market'), null);
  });

  it('market mode keeps market+deliver_to for recall', () => {
    const p = restSearchQueryParams({ q: 'laptop', country: 'SG', limit: 5, offset: 0, mode: 'market' });
    assert.equal(p.get('market'), 'SG');
    assert.equal(p.get('deliver_to'), 'SG');
    assert.equal(p.get('country'), null);
  });
});
