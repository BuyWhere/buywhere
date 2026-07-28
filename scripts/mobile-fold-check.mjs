import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:52000';
const SEARCH_PATH = '/search?q=wireless%20headphones&country=us';
const MAX_FIRST_CARD_TOP = 600;

const products = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  name: `Wireless headphones ${index + 1}`,
  price_amount: 99 + index,
  price_currency: 'USD',
  merchant_name: 'Example Shop',
  image_url: `https://example.com/headphones-${index + 1}.jpg`,
  click_url: `https://example.com/products/${index + 1}`,
  brand: 'Example',
  category: 'Headphones',
}));

async function preparePage(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.route('**/api/products/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: products, total: products.length, has_more: false }),
    });
  });

  await page.goto(`${BASE_URL}${SEARCH_PATH}`, { waitUntil: 'networkidle' });
  await page.getByTestId('search-product-card').first().waitFor();
  return { context, page };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });

try {
  const mobile = await preparePage(browser, { width: 390, height: 844 });
  const mobileSummary = mobile.page.getByTestId('search-mobile-summary');
  const refine = mobile.page.getByTestId('search-refine');
  const editor = mobile.page.getByTestId('search-editor');
  const desktopHero = mobile.page.getByTestId('search-desktop-hero');
  const desktopToolbar = mobile.page.getByTestId('search-desktop-toolbar');
  const firstCard = mobile.page.getByTestId('search-product-card').first();
  const firstCardRect = await firstCard.boundingBox();

  assert(await mobileSummary.isVisible(), 'Mobile search summary must be visible');
  assert(!(await editor.isVisible()), 'Mobile search editor must be collapsed by default');
  assert(!(await desktopHero.isVisible()), 'Desktop hero must be hidden on mobile');
  assert(!(await desktopToolbar.isVisible()), 'Desktop results toolbar must be hidden on mobile');
  assert(firstCardRect, 'First product card must render');
  assert(
    firstCardRect.y <= MAX_FIRST_CARD_TOP,
    `First product card starts at ${firstCardRect.y}px; expected <= ${MAX_FIRST_CARD_TOP}px`,
  );

  await refine.locator('summary').click();
  assert(await editor.isVisible(), 'Refine search must reveal the editor');
  assert(await mobile.page.getByLabel('Search products').isVisible(), 'Search input must remain accessible');
  assert(await mobile.page.getByLabel('Country selector').isVisible(), 'Country selector must remain accessible');

  const mobileSnapshot = {
    viewport: { width: 390, height: 844 },
    firstCardTop: firstCardRect.y,
    visibleCardPixels: 844 - firstCardRect.y,
    summaryText: await mobileSummary.innerText(),
    refineOpen: await refine.evaluate((element) => element.open),
  };
  await mobile.context.close();

  const desktop = await preparePage(browser, { width: 1280, height: 900 });
  assert(await desktop.page.getByTestId('search-desktop-hero').isVisible(), 'Desktop hero must remain visible');
  assert(await desktop.page.getByTestId('search-editor').isVisible(), 'Desktop search editor must remain visible');
  assert(await desktop.page.getByTestId('search-desktop-toolbar').isVisible(), 'Desktop results toolbar must remain visible');
  assert(!(await desktop.page.getByTestId('search-mobile-summary').isVisible()), 'Mobile summary must be hidden on desktop');
  await desktop.context.close();

  console.log(JSON.stringify({ passed: true, mobile: mobileSnapshot, desktop: { width: 1280, height: 900 } }, null, 2));
} finally {
  await browser.close();
}
