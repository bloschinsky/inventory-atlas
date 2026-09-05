import { expect, test } from '@playwright/test';
test('renders the Foundation application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Inventory Atlas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
