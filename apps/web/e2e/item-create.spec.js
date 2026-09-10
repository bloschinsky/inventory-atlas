import { expect, test } from '@playwright/test';

test('an Editor creates an Item from a mobile schema form and sees its card immediately', async ({
  page,
}) => {
  const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';
  const statusId = '0198f40c-92f3-7a12-bc9a-653f97786002';
  let createdBody;
  let idempotencyKey;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: '0198f40c-92f3-7a12-bc9a-653f97786009',
        csrfToken: 'c'.repeat(43),
        actor: {
          id: '0198f40c-92f3-7a12-bc9a-653f97786008',
          displayName: 'Synthetic Editor',
          email: 'editor@example.test',
          locale: 'en',
          role: 'editor',
          permissions: ['viewPublicCards', 'viewAuthenticatedFields', 'editItems'],
        },
      }),
    }),
  );
  await page.route('**/api/v1/categories?includeArchived=false', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ id: categoryId, labels: { en: 'Tools', uk: 'Інструменти' } }]),
    }),
  );
  await page.route('**/api/v1/lifecycle-statuses?includeArchived=false', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ id: statusId, labels: { en: 'Stored', uk: 'Зберігається' } }]),
    }),
  );
  await page.route('**/api/v1/field-definitions?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '0198f40c-92f3-7a12-bc9a-653f97786005',
          key: 'serial_number',
          labels: { en: 'Serial number', uk: 'Серійний номер' },
          help: { en: 'Manufacturer serial', uk: 'Серійний номер виробника' },
          dataType: 'text',
          required: true,
          repeatable: false,
          visibility: 'authenticated',
          defaultValue: null,
          options: [],
        },
      ]),
    }),
  );
  await page.route('**/api/v1/items', async (route) => {
    createdBody = route.request().postDataJSON();
    idempotencyKey = route.request().headers()['idempotency-key'];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        publicId: '0198f40c-92f3-7a12-bc9a-653f97786004',
        slug: 'cordless-drill',
        displayName: 'Cordless drill',
        version: 1,
      }),
    });
  });

  await page.goto('/items/new');
  await expect(page.getByRole('heading', { name: 'New item' })).toBeVisible();
  await page.getByLabel('Category').click();
  await page.getByRole('option', { name: 'Tools' }).click();
  await page.getByLabel('Lifecycle status').click();
  await page.getByRole('option', { name: 'Stored' }).click();
  await page.getByLabel('Display name').fill('Cordless drill');
  await page.getByLabel('Serial number').fill('SN-42');
  await page.getByRole('button', { name: 'Create item' }).click();

  await expect(page.getByText('The item was created and is ready to view.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cordless drill' })).toBeVisible();
  await expect(page.getByText('SN-42')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Placeholder image for Tools' })).toBeVisible();
  expect(createdBody).toMatchObject({
    categoryId,
    lifecycleStatusId: statusId,
    attributes: { serial_number: 'SN-42' },
  });
  expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});
