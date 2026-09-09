import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BuyWhereTools, BuyWhereClient } from '../dist/index.js';

describe('@buywhere/openai-tools', () => {
  it('exports BuyWhereTools with 5 function definitions', () => {
    assert.ok(Array.isArray(BuyWhereTools));
    assert.equal(BuyWhereTools.length, 5);
    const names = BuyWhereTools.map((t) => t.function.name);
    assert.deepEqual(names, ['search_products', 'get_product', 'compare_products', 'get_deals', 'list_categories']);
  });

  it('each tool has type "function" and required schema fields', () => {
    for (const tool of BuyWhereTools) {
      assert.equal(tool.type, 'function');
      assert.ok(typeof tool.function.name === 'string');
      assert.ok(tool.function.name.length > 0);
      assert.ok(typeof tool.function.description === 'string');
      assert.ok(tool.function.parameters.type === 'object');
    }
  });

  it('search_products requires q parameter', () => {
    const search = BuyWhereTools.find((t) => t.function.name === 'search_products');
    assert.ok(search);
    assert.ok(search.function.parameters.required?.includes('q'));
  });

  it('get_product requires id parameter', () => {
    const tool = BuyWhereTools.find((t) => t.function.name === 'get_product');
    assert.ok(tool);
    assert.ok(tool.function.parameters.required?.includes('id'));
  });

  it('compare_products requires ids parameter', () => {
    const tool = BuyWhereTools.find((t) => t.function.name === 'compare_products');
    assert.ok(tool);
    assert.ok(tool.function.parameters.required?.includes('ids'));
  });

  it('BuyWhereClient constructor accepts string apiKey', () => {
    const client = new BuyWhereClient('test-key');
    assert.ok(client instanceof BuyWhereClient);
  });

  it('BuyWhereClient constructor accepts config object', () => {
    const client = new BuyWhereClient({ apiKey: 'test-key', baseUrl: 'https://example.com' });
    assert.ok(client instanceof BuyWhereClient);
  });

  it('dispatch throws for unknown function', async () => {
    const client = new BuyWhereClient('test-key');
    await assert.rejects(
      () => client.dispatch({ function: { name: 'unknown_func', arguments: '{}' } }),
      { message: /Unknown function/ }
    );
  });
});
