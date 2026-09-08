import { expect, test } from '@playwright/test';
test('renders the Foundation application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Inventory Atlas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('renders the authentication and invitation acceptance flows', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  await page.goto(`/auth/invitations/accept?token=${'i'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Accept invitation' })).toBeVisible();
  await expect(page.getByLabel('Invitation token')).toHaveValue('i'.repeat(43));
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
});

test('starts in English and persists an anonymous switch to Ukrainian without restart', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('inventory-atlas.locale'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('locale-selector').click();
  await page.getByRole('option', { name: 'Ukrainian' }).click();
  await expect(page.getByRole('heading', { name: 'Головна' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Головна' })).toBeVisible();
});

test('a Ukrainian browser suggests Ukrainian but keeps English as the default', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'uk-UA' });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.getByTestId('locale-selector').click();
  await expect(page.getByRole('option', { name: 'Ukrainian (suggested)' })).toBeVisible();
  await context.close();
});

test('persists an authenticated locale choice through the profile endpoint', async ({ page }) => {
  let persistedLocale = 'en';
  await page.route('**/api/v1/auth/me/locale', async (route) => {
    persistedLocale = route.request().postDataJSON().locale;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: '0198f40c-92f3-7a12-bc9a-653f97786c2c',
        displayName: 'Synthetic Owner',
        email: 'owner@example.test',
        locale: persistedLocale,
        role: 'owner',
        permissions: [],
      }),
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: '0198f40c-92f3-7a12-bc9a-653f97786c2b',
        csrfToken: 'c'.repeat(43),
        idleExpiresAt: '2026-09-08T18:30:00.000Z',
        absoluteExpiresAt: '2026-10-08T18:00:00.000Z',
        actor: {
          id: '0198f40c-92f3-7a12-bc9a-653f97786c2c',
          displayName: 'Synthetic Owner',
          email: 'owner@example.test',
          locale: persistedLocale,
          role: 'owner',
          permissions: [],
        },
      }),
    });
  });

  await page.goto('/items');
  await expect(page.getByRole('link', { name: 'Synthetic Owner' })).toBeVisible();
  await page.getByTestId('locale-selector').click();
  await page.getByRole('option', { name: 'Ukrainian' }).click();

  await expect(page.getByRole('heading', { name: 'Речі' })).toBeVisible();
  await expect.poll(() => persistedLocale).toBe('uk');
});
