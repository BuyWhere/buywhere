import { test, expect } from '@playwright/test';

const publicRoutes = [
  '/',
  '/compare',
  '/api-keys',
  '/partners',
  '/challenge',
  '/blog',
];

test.describe('skip-link target parity', () => {
  for (const route of publicRoutes) {
    test(`${route} has skip-link targets`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);

      const skipLink = page.getByRole('link', { name: /skip to main content/i });
      await expect(skipLink).toHaveAttribute('href', '#main-content');

      await expect(page.locator('#main-navigation')).toHaveCount(1);
      await expect(page.locator('#main-content')).toHaveCount(1);
    });
  }

  test('keyboard skip link moves focus to the main content region', async ({ page }) => {
    await page.goto('/compare');

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: /skip to main content/i });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
});
