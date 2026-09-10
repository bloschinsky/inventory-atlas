import { expect, test } from '@playwright/test';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';

test('an Admin composes a display-name template and previews it in both locales', async ({
  page,
}) => {
  const previews = [];
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: '0198f40c-92f3-7a12-bc9a-653f97786009',
        csrfToken: 'c'.repeat(43),
        actor: {
          id: '0198f40c-92f3-7a12-bc9a-653f97786008',
          displayName: 'Synthetic Admin',
          email: 'admin@example.test',
          locale: 'en',
          role: 'admin',
          permissions: [
            'viewPublicCards',
            'viewAuthenticatedFields',
            'viewPrivateFields',
            'manageSchema',
          ],
        },
      }),
    }),
  );
  await page.route('**/api/v1/categories?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: categoryId,
          parentId: null,
          key: 'cameras',
          labels: { en: 'Cameras', uk: 'Фотокамери' },
          displayTemplate: null,
          displayOrder: 0,
          version: 3,
          archivedAt: null,
        },
      ]),
    }),
  );
  await page.route('**/api/v1/field-definitions?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '0198f40c-92f3-7a12-bc9a-653f97786005',
          key: 'brand',
          labels: { en: 'Brand', uk: 'Бренд' },
          dataType: 'text',
          visibility: 'public',
          defaultValue: null,
          options: [],
        },
        {
          id: '0198f40c-92f3-7a12-bc9a-653f97786006',
          key: 'owner_note',
          labels: { en: 'Owner note', uk: 'Нотатка власника' },
          dataType: 'text',
          visibility: 'private',
          defaultValue: null,
          options: [],
        },
      ]),
    }),
  );
  await page.route(`**/api/v1/categories/${categoryId}/display-name-preview`, async (route) => {
    const body = route.request().postDataJSON();
    previews.push(body);
    const brand = body.sample?.brand;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        template: body.template,
        tokens: [],
        rendered: {
          en: ['Cameras', brand].filter(Boolean).join(' '),
          uk: ['Фотокамери', brand].filter(Boolean).join(' '),
        },
        missingTokens: brand ? [] : ['brand'],
      }),
    });
  });

  await page.goto('/admin/categories');
  await page.getByRole('button', { name: 'Edit' }).first().click();

  // A private field is never offered as a token.
  await expect(page.getByRole('button', { name: 'Brand', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Owner note' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Category', exact: true }).click();
  await page.getByRole('button', { name: 'Brand', exact: true }).click();
  await expect(page.getByLabel('Display-name template')).toHaveValue('{{category}} {{brand}}');

  await expect(page.getByText('Skipped with no sample value: brand')).toBeVisible();
  await page.getByLabel('Brand', { exact: true }).fill('Pentax');

  await expect(page.getByText('Cameras Pentax')).toBeVisible();
  await expect(page.getByText('Фотокамери Pentax')).toBeVisible();
  expect(previews.at(-1)).toMatchObject({
    template: '{{category}} {{brand}}',
    sample: { brand: 'Pentax' },
  });
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});
