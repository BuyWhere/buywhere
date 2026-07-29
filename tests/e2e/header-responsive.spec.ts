import { test, expect } from '@playwright/test';

/**
 * BUY-65159 regression: tablet/mobile responsive header.
 *
 * At both 768x1024 and 390x844 the header must:
 *   - render exactly one visible "Open menu" trigger,
 *   - not horizontally overflow the viewport,
 *   - keep the brand mark visually distinct from a hamburger icon
 *     (no three-line glyph inside the logo <svg>).
 */

const HEADER_NAV_LOGO_LINES_RE = /M7\s*10h14|M9\s*7v14/;

async function inspect(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const openMenuCount = await page
    .locator('button[aria-label="Open menu"], button[aria-label="Close menu"]')
    .filter({ has: page.locator(':visible') })
    .count();
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  const brandLogoPath = await page
    .locator('a[aria-label="BuyWhere Home"] svg path')
    .first()
    .getAttribute('d')
    .catch(() => null);
  return { openMenuCount, docOverflow, brandLogoPath };
}

test.describe('BUY-65159 responsive header', () => {
  test('768x1024 tablet shows exactly one menu trigger and no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await ctx.newPage();
    const { openMenuCount, docOverflow, brandLogoPath } = await inspect(page);
    expect(openMenuCount).toBe(1);
    expect(docOverflow).toBeLessThanOrEqual(0);
    // Brand mark must not be the legacy hamburger three-line glyph.
    expect(brandLogoPath).not.toMatch(/M7\s*10h14/);
    expect(brandLogoPath).toMatch(HEADER_NAV_LOGO_LINES_RE);
    await ctx.close();
  });

  test('390x844 mobile shows exactly one menu trigger and no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const { openMenuCount, docOverflow, brandLogoPath } = await inspect(page);
    expect(openMenuCount).toBe(1);
    expect(docOverflow).toBeLessThanOrEqual(0);
    expect(brandLogoPath).not.toMatch(/M7\s*10h14/);
    expect(brandLogoPath).toMatch(HEADER_NAV_LOGO_LINES_RE);
    await ctx.close();
  });
});