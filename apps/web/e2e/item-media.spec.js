import { expect, test } from '@playwright/test';

const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786001';
const statusId = '0198f40c-92f3-7a12-bc9a-653f97786002';
const publicId = '0198f40c-92f3-7a12-bc9a-653f97786004';
const sessionId = '0198f40c-92f3-7a12-bc9a-653f97786010';
const firstRelation = '0198f40c-92f3-7a12-bc9a-653f97786101';
const secondRelation = '0198f40c-92f3-7a12-bc9a-653f97786102';

test('an Editor uploads an image, sees it attached and promotes it to primary', async ({
  page,
}) => {
  /** The attached media the API reports; the upload flow appends to it. */
  let attached = [relation(firstRelation, 'primary', 0, 'front.jpg')];
  const calls = [];
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
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/items/${publicId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { ETag: '"7"' },
      body: JSON.stringify({
        publicId,
        slug: 'cordless-drill',
        displayName: 'Cordless drill',
        description: null,
        categoryId,
        lifecycleStatusId: statusId,
        storageNodeId: null,
        visibility: 'authenticated',
        version: 7,
        tags: [],
        attributes: {},
        updatedAt: '2026-09-11T12:00:00.000Z',
      }),
    }),
  );
  await page.route(`**/api/v1/items/${publicId}/media`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(attached) }),
  );
  await page.route('**/api/v1/media/assets/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pngPixel() }),
  );
  await page.route('**/api/v1/media/upload-sessions', async (route) => {
    calls.push({ step: 'begin', body: route.request().postDataJSON() });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        uploadUrl: `/api/v1/media/upload-sessions/${sessionId}/content`,
        declaredFilename: 'second.png',
        declaredMimeType: 'image/png',
        declaredByteSize: pngPixel().byteLength,
        expiresAt: '2026-09-11T12:15:00.000Z',
        state: 'pending',
      }),
    });
  });
  await page.route(`**/api/v1/media/upload-sessions/${sessionId}/content`, async (route) => {
    calls.push({ step: 'content', method: route.request().method() });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, state: 'received' }),
    });
  });
  await page.route(`**/api/v1/media/upload-sessions/${sessionId}/finalize`, async (route) => {
    calls.push({ step: 'finalize', body: route.request().postDataJSON() });
    attached = [...attached, relation(secondRelation, 'gallery', 0, 'second.png')];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(attached.at(-1)),
    });
  });
  await page.route(`**/api/v1/media/relations/${secondRelation}/primary`, async (route) => {
    calls.push({ step: 'primary', ifMatch: route.request().headers()['if-match'] });
    attached = [
      relation(secondRelation, 'primary', 0, 'second.png'),
      relation(firstRelation, 'gallery', 0, 'front.jpg'),
    ];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(attached) });
  });

  await page.goto(`/items/${publicId}/edit`);
  await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
  await expect(page.getByText('Primary image: front.jpg')).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: 'second.png',
    mimeType: 'image/png',
    buffer: pngPixel(),
  });

  await expect(page.getByText('The image was attached.')).toBeVisible();
  expect(calls.map(({ step }) => step)).toEqual(['begin', 'content', 'finalize']);
  expect(calls[0].body).toMatchObject({ itemPublicId: publicId, mimeType: 'image/png' });
  expect(calls[1].method).toBe('PUT');
  expect(calls[2].body).toMatchObject({ role: 'gallery' });

  await page.getByRole('button', { name: 'Make primary' }).click();
  await expect(page.getByText('The primary image was changed.')).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ step: 'primary', ifMatch: '"7"' });
  await expect(page.getByText('Primary image: second.png')).toBeVisible();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

/** @param {string} relationId */
function relation(relationId, role, position, originalFilename) {
  return {
    relationId,
    assetId: relationId,
    role,
    position,
    altText: role === 'primary' ? 'Front view' : null,
    visibility: 'authenticated',
    originalFilename,
    mimeType: 'image/png',
    byteSize: 70,
    width: null,
    height: null,
    checksumSha256: 'a'.repeat(64),
    processingState: 'pending',
    contentUrl: `/api/v1/media/assets/${relationId}/content`,
  };
}

/** A real one-pixel PNG, so the browser renders it and the signature would pass server checks. */
function pngPixel() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}
