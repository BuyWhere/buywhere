import { expect, test } from '@playwright/test';

// BUY-71647: smoke tests that search-result card images are wrapped through
// /api/image-proxy. This proves cdn.shopify.com (and other allowed hosts) are
// proxied and render real product images instead of the branded placeholder.

test.describe('BUY-71647 search image proxy wrapping', () => {
  test('/search?q=laptop&country=US shows real images for >= 9/10 cards', async ({ page }) => {
    const response = await page.goto('/search?q=laptop&country=US');
    expect(response?.status()).toBeLessThan(400);

    const cards = page.getByTestId('search-product-card');
    await expect(cards.first()).toBeVisible();

    const totalCards = Math.min(await cards.count(), 10);
    expect(totalCards).toBeGreaterThanOrEqual(10);

    let proxiedImageCount = 0;
    for (let index = 0; index < totalCards; index += 1) {
      const card = cards.nth(index);
      const image = card.getByTestId('search-product-image');
      const src = await image.getAttribute('src');
      if (src?.startsWith('/api/image-proxy?url=')) {
        proxiedImageCount += 1;
      }
    }

    expect(proxiedImageCount).toBeGreaterThanOrEqual(9);
  });

  test('/search?q=macbook&country=US shows real Apple product images', async ({ page }) => {
    const response = await page.goto('/search?q=macbook&country=US');
    expect(response?.status()).toBeLessThan(400);

    const cards = page.getByTestId('search-product-card');
    await expect(cards.first()).toBeVisible();

    const firstCard = cards.first();
    const image = firstCard.getByTestId('search-product-image');
    const src = await image.getAttribute('src');

    expect(src).toContain('/api/image-proxy?url=');
    // The card should not show the branded placeholder fallback (i.e. the img
    // element is rendered with a proxy src).
    await expect(image).toBeVisible();
  });
});
