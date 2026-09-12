import { expect, test } from '@playwright/test';

const sourcePublicId = '0198f40c-92f3-7a12-bc9a-653f97786c60';
const oldParentPublicId = '0198f40c-92f3-7a12-bc9a-653f97786c61';
const targetPublicId = '0198f40c-92f3-7a12-bc9a-653f97786c62';

test('an Editor confirms a subtree move and sees the refreshed breadcrumb', async ({ page }) => {
  let moved = false;
  const moveRequests = [];
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
  await page.route('**/api/v1/field-definitions?**', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/storage-nodes/${sourcePublicId}/move`, async (route) => {
    moveRequests.push({
      body: route.request().postDataJSON(),
      ifMatch: route.request().headers()['if-match'],
    });
    moved = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...summary(sourcePublicId, 'Source box'),
        parentPublicId: targetPublicId,
        depth: 1,
        version: 4,
      }),
    });
  });
  await page.route(`**/api/v1/storage-nodes/${sourcePublicId}?**`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail(moved)) }),
  );
  await page.route('**/api/v1/storage-nodes?**', (route) => {
    const parent = new URL(route.request().url()).searchParams.get('parentPublicId');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        entries: parent
          ? []
          : [summary(oldParentPublicId, 'Old warehouse'), summary(targetPublicId, 'New warehouse')],
        nextCursor: null,
      }),
    });
  });

  await page.goto(`/storage/${sourcePublicId}`);
  await expect(page.getByText('Old warehouse')).toBeVisible();
  await page.getByRole('button', { name: 'Move location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move storage location' });
  await dialog.getByLabel('New parent location').click();
  await page.getByRole('option', { name: 'New warehouse' }).click();
  await dialog.getByRole('button', { name: 'Review move' }).click();
  await expect(dialog.getByText('Move Source box into New warehouse?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Move location' }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'New warehouse', exact: true })).toBeVisible();
  expect(moveRequests).toEqual([
    {
      body: { targetParentPublicId: targetPublicId, expectedVersion: 3 },
      ifMatch: '"3"',
    },
  ]);
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

function summary(publicId, title) {
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

function detail(moved) {
  return {
    ...summary(sourcePublicId, 'Source box'),
    parentPublicId: moved ? targetPublicId : oldParentPublicId,
    depth: 1,
    version: moved ? 4 : 3,
    breadcrumb: [
      {
        publicId: moved ? targetPublicId : oldParentPublicId,
        title: moved ? 'New warehouse' : 'Old warehouse',
        depth: 0,
      },
      { publicId: sourcePublicId, title: 'Source box', depth: 1 },
    ],
    contents: { entries: [], nextCursor: null },
    attributes: {},
    updatedAt: '2026-09-12T10:00:00.000Z',
  };
}
