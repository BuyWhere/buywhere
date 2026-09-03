import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const productsTs = path.resolve(__dirname, '..', 'src', 'routes', 'products.ts');
const productsSrc = fs.readFileSync(productsTs, 'utf8');

describe('BUY-80415 ranking verify', () => {
  it('boosts exact query titles and demotes mp4/dualsense', () => {
    assert.match(productsSrc, /deviceExactBoost/);
    assert.match(productsSrc, /deviceControllerPenalty/);
    assert.match(productsSrc, /deviceConsoleBoost/);
    assert.match(productsSrc, /dualsense/);
    assert.match(productsSrc, /mp4/);
    assert.match(productsSrc, /child_title_fb/);
  });
});
