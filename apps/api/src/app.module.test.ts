import {
  AuthRateLimiter,
  CatalogDictionaryAuthorizationError,
  DisplayTemplateError,
  ItemVersionConflictError,
  MediaVersionConflictError,
  SchemaAuthorizationError,
  SchemaPolicyError,
  SessionError,
  permissionsFor,
} from '@inventory-atlas/backend';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AuthRuntimePort } from './auth.runtime.js';
import type { FoundationRuntimePort } from './foundation.runtime.js';
import type { CatalogRuntimePort } from './catalog.runtime.js';
import type { SchemaRuntimePort } from './schema.runtime.js';
import type { ItemsRuntimePort } from './items.runtime.js';
import type { MediaRuntimePort } from './media.runtime.js';
import { createApiApplication } from './main.js';
import { createOpenApiDocument } from './openapi-document.js';

const issuedAt = new Date('2026-09-07T10:00:00.000Z');
const sessionId = '0198f40c-92f3-7a12-bc9a-653f97786c2b';
const sessionToken = 's'.repeat(43);
const csrfToken = 'c'.repeat(43);
const actor = {
  id: '0198f40c-92f3-7a12-bc9a-653f97786c2c',
  email: 'owner@example.test',
  displayName: 'Synthetic Owner',
  locale: 'en' as const,
  role: 'owner' as const,
  permissions: permissionsFor('owner'),
};

function createAdministrationRuntime() {
  return {
    listUsers: vi.fn(async () => []),
    listInvitations: vi.fn(async () => []),
    issueInvitation: vi.fn(),
    revokeInvitation: vi.fn(async () => undefined),
    acceptInvitation: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(async () => undefined),
  };
}

function createAuthRuntime() {
  return {
    signIn: vi.fn(async () => ({
      id: sessionId,
      token: sessionToken,
      csrfToken,
      idleExpiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1_000),
      absoluteExpiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
      actor,
    })),
    authenticate: vi.fn(async () => ({
      id: sessionId,
      csrfToken,
      idleExpiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1_000),
      absoluteExpiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
      actor,
    })),
    revokeCurrent: vi.fn(async () => undefined),
    revokeOwned: vi.fn(async () => undefined),
    listOwned: vi.fn(async () => []),
    updateLocale: vi.fn(async (_token, _csrf, locale) => ({ ...actor, locale })),
  };
}

const authSessions = createAuthRuntime();
const administration = createAdministrationRuntime();
const rateLimiter = new AuthRateLimiter('test-secret');
const dictionaries = {
  listCategories: vi.fn(async () => []),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  listLifecycleStatuses: vi.fn(async () => []),
  createLifecycleStatus: vi.fn(),
  updateLifecycleStatus: vi.fn(),
  archiveLifecycleStatus: vi.fn(),
  previewCategoryDisplayName: vi.fn(async () => ({
    template: '{{brand}} {{model}} - {{condition}}',
    tokens: [
      { key: 'brand', kind: 'field' as const, labels: null, dataType: 'text' as const },
      { key: 'model', kind: 'field' as const, labels: null, dataType: 'text' as const },
      { key: 'condition', kind: 'field' as const, labels: null, dataType: 'select' as const },
    ],
    rendered: { en: 'Pentax LX - Used', uk: 'Pentax LX - Вживаний' },
    missingTokens: ['model'],
  })),
};
const mediaRelationId = '0198f40c-92f3-7a12-bc9a-653f97786c50';
const mediaAssetId = '0198f40c-92f3-7a12-bc9a-653f97786c51';
const uploadSessionId = '0198f40c-92f3-7a12-bc9a-653f97786c52';
const mediaItem = {
  relationId: mediaRelationId,
  assetId: mediaAssetId,
  role: 'primary' as const,
  position: 0,
  altText: 'Front view',
  visibility: 'authenticated' as const,
  originalFilename: 'front-view.jpg',
  mimeType: 'image/jpeg',
  byteSize: 2_048,
  width: null,
  height: null,
  checksumSha256: 'a'.repeat(64),
  processingState: 'pending',
  contentUrl: `/api/v1/media/assets/${mediaAssetId}/content`,
};
const media = {
  beginUpload: vi.fn(async () => ({
    sessionId: uploadSessionId,
    uploadUrl: `/api/v1/media/upload-sessions/${uploadSessionId}/content`,
    declaredFilename: 'front-view.jpg',
    declaredMimeType: 'image/jpeg',
    declaredByteSize: 2_048,
    expiresAt: '2026-09-11T12:15:00.000Z',
    state: 'pending',
  })),
  receiveContent: vi.fn(async () => ({
    sessionId: uploadSessionId,
    uploadUrl: `/api/v1/media/upload-sessions/${uploadSessionId}/content`,
    declaredFilename: 'front-view.jpg',
    declaredMimeType: 'image/jpeg',
    declaredByteSize: 2_048,
    expiresAt: '2026-09-11T12:15:00.000Z',
    state: 'received',
  })),
  finalizeUpload: vi.fn(async () => mediaItem),
  listItemMedia: vi.fn(async () => [mediaItem]),
  reorderGallery: vi.fn(async () => [mediaItem]),
  setPrimary: vi.fn(async () => [mediaItem]),
  detachRelation: vi.fn(async () => undefined),
  openAssetContent: vi.fn(async () => ({
    asset: {
      id: mediaAssetId,
      storageKey: 'assets/01/98/object.jpg',
      originalFilename: 'front-view.jpg',
      mimeType: 'image/jpeg',
      byteSize: 11,
      width: null,
      height: null,
      checksumSha256: 'a'.repeat(64),
      processingState: 'pending' as const,
      deleteAfter: null,
      createdAt: issuedAt,
    },
    content: Readable.from([Buffer.from('image-bytes')]),
  })),
};
const fieldDefinitionId = '0198f40c-92f3-7a12-bc9a-653f97786c30';
const fieldDefinition = {
  id: fieldDefinitionId,
  key: 'serial_number',
  scope: 'item' as const,
  categoryId: null,
  labels: { en: 'Serial number', uk: 'Серійний номер' },
  help: null,
  dataType: 'text' as const,
  required: false,
  repeatable: false,
  searchable: true,
  filterable: true,
  sortable: false,
  visibility: 'authenticated' as const,
  unit: null,
  defaultValue: null,
  validation: {},
  displayOrder: 0,
  version: 1,
  archivedAt: null,
  options: [],
};
function createSchemaRuntime() {
  return {
    listFields: vi.fn(async () => [fieldDefinition]),
    createField: vi.fn(async () => fieldDefinition),
    updateField: vi.fn(async () => ({
      definition: { ...fieldDefinition, visibility: 'public' as const, version: 2 },
      reindex: {
        massReindexRequired: true,
        reasons: ['visibility'] as const,
        topic: 'search.rebuild-items.v1' as const,
      },
    })),
    archiveField: vi.fn(async () => ({
      definition: fieldDefinition,
      reindex: {
        massReindexRequired: true,
        reasons: ['archived'] as const,
        topic: 'search.rebuild-items.v1' as const,
      },
    })),
    createOption: vi.fn(async () => fieldDefinition),
    updateOption: vi.fn(async () => fieldDefinition),
    archiveOption: vi.fn(async () => fieldDefinition),
    previewConversion: vi.fn(async () => ({
      fieldDefinitionId,
      fieldKey: 'serial_number',
      currentDataType: 'text' as const,
      targetDataType: 'number' as const,
      supported: true,
      lossless: false,
      totalValues: 3,
      analyzedValues: 3,
      convertibleValues: 1,
      blockingValues: 2,
      truncated: false,
      requiresBackgroundConversion: true,
      reindexRequired: true,
      blockingIssues: ['INVALID_NUMBER'] as const,
    })),
  };
}
const schemaFields = createSchemaRuntime();
const itemPublicId = '0198f40c-92f3-7a12-bc9a-653f97786c40';
const catalogItems = {
  create: vi.fn(async () => ({
    replayed: false as const,
    status: 201 as const,
    item: {
      publicId: itemPublicId,
      slug: 'cordless-drill',
      displayName: 'Cordless drill',
      version: 1,
    },
  })),
  get: vi.fn(async () => ({
    publicId: itemPublicId,
    slug: 'cordless-drill',
    displayName: 'Cordless drill',
    description: null,
    categoryId: '0198f40c-92f3-7a12-bc9a-653f97786c41',
    lifecycleStatusId: '0198f40c-92f3-7a12-bc9a-653f97786c42',
    storageNodeId: null,
    visibility: 'authenticated' as const,
    version: 3,
    tags: ['workshop'],
    attributes: { serial_number: 'SN-42' },
    updatedAt: '2026-09-10T12:00:00.000Z',
  })),
  update: vi.fn(async () => ({
    replayed: false,
    status: 200,
    item: {
      publicId: itemPublicId,
      slug: 'cordless-drill',
      displayName: 'Cordless drill',
      version: 4,
    },
    invalidators: ['AttributeChanged' as const],
  })),
};
const runtime: FoundationRuntimePort &
  AuthRuntimePort &
  CatalogRuntimePort &
  SchemaRuntimePort &
  ItemsRuntimePort &
  MediaRuntimePort = {
  async readiness() {
    return {
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    };
  },
  metadata() {
    return {
      apiVersion: 'v1',
      buildVersion: 'test',
      buildRevision: 'test-revision',
      schemaVersion: '0001_foundation',
      supportedLocales: ['en', 'uk'],
    };
  },
  trustProxy() {
    return false;
  },
  authSessions() {
    return authSessions;
  },
  authAdministration() {
    return administration;
  },
  authRateLimiter() {
    return rateLimiter;
  },
  secureSessionCookies() {
    return true;
  },
  catalogDictionaries() {
    return dictionaries;
  },
  schemaFields() {
    return schemaFields;
  },
  catalogItems() {
    return catalogItems;
  },
  media() {
    return media;
  },
};

describe('API composition root', () => {
  it('builds a stable OpenAPI document with representative shared contracts', async () => {
    const app = await createApiApplication(runtime);
    const document = createOpenApiDocument(app);
    const operationIds = Object.values(document.paths).flatMap((pathItem) =>
      Object.values(pathItem ?? {})
        .filter(
          (operation) => operation && typeof operation === 'object' && 'operationId' in operation,
        )
        .map((operation) => operation.operationId),
    );

    expect(operationIds.toSorted()).toEqual([
      'acceptInvitation',
      'archiveCategory',
      'archiveFieldDefinition',
      'archiveFieldOption',
      'archiveLifecycleStatus',
      'archiveUser',
      'beginMediaUpload',
      'createAuthSession',
      'createCategory',
      'createFieldDefinition',
      'createFieldOption',
      'createItem',
      'createLifecycleStatus',
      'deleteAuthSession',
      'detachItemMedia',
      'finalizeMediaUpload',
      'getCurrentActor',
      'getFoundationStatus',
      'getItem',
      'getLiveness',
      'getMetadata',
      'getReadiness',
      'issueInvitation',
      'listAuthSessions',
      'listCategories',
      'listFieldDefinitions',
      'listInvitations',
      'listItemMedia',
      'listLifecycleStatuses',
      'listUsers',
      'previewCategoryDisplayName',
      'previewFieldDefinitionConversion',
      'readMediaAsset',
      'reorderItemMedia',
      'revokeAuthSession',
      'revokeInvitation',
      'setPrimaryItemMedia',
      'updateCategory',
      'updateCurrentActorLocale',
      'updateFieldDefinition',
      'updateFieldOption',
      'updateItem',
      'updateLifecycleStatus',
      'updateUser',
      'uploadMediaContent',
    ]);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(document.components?.schemas).toMatchObject({
      CursorPageDto: expect.any(Object),
      CreatedItemDto: expect.any(Object),
      CreateItemRequestDto: expect.any(Object),
      BeginUploadRequestDto: expect.any(Object),
      ItemDetailDto: expect.any(Object),
      MediaItemDto: expect.any(Object),
      ItemMutationRequestDto: expect.any(Object),
      ItemPageResponseDto: expect.any(Object),
      ProblemDetailsDto: expect.any(Object),
      UpdatedItemDto: expect.any(Object),
      UpdateItemRequestDto: expect.any(Object),
      VersionConflictProblemDto: expect.any(Object),
    });
    await app.close();
  });

  it('runs the declare, upload and finalize media flow with a raw content body', async () => {
    media.beginUpload.mockClear();
    media.receiveContent.mockClear();
    media.finalizeUpload.mockClear();
    const app = await createApiApplication(runtime);
    await app.init();
    const headers = {
      cookie: `inventory_atlas_session=${sessionToken}`,
      'x-csrf-token': csrfToken,
      'x-request-id': 'request-media',
    };

    const begun = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload-sessions',
      headers,
      payload: {
        itemPublicId: itemPublicId,
        filename: 'front-view.jpg',
        mimeType: 'image/jpeg',
        byteSize: 2_048,
      },
    });
    expect(begun.statusCode).toBe(201);
    expect(begun.json()).toMatchObject({ sessionId: uploadSessionId, state: 'pending' });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload-sessions',
      headers,
      payload: { itemPublicId, filename: 'notes.pdf', mimeType: 'application/pdf', byteSize: 10 },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(media.beginUpload).toHaveBeenCalledTimes(1);

    const uploaded = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/upload-sessions/${uploadSessionId}/content`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ state: 'received' });
    expect(media.receiveContent).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
      uploadSessionId,
      expect.anything(),
    );

    const finalized = await app.inject({
      method: 'POST',
      url: `/api/v1/media/upload-sessions/${uploadSessionId}/finalize`,
      headers,
      payload: { role: 'primary', altText: 'Front view', checksumSha256: 'a'.repeat(64) },
    });
    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toMatchObject({ relationId: mediaRelationId, role: 'primary' });
    await app.close();
  });

  it('serves stored bytes with an immutable cache policy and no sniffing', async () => {
    const app = await createApiApplication(runtime);
    await app.init();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/assets/${mediaAssetId}/content`,
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.rawPayload.toString()).toBe('image-bytes');
    await app.close();
  });

  it('requires the owner version for reorder, primary selection and detach', async () => {
    media.reorderGallery.mockClear();
    media.setPrimary.mockClear();
    media.detachRelation.mockClear();
    const app = await createApiApplication(runtime);
    await app.init();
    const headers = {
      cookie: `inventory_atlas_session=${sessionToken}`,
      'x-csrf-token': csrfToken,
    };

    const reordered = await app.inject({
      method: 'PATCH',
      url: '/api/v1/media/relations/reorder',
      headers,
      payload: { itemPublicId, expectedVersion: 4, order: [mediaRelationId] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(media.reorderGallery).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
      itemPublicId,
      4,
      [mediaRelationId],
      expect.any(Object),
    );

    const withoutVersion = await app.inject({
      method: 'POST',
      url: `/api/v1/media/relations/${mediaRelationId}/primary`,
      headers,
    });
    expect(withoutVersion.statusCode).toBe(400);
    expect(media.setPrimary).not.toHaveBeenCalled();

    const promoted = await app.inject({
      method: 'POST',
      url: `/api/v1/media/relations/${mediaRelationId}/primary`,
      headers: { ...headers, 'if-match': '"4"' },
    });
    expect(promoted.statusCode).toBe(200);

    media.detachRelation.mockRejectedValueOnce(new MediaVersionConflictError(9));
    const conflicted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/relations/${mediaRelationId}`,
      headers: { ...headers, 'if-match': '"4"', 'x-request-id': 'request-detach' },
    });
    expect(conflicted.statusCode).toBe(409);
    expect(conflicted.json()).toMatchObject({
      code: 'MEDIA_OWNER_VERSION_CONFLICT',
      currentVersion: 9,
      requestId: 'request-detach',
    });

    const detached = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/relations/${mediaRelationId}`,
      headers: { ...headers, 'if-match': '"4"' },
    });
    expect(detached.statusCode).toBe(204);
    await app.close();
  });

  it('previews a display-name template with the renderer the Items use', async () => {
    dictionaries.previewCategoryDisplayName.mockClear();
    const app = await createApiApplication(runtime);
    await app.init();
    const categoryId = '0198f40c-92f3-7a12-bc9a-653f97786c41';
    const headers = {
      cookie: `inventory_atlas_session=${sessionToken}`,
      'x-csrf-token': csrfToken,
    };
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/display-name-preview`,
      headers,
      payload: {
        template: '{{brand}} {{model}} - {{condition}}',
        sample: { brand: 'Pentax' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rendered: { en: 'Pentax LX - Used', uk: 'Pentax LX - Вживаний' },
      missingTokens: ['model'],
    });
    expect(dictionaries.previewCategoryDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
      categoryId,
      '{{brand}} {{model}} - {{condition}}',
      { brand: 'Pentax' },
    );

    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/display-name-preview`,
      headers,
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    dictionaries.previewCategoryDisplayName.mockRejectedValueOnce(
      new DisplayTemplateError([{ code: 'TEMPLATE_PRIVATE_TOKEN', token: 'owner_note' }]),
    );
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/display-name-preview`,
      headers,
      payload: { template: '{{owner_note}}' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'displayTemplate', messages: ['TEMPLATE_PRIVATE_TOKEN:owner_note'] }],
    });
    await app.close();
  });

  it('reads an Item card with its current ETag', async () => {
    const app = await createApiApplication(runtime);
    await app.init();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${itemPublicId}`,
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"3"');
    expect(response.json()).toMatchObject({ publicId: itemPublicId, version: 3 });
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/items/not-a-uuid',
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it('requires an expected version and forwards If-Match to the Item update', async () => {
    catalogItems.update.mockClear();
    const app = await createApiApplication(runtime);
    await app.init();
    const headers = {
      cookie: `inventory_atlas_session=${sessionToken}`,
      'x-csrf-token': csrfToken,
      'x-request-id': 'request-update-item',
    };
    const missing = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${itemPublicId}`,
      headers,
      payload: { displayName: 'Cordless drill' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(catalogItems.update).not.toHaveBeenCalled();

    const mismatched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${itemPublicId}`,
      headers: { ...headers, 'if-match': '"9"' },
      payload: { expectedVersion: 3, displayName: 'Cordless drill' },
    });
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json()).toMatchObject({
      fieldErrors: [{ field: 'expectedVersion', messages: ['IF_MATCH_MISMATCH'] }],
    });
    expect(catalogItems.update).not.toHaveBeenCalled();

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${itemPublicId}`,
      headers: { ...headers, 'if-match': 'W/"3"' },
      payload: { displayName: 'Cordless drill mk2' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers.etag).toBe('"4"');
    expect(accepted.json()).toMatchObject({ version: 4, invalidators: ['AttributeChanged'] });
    expect(catalogItems.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
      itemPublicId,
      3,
      { displayName: 'Cordless drill mk2' },
      expect.objectContaining({ requestId: 'request-update-item' }),
    );
    await app.close();
  });

  it('answers a stale expected version with the current version and a safe diff', async () => {
    catalogItems.update.mockClear();
    catalogItems.update.mockRejectedValueOnce(
      new ItemVersionConflictError(7, {
        displayName: { current: 'Cordless drill (workshop)', submitted: 'Cordless drill mk2' },
      }),
    );
    const app = await createApiApplication(runtime);
    await app.init();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${itemPublicId}`,
      headers: {
        cookie: `inventory_atlas_session=${sessionToken}`,
        'x-csrf-token': csrfToken,
        'if-match': '"3"',
        'x-request-id': 'request-conflict',
      },
      payload: { displayName: 'Cordless drill mk2' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers.etag).toBeUndefined();
    expect(response.json()).toMatchObject({
      code: 'ITEM_VERSION_CONFLICT',
      currentVersion: 7,
      requestId: 'request-conflict',
      safeDiff: {
        displayName: { current: 'Cordless drill (workshop)', submitted: 'Cordless drill mk2' },
      },
    });
    await app.close();
  });

  it('validates Item creation with the generated schema and returns ETag', async () => {
    catalogItems.create.mockClear();
    const app = await createApiApplication(runtime);
    await app.init();
    const headers = {
      cookie: `inventory_atlas_session=${sessionToken}`,
      'x-csrf-token': csrfToken,
      'idempotency-key': 'create-cordless-drill',
      'x-request-id': 'request-create-item',
    };
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers,
      payload: { displayName: '', categoryId: 'invalid', lifecycleStatusId: 'invalid' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ field: 'categoryId' }),
        expect.objectContaining({ field: 'displayName' }),
        expect.objectContaining({ field: 'lifecycleStatusId' }),
      ]),
    });
    expect(catalogItems.create).not.toHaveBeenCalled();

    const payload = {
      categoryId: '0198f40c-92f3-7a12-bc9a-653f97786c31',
      lifecycleStatusId: '0198f40c-92f3-7a12-bc9a-653f97786c32',
      displayName: 'Cordless drill',
      attributes: { serial_number: 'SN-42' },
    };
    const created = await app.inject({ method: 'POST', url: '/api/v1/items', headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(created.json()).toMatchObject({
      displayName: 'Cordless drill',
      slug: 'cordless-drill',
      version: 1,
    });
    expect(catalogItems.create).toHaveBeenCalledWith(
      actor,
      payload,
      expect.objectContaining({
        idempotencyKey: 'create-cordless-drill',
        requestId: 'request-create-item',
      }),
    );
    await app.close();
  });

  it('sets a hardened opaque cookie and returns the separate CSRF token on sign-in', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
    });
    await app.init();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/session',
      payload: { email: 'owner@example.test', password: 'synthetic password' },
      headers: { 'user-agent': 'Synthetic Browser' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain(
      `inventory_atlas_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax;`,
    );
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ sessionId, csrfToken, actor });
    expect(response.body).not.toContain(sessionToken);
    expect(sessions.signIn).toHaveBeenCalledWith(
      'owner@example.test',
      'synthetic password',
      expect.objectContaining({ userAgent: 'Synthetic Browser' }),
    );
    await app.close();
  });

  it('protects dictionary mutations with CSRF and passes the authenticated actor', async () => {
    const catalog = { ...dictionaries, createCategory: vi.fn() };
    catalog.createCategory.mockResolvedValueOnce({
      id: '0198f40c-92f3-7a12-bc9a-653f97786c2d',
      parentId: null,
      key: 'tools',
      labels: { en: 'Tools', uk: 'Інструменти' },
      displayTemplate: null,
      displayOrder: 2,
      version: 1,
      archivedAt: null,
    });
    const app = await createApiApplication({ ...runtime, catalogDictionaries: () => catalog });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;
    const payload = {
      key: 'tools',
      labels: { en: 'Tools', uk: 'Інструменти' },
      parentId: null,
      displayTemplate: null,
      displayOrder: 2,
    };

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { cookie },
      payload,
    });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: {
        cookie,
        'x-csrf-token': csrfToken,
        'x-request-id': 'catalog-request',
        'x-correlation-id': 'catalog-correlation',
      },
      payload,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ key: 'tools', labels: payload.labels, version: 1 });
    expect(catalog.createCategory).toHaveBeenCalledWith(actor, payload, {
      requestId: 'catalog-request',
      correlationId: 'catalog-correlation',
    });
    await app.close();
  });

  it('maps dictionary authorization failures without exposing the adapter', async () => {
    const catalog = {
      ...dictionaries,
      listLifecycleStatuses: vi.fn().mockRejectedValue(new CatalogDictionaryAuthorizationError()),
    };
    const app = await createApiApplication({ ...runtime, catalogDictionaries: () => catalog });
    await app.init();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lifecycle-statuses',
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('listLifecycleStatuses');
    await app.close();
  });

  it('protects dynamic schema mutations with CSRF and returns the reindex warning', async () => {
    const fields = createSchemaRuntime();
    const app = await createApiApplication({ ...runtime, schemaFields: () => fields });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/field-definitions?scope=item&includeArchived=true',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([{ key: 'serial_number', options: [] }]);
    expect(fields.listFields).toHaveBeenCalledWith(actor, {
      scope: 'item',
      includeArchived: true,
    });

    const rejectedScope = await app.inject({
      method: 'GET',
      url: '/api/v1/field-definitions?scope=node',
      headers: { cookie },
    });
    expect(rejectedScope.statusCode).toBe(400);

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, visibility: 'public' },
    });
    expect(rejected.statusCode).toBe(401);
    expect(fields.updateField).not.toHaveBeenCalled();

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-request-id': 'schema-request' },
      payload: { expectedVersion: 1, visibility: 'public' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      definition: { visibility: 'public', version: 2 },
      reindex: { massReindexRequired: true, reasons: ['visibility'] },
    });
    expect(fields.updateField).toHaveBeenCalledWith(
      actor,
      fieldDefinitionId,
      1,
      { visibility: 'public' },
      { requestId: 'schema-request' },
    );

    const immutable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expectedVersion: 1, key: 'renamed' },
    });
    expect(immutable.statusCode).toBe(400);

    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/v1/field-definitions/${fieldDefinitionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken, 'if-match': '2' },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ reindex: { reasons: ['archived'] } });
    expect(fields.archiveField).toHaveBeenCalledWith(actor, fieldDefinitionId, 2, {});
    await app.close();
  });

  it('previews a conversion and maps a required conversion to a conflict', async () => {
    const fields = createSchemaRuntime();
    const app = await createApiApplication({ ...runtime, schemaFields: () => fields });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/field-definitions/${fieldDefinitionId}/conversion-preview`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { targetDataType: 'number' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      supported: true,
      totalValues: 3,
      blockingValues: 2,
      blockingIssues: ['INVALID_NUMBER'],
    });
    expect(fields.previewConversion).toHaveBeenCalledWith(actor, fieldDefinitionId, 'number');

    fields.updateField.mockRejectedValueOnce(
      new SchemaPolicyError(
        'SCHEMA_FIELD_CONVERSION_REQUIRED',
        'Existing values require a conversion preview and plan before the data type changes.',
      ),
    );
    const conflicted = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expectedVersion: 1, dataType: 'number' },
    });
    expect(conflicted.statusCode).toBe(409);
    await app.close();
  });

  it('manages field options through the parent definition version', async () => {
    const fields = createSchemaRuntime();
    const app = await createApiApplication({ ...runtime, schemaFields: () => fields });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;
    const optionId = '0198f40c-92f3-7a12-bc9a-653f97786c31';

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/field-definitions/${fieldDefinitionId}/options`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expectedVersion: 1, key: 'metal', labels: { en: 'Metal', uk: 'Метал' } },
    });
    expect(created.statusCode).toBe(201);
    expect(fields.createOption).toHaveBeenCalledWith(
      actor,
      fieldDefinitionId,
      1,
      { key: 'metal', labels: { en: 'Metal', uk: 'Метал' }, displayOrder: 0 },
      {},
    );

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}/options/${optionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expectedVersion: 2, labels: { en: 'Steel' } },
    });
    expect(renamed.statusCode).toBe(200);
    expect(fields.updateOption).toHaveBeenCalledWith(
      actor,
      fieldDefinitionId,
      optionId,
      2,
      { labels: { en: 'Steel' } },
      {},
    );

    const immutableKey = await app.inject({
      method: 'PATCH',
      url: `/api/v1/field-definitions/${fieldDefinitionId}/options/${optionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expectedVersion: 2, key: 'steel' },
    });
    expect(immutableKey.statusCode).toBe(400);

    const archivedOption = await app.inject({
      method: 'DELETE',
      url: `/api/v1/field-definitions/${fieldDefinitionId}/options/${optionId}`,
      headers: { cookie, 'x-csrf-token': csrfToken, 'if-match': 'W/"3"' },
    });
    expect(archivedOption.statusCode).toBe(200);
    expect(fields.archiveOption).toHaveBeenCalledWith(actor, fieldDefinitionId, optionId, 3, {});
    await app.close();
  });

  it('maps dynamic schema authorization failures without exposing the adapter', async () => {
    const fields = createSchemaRuntime();
    fields.listFields.mockRejectedValueOnce(new SchemaAuthorizationError());
    const app = await createApiApplication({ ...runtime, schemaFields: () => fields });
    await app.init();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/field-definitions',
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('listFields');
    await app.close();
  });

  it('authenticates from the cookie and requires CSRF for every session mutation', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
      secureSessionCookies: () => false,
    });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(sessions.authenticate).toHaveBeenCalledWith(sessionToken);

    const missingCsrf = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(missingCsrf.statusCode).toBe(401);
    expect(sessions.revokeCurrent).not.toHaveBeenCalled();

    const signOut = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(signOut.statusCode).toBe(204);
    expect(sessions.revokeCurrent).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(signOut.headers['set-cookie']).toContain('Max-Age=0');
    expect(signOut.headers['set-cookie']).not.toContain('Secure');
    await app.close();
  });

  it('persists the current actor locale through a CSRF-protected endpoint', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const rejected = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/locale',
      headers: { cookie },
      payload: { locale: 'uk' },
    });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/locale',
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-request-id': 'locale-request' },
      payload: { locale: 'uk' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: actor.id, locale: 'uk' });
    expect(sessions.updateLocale).toHaveBeenCalledWith(
      sessionToken,
      csrfToken,
      'uk',
      expect.objectContaining({ requestId: 'locale-request' }),
    );
    await app.close();
  });

  it('does not reveal whether an unowned session exists', async () => {
    const sessions = createAuthRuntime();
    sessions.revokeOwned.mockRejectedValueOnce(
      new SessionError('AUTH_SESSION_NOT_FOUND', 'Session was not found.'),
    );
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${sessionId}`,
      headers: {
        cookie: `inventory_atlas_session=${sessionToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('owner');
    await app.close();
  });

  it('requires CSRF and passes the authenticated actor to invitation issuance', async () => {
    const sessions = createAuthRuntime();
    const authAdministration = createAdministrationRuntime();
    authAdministration.issueInvitation.mockResolvedValueOnce({
      id: '0198f40c-92f3-7a12-bc9a-653f97786c2d',
      email: 'viewer@example.test',
      role: 'viewer',
      expiresAt: new Date('2026-09-15T10:00:00.000Z'),
      acceptedAt: null,
      revokedAt: null,
      version: 1,
      token: 'i'.repeat(43),
    });
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
      authAdministration: () => authAdministration,
    });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie },
      payload: { email: 'viewer@example.test', role: 'viewer' },
    });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-request-id': 'request-1' },
      payload: { email: 'viewer@example.test', role: 'viewer' },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ role: 'viewer', token: 'i'.repeat(43) });
    expect(sessions.authenticate).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(authAdministration.issueInvitation).toHaveBeenCalledWith(
      actor,
      { email: 'viewer@example.test', role: 'viewer' },
      expect.objectContaining({ requestId: 'request-1' }),
    );
    await app.close();
  });

  it('clears an invalid session cookie during current-actor recovery', async () => {
    const sessions = createAuthRuntime();
    sessions.authenticate.mockRejectedValueOnce(
      new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.'),
    );
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    await app.close();
  });

  it('initializes and closes the Fastify application', async () => {
    const app = await createApiApplication(runtime);
    await app.init();
    expect(app.getHttpAdapter().getType()).toBe('fastify');
    await app.close();
  });

  it('reports process health for container startup ordering', async () => {
    const app = await createApiApplication(runtime);
    await app.init();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    });

    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toEqual(runtime.metadata());

    await app.close();
  });

  it('returns actionable component states when readiness fails', async () => {
    const unreadyRuntime: FoundationRuntimePort &
      AuthRuntimePort &
      CatalogRuntimePort &
      SchemaRuntimePort &
      ItemsRuntimePort &
      MediaRuntimePort = {
      ...runtime,
      async readiness() {
        return {
          status: 'unready',
          components: {
            database: 'unavailable',
            schema: 'unavailable',
            mediaStorage: 'ready',
            mediaCapabilities: 'ready',
          },
        };
      },
    };
    const app = await createApiApplication(unreadyRuntime);
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('database');
    expect(response.body).toContain('unavailable');

    await app.close();
  });
});
