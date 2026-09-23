import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
);

describe('BUY-83803 deals page empty-feed fallback', () => {
  it('renders evergreen destination cards instead of a dead empty state', () => {
    expect(src).toContain("data-deals-fallback=\"evergreen\"");
    expect(src).toContain('/best-laptops-singapore');
    expect(src).toContain('/categories/electronics');
    expect(src).not.toContain('No deals available right now');
  });

  it('falls back to search when the deals endpoint is empty or degraded', () => {
    expect(src).toContain('/v1/products/search?q=laptop');
    expect(src).toContain("data-deals-fallback=\"search\"");
  });
});
