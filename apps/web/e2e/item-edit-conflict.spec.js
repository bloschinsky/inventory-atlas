import { expect, test } from '@playwright/test';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';
const statusId = '0198f40c-92f3-7a12-bc9a-653f97786002';
const publicId = '0198f40c-92f3-7a12-bc9a-653f97786004';

test('a second editor receives a conflict and reloads instead of overwriting', async ({ page }) => {
  /** The stored aggregate a concurrent editor advances between the load and the save. */
  let storedVersion = 3;
  let storedName = 'Cordless drill';
  const updates = [];
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
          help: null,
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
  await page.route(`**/api/v1/items/${publicId}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fulfill({
        contentType: 'application/json',
        headers: { ETag: `"${storedVersion}"` },
        body: JSON.stringify({
          publicId,
          slug: 'cordless-drill',
          displayName: storedName,
          description: null,
          categoryId,
          lifecycleStatusId: statusId,
          storageNodeId: null,
          visibility: 'authenticated',
          version: storedVersion,
          tags: ['workshop'],
          attributes: { serial_number: 'SN-42' },
          updatedAt: '2026-09-10T12:00:00.000Z',
        }),
      });
      return;
    }
    const body = route.request().postDataJSON();
    updates.push({ body, ifMatch: route.request().headers()['if-match'] });
    if (body.expectedVersion !== storedVersion) {
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://inventory-atlas.local/problems/item-version-conflict',
          title: 'Item version conflict',
          status: 409,
          code: 'ITEM_VERSION_CONFLICT',
          detail: 'The Item changed since the submitted version.',
          requestId: '0198f40c-92f3-7a12-bc9a-653f97786c2b',
          currentVersion: storedVersion,
          safeDiff: {
            displayName: { current: storedName, submitted: body.displayName },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        publicId,
        slug: 'cordless-drill',
        displayName: body.displayName,
        version: storedVersion + 1,
        invalidators: ['AttributeChanged'],
      }),
    });
  });

  await page.goto(`/items/${publicId}/edit`);
  await expect(page.getByText('Version 3')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Cordless drill');

  // A concurrent editor saves first; this page still holds version 3.
  storedVersion = 4;
  storedName = 'Cordless drill (workshop)';

  await page.getByLabel('Display name').fill('Cordless drill mk2');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('This item changed while you were editing')).toBeVisible();
  await expect(page.getByText('This item is now at version 4.')).toBeVisible();
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ ifMatch: '"3"', body: { expectedVersion: 3 } });

  await page.getByRole('button', { name: 'Compare changes' }).click();
  await expect(page.getByRole('cell', { name: 'Cordless drill (workshop)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cordless drill mk2' })).toBeVisible();

  await page.getByRole('button', { name: 'Reload the saved version' }).click();
  await expect(page.getByText('Version 4')).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Cordless drill (workshop)');
  expect(updates).toHaveLength(1);

  await page.getByLabel('Display name').fill('Cordless drill mk3');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your changes were saved.')).toBeVisible();
  expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({ ifMatch: '"4"', body: { expectedVersion: 4 } });
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});
