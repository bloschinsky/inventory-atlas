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
