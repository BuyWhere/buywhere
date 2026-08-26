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
      // BUY-68743: the redundant "Shop ↗" pill at the top of the card was
      // dropped so the merchant badge is the only top label and "View Deal"
      // is the sole CTA at the bottom of the card.
      await expect(details.getByText('View Deal', { exact: true })).toBeVisible();
      await expect(details.getByText('Shop', { exact: true })).toHaveCount(0);

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

  // BUY-74687: parent card must have a discernible accessible name composed
  // from the product title + merchant, and the clamped <h2> must expose the
  // full title via title= + aria-label= so SR/hover users don't lose the
  // truncated spec info.
  test('exposes title, aria-label, and composed card accessible name', async ({ page }) => {
    const response = await page.goto('/search?q=laptop%20singapore&country=sg');
    expect(response?.status()).toBeLessThan(400);

    const cards = page.getByTestId('search-product-card');
    await expect(cards.first()).toBeVisible();
    const cardCount = Math.min(await cards.count(), 8);
    expect(cardCount).toBeGreaterThanOrEqual(1);

    for (let index = 0; index < cardCount; index += 1) {
      const card = cards.nth(index);
      const heading = card.getByRole('heading').first();

      const headingText = (await heading.textContent())?.trim() ?? '';
      expect(headingText.length).toBeGreaterThan(0);

      await expect(heading).toHaveAttribute('title', headingText);
      await expect(heading).toHaveAttribute('aria-label', headingText);

      const cardAccessibleName = await card.evaluate((el) => {
        const label = el.getAttribute('aria-label');
        if (label) return label;
        // Fallback: derive the accessible name the same way AT computes it.
        const headingEl = el.querySelector('h2,h3,[role="heading"]');
        const headingText = headingEl?.textContent?.trim() ?? '';
        return headingText;
      });
      expect(cardAccessibleName.length).toBeGreaterThan(headingText.length);
      expect(cardAccessibleName).toContain(headingText);
      expect(cardAccessibleName.toLowerCase()).toContain('view deal');
    }
  });
});
