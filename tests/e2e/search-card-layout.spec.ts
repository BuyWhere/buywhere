import { expect, test } from '@playwright/test';

test.describe('Search result card layout', () => {
  test('keeps every product image inside its media frame', async ({ page }) => {
    const response = await page.goto('/search?q=wireless%20headphones&country=us');
    expect(response?.status()).toBeLessThan(400);

    const cards = page.getByTestId('search-product-card');
    await expect(cards.first()).toBeVisible();

    const visibleCardCount = Math.min(await cards.count(), 8);
    expect(visibleCardCount).toBeGreaterThanOrEqual(4);

    for (let index = 0; index < visibleCardCount; index += 1) {
      const card = cards.nth(index);
      const media = card.getByTestId('search-product-media');
      const details = card.getByTestId('search-product-details');
      const image = media.locator('img');

      await expect(media).toHaveCSS('overflow', 'hidden');
      await expect(details.getByRole('heading')).toBeVisible();
      await expect(details.getByRole('img')).toBeVisible();
      await expect(details.getByText('Shop', { exact: true })).toBeVisible();
      await expect(details.getByText('View Deal', { exact: true })).toBeVisible();

      const imageCount = await image.count();
      const [mediaBox, detailsBox, imageBox] = await Promise.all([
        media.boundingBox(),
        details.boundingBox(),
        imageCount > 0 ? image.boundingBox() : Promise.resolve(null),
      ]);

      expect(mediaBox).not.toBeNull();
      expect(detailsBox).not.toBeNull();
      expect(detailsBox!.y).toBeGreaterThanOrEqual(mediaBox!.y + mediaBox!.height - 1);

      if (imageBox) {
        expect(imageBox.x).toBeGreaterThanOrEqual(mediaBox!.x - 1);
        expect(imageBox.y).toBeGreaterThanOrEqual(mediaBox!.y - 1);
        expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(mediaBox!.x + mediaBox!.width + 1);
        expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(mediaBox!.y + mediaBox!.height + 1);
      }
    }
  });
});
