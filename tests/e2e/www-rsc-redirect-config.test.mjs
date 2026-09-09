import assert from 'node:assert/strict';
import test from 'node:test';
import nextConfig from '../../next.config.mjs';

test('www canonical redirect excludes RSC prefetch requests', async () => {
  const redirects = await nextConfig.redirects();
  const redirect = redirects.find((entry) =>
    entry.source === '/:path*' &&
    entry.destination === 'https://buywhere.ai/:path*' &&
    entry.has?.some((condition) => condition.type === 'host' && condition.value === 'www.buywhere.ai')
  );

  assert.ok(redirect, 'www.buywhere.ai canonical redirect exists');
  assert.deepEqual(redirect.missing, [
    { type: 'header', key: 'rsc', value: '1' },
    { type: 'query', key: '_rsc' },
  ]);
});
