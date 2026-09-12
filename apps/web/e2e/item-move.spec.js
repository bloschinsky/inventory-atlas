import { expect, test } from '@playwright/test';

const itemPublicId = '0198f40c-92f3-7a12-bc9a-653f97786d40';
const sourcePublicId = '0198f40c-92f3-7a12-bc9a-653f97786d41';
const destinationPublicId = '0198f40c-92f3-7a12-bc9a-653f97786d42';
const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786d43';
const statusId = '0198f40c-92f3-7a12-bc9a-653f97786d44';

test('an Editor moves an Item and immediately sees its breadcrumb and history', async ({
  page,
}) => {
  let moved = false;
  const moveRequests = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: '0198f40c-92f3-7a12-bc9a-653f97786d45',
        csrfToken: 'c'.repeat(43),
        actor: {
          id: '0198f40c-92f3-7a12-bc9a-653f97786d46',
          displayName: 'Synthetic Editor',
          email: 'editor@example.test',
          locale: 'en',
          role: 'editor',
          permissions: ['viewPublicCards', 'viewAuthenticatedFields', 'editItems', 'moveInventory'],
        },
      }),
    }),
  );
  await page.route(`**/api/v1/items/${itemPublicId}/move`, async (route) => {
    moveRequests.push({
      body: route.request().postDataJSON(),
      ifMatch: route.request().headers()['if-match'],
      idempotencyKey: route.request().headers()['idempotency-key'],
    });
    moved = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        publicId: itemPublicId,
        slug: 'cordless-drill',
        displayName: 'Cordless drill',
        version: 4,
        storageNodeId: destinationPublicId,
        locationPath: 'Workshop / Cabinet B',
        invalidators: ['AttributeChanged'],
      }),
    });
  });
  await page.route(`**/api/v1/items/${itemPublicId}/movements**`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        entries: moved
          ? [
              {
                fromAssigned: true,
                toAssigned: true,
                fromNodePublicId: null,
                toNodePublicId: null,
                fromPathSnapshot: null,
                toPathSnapshot: null,
                actorDisplayName: 'Synthetic Editor',
                reason: 'Better fit',
                occurredAt: '2026-09-12T10:00:00.000Z',
              },
            ]
          : [],
        nextCursor: null,
      }),
    }),
  );
  await page.route(`**/api/v1/items/${itemPublicId}/media`, (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/items/${itemPublicId}`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(itemDetail(moved)) }),
  );
  await page.route('**/api/v1/categories**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ id: categoryId, labels: { en: 'Tools', uk: 'Інструменти' } }]),
    }),
  );
  await page.route('**/api/v1/lifecycle-statuses**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ id: statusId, labels: { en: 'Stored', uk: 'Зберігається' } }]),
    }),
  );
  await page.route('**/api/v1/field-definitions**', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/v1/storage-nodes**', (route) => {
    const parent = new URL(route.request().url()).searchParams.get('parentPublicId');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        entries: parent
          ? []
          : [
              storageSummary(sourcePublicId, 'Cabinet A'),
              storageSummary(destinationPublicId, 'Cabinet B'),
            ],
        nextCursor: null,
      }),
    });
  });

  await page.goto(`/items/${itemPublicId}`);
  await expect(page.getByRole('heading', { name: 'Cordless drill' })).toBeVisible();
  const location = page.getByRole('region', { name: 'Storage location' });
  await expect(location.getByRole('link', { name: 'Workshop' })).toBeVisible();
  await expect(location.getByRole('link', { name: 'Cabinet A' })).toBeVisible();
  await page.getByRole('button', { name: 'Move item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move item' });
  await dialog.getByLabel('New storage location').click();
  await page.getByRole('option', { name: 'Cabinet B' }).click();
  await dialog.getByLabel('Reason (optional)').fill('Better fit');
  await dialog.getByRole('button', { name: 'Move item' }).click();

  await expect(dialog).not.toBeVisible();
  await expect(location.getByRole('link', { name: 'Cabinet B' })).toBeVisible();
  await expect(location.getByRole('link', { name: 'Cabinet A' })).toHaveCount(0);
  await expect(page.getByText('Moved between storage locations')).toBeVisible();
  await expect(page.getByText('Better fit')).toBeVisible();
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0]).toMatchObject({
    body: { expectedVersion: 3, storageNodeId: destinationPublicId, reason: 'Better fit' },
    ifMatch: '"3"',
  });
  expect(moveRequests[0].idempotencyKey).toBeTruthy();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

function itemDetail(moved) {
  return {
    publicId: itemPublicId,
    slug: 'cordless-drill',
    displayName: 'Cordless drill',
    description: null,
    categoryId,
    lifecycleStatusId: statusId,
    storageNodeId: moved ? destinationPublicId : sourcePublicId,
    locationPath: moved ? 'Workshop / Cabinet B' : 'Workshop / Cabinet A',
    visibility: 'authenticated',
    version: moved ? 4 : 3,
    tags: [],
    attributes: {},
    updatedAt: '2026-09-12T10:00:00.000Z',
  };
}

function storageSummary(publicId, title) {
  return {
    publicId,
    parentPublicId: null,
    nodeType: 'container',
    title,
    code: null,
    visibility: 'authenticated',
    depth: 0,
    version: 1,
  };
}
